import Decimal from 'decimal.js';
import { Role } from '../../generated/prisma/enums';
import { cleanupExpiredAgentMonthlyBillExports } from '../agent-monthly-billing/export';
import { scrubTerminalAgentMonthlyBillExportFilters } from '../agent-monthly-billing/export-retention';
import {
  BillGenerationUnexpectedError,
  generateBillsForPeriod,
  type BillGenerationResult,
} from '../bill';
import { getOverdueOutsourcing } from '../dashboard/owner-watchlist';
import { formatDateShanghai } from '../format/dates';
import { dispatchNotification } from '../notification/dispatch';
import {
  assertExecutionFence,
  type ExecutionFence,
} from '../execution-fence';
import { orderStatusZh } from '../order/log-format';
import { cleanupExpiredOrderExports } from '../order/export';
import { scrubTerminalOrderExportFilters } from '../order/export-retention';
import {
  ORDER_OVERDUE_NOTIFY_CAP,
  scanOverdueOrders,
} from '../order/overdue-scan';
import {
  getPieceworkSettlementDay,
  lockPieceworkSettlementsForDate,
  type PieceworkSettlementBatchResult,
} from '../salary/piecework-settlement';

function logPartialBatchProgress(
  task: 'daily-salary' | 'generate-bills',
  committedCount: number,
  businessErrorCount: number,
): void {
  // Counts only: salary amounts, worker ids and customer data must not leak to
  // process logs. The typed error still reaches the durable worker for retry.
  console.error(`[cron:${task}] unexpected failure after partial progress:`, {
    committedCount,
    businessErrorCount,
  });
}

export async function runDailySalaryTask(
  date: string,
  fence?: ExecutionFence,
) {
  await assertExecutionFence(fence);
  const result = await lockPieceworkSettlementsForDate({
    workDate: date,
    actor: {
      id: 'system',
      role: Role.ADMIN,
      username: 'system',
      displayName: '系统日结',
    },
  });
  const { settled, errors } = result;
  if (errors.length > 0) {
    logPartialBatchProgress('daily-salary', settled.length, errors.length);
    throw new DailySalaryBatchIncompleteError(result);
  }
  await assertExecutionFence(fence);
  const day = await getPieceworkSettlementDay({ workDate: date });
  const totalAmount = day.settlements
    .reduce(
      (sum, row) => sum.plus(new Decimal(row.payableAmount)),
      new Decimal(0),
    )
    .toFixed(2);
  if (day.settlements.length > 0) {
    await dispatchNotification(
      'DAILY_WORKER_SALARY',
      {
        date,
        workerCount: day.settlements.length,
        totalAmount,
      },
      { dedupeKey: `notification:DAILY_WORKER_SALARY:piecework-v1:${date}` },
    );
  }
  return {
    status: 'ok' as const,
    date,
    workerCount: day.settlements.length,
    errorCount: 0,
    failed: 0,
  };
}

export class DailySalaryBatchIncompleteError extends Error {
  readonly partialResult: PieceworkSettlementBatchResult;

  constructor(partialResult: PieceworkSettlementBatchResult) {
    super('piecework settlement batch contains unresolved reporter errors');
    this.name = 'DailySalaryBatchIncompleteError';
    this.partialResult = partialResult;
  }
}

export async function runGenerateBillsTask(
  period: string,
  fence?: ExecutionFence,
) {
  let unexpected: BillGenerationUnexpectedError | null = null;
  let result: BillGenerationResult;
  try {
    result = await generateBillsForPeriod(period, {
      id: 'system',
      role: Role.ADMIN,
    }, fence);
  } catch (error) {
    if (!(error instanceof BillGenerationUnexpectedError)) throw error;
    unexpected = error;
    result = error.partialResult;
  }
  if (unexpected) {
    logPartialBatchProgress(
      'generate-bills',
      result.generated.length,
      result.errors.length,
    );
    throw unexpected;
  }
  return {
    status: 'ok' as const,
    period: result.period,
    generatedCount: result.generated.length,
    errorCount: result.errors.length,
    failed: result.errors.length,
    errorCodes: result.errors.length > 0 ? ['BillGenerationIncomplete'] : [],
  };
}

export async function runOutsourceOverdueTask(
  runDate: string,
  fence?: ExecutionFence,
) {
  const rows = await getOverdueOutsourcing();
  // spreadIndex：批量扇出按序摊开 availableAt，别把整批同时怼向企业微信
  // 的 20 条/分钟限额（见 lib/background-jobs/notification.ts）。
  for (const [index, row] of rows.entries()) {
    await assertExecutionFence(fence);
    await dispatchNotification(
      'OUTSOURCE_OVERDUE',
      {
        outsourceId: row.id,
        supplierName: row.supplierName,
        orderNo: row.orderNo,
        daysOverdue: row.daysOverdue,
        expectedDate: formatDateShanghai(row.expectedDate),
      },
      {
        dedupeKey: `notification:OUTSOURCE_OVERDUE:${runDate}:${row.id}`,
        spreadIndex: index,
      },
    );
  }
  return { status: 'ok' as const, overdueCount: rows.length };
}

export async function runOrderOverdueTask(
  runDate: string,
  fence?: ExecutionFence,
) {
  // 「只推逾期」由 scanOverdueOrders 在 SQL 层保证（promisedDate <
  // 今日上海日界）。以前这里取的是看板那份「逾期 + 3 天内到期」的无界
  // 结果再在 JS 里 filter，等于把 due-soon 的行白搬一趟，还把看板的
  // 无界查询绑在了推送上。
  const { rows, truncated } = await scanOverdueOrders();
  if (truncated) {
    // 只打计数：工单号 / 客户名不能进进程日志（和 logPartialBatchProgress
    // 同一条纪律）。
    console.error('[cron:order-overdue] overdue backlog exceeds notify cap:', {
      cap: ORDER_OVERDUE_NOTIFY_CAP,
      dispatched: rows.length,
    });
  }
  for (const [index, row] of rows.entries()) {
    await assertExecutionFence(fence);
    await dispatchNotification(
      'ORDER_OVERDUE',
      {
        orderId: row.id,
        orderNo: row.orderNo,
        externalSalesName: row.externalSalesName ?? '未填',
        customerRef: row.customerRef ?? '未填',
        promisedDate: formatDateShanghai(row.promisedDate),
        daysOverdue: row.daysOverdue,
        status: orderStatusZh(row.status),
      },
      {
        // 逾期单最多 ORDER_OVERDUE_NOTIFY_CAP=200 条，是全仓最大的一次扇出，
        // 也是最需要按序摊开的一处。
        dedupeKey: `notification:ORDER_OVERDUE:${runDate}:${row.id}`,
        spreadIndex: index,
      },
    );
  }
  // truncated 是对既有响应形状的**新增**字段（§15.4：响应形状是对外部
  // 调度器的契约——只加不减、不改名）。加它是为了让「今天有单没推到」
  // 在调度器日志里看得见，而不是只能靠翻 stderr。
  return { status: 'ok' as const, overdueCount: rows.length, truncated };
}

export async function runOrderExportCleanupTask(
  runDate: string,
  fence?: ExecutionFence,
) {
  await assertExecutionFence(fence);
  const scrubbedFilterCount = await scrubTerminalOrderExportFilters();
  await assertExecutionFence(fence);
  const expiredCount = await cleanupExpiredOrderExports();
  await assertExecutionFence(fence);
  const agentBillScrubbedFilterCount =
    await scrubTerminalAgentMonthlyBillExportFilters();
  await assertExecutionFence(fence);
  const agentBillExpiredCount =
    await cleanupExpiredAgentMonthlyBillExports();
  return {
    status: 'ok' as const,
    runDate,
    expiredCount,
    scrubbedFilterCount,
    agentBillExpiredCount,
    agentBillScrubbedFilterCount,
  };
}
