import { Role } from '../../generated/prisma/enums';
import {
  BillGenerationUnexpectedError,
  generateBillsForPeriod,
  type BillGenerationResult,
} from '../bill';
import { db } from '../db';
import { formatMoneyPlain } from '../dashboard/format';
import {
  getEndingPeriods,
  getOverdueOutsourcing,
} from '../dashboard/owner-watchlist';
import { formatDateShanghai } from '../format/dates';
import { dispatchNotification } from '../notification/dispatch';
import {
  dailySalaryNotificationKey,
  getOrCreateDailySalaryRoster,
  prepareDailySalarySummary,
  readDailySalaryRunCheckpoint,
} from './daily-salary-summary';
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
  CsBatchUnexpectedError,
  settleReadyCsPeriods,
  type BatchSettleResult,
  type SettledCommission,
} from '../salary/cs';
import {
  computeDailyForAllMachineWorkers,
  DailyBatchUnexpectedError,
  type BatchDailyResult,
} from '../salary/daily';
import {
  computeHourlyForAllInMonth,
  HourlyBatchUnexpectedError,
  type BatchHourlyResult,
} from '../salary/hourly-aggregate';

function logPartialBatchProgress(
  task: 'daily-salary' | 'hourly-payroll' | 'generate-bills',
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
  const checkpoint = await readDailySalaryRunCheckpoint(date);
  if (checkpoint) {
    return {
      status: 'ok' as const,
      date,
      workerCount: checkpoint.workerCount,
      errorCount: 0,
    };
  }

  const roster = await getOrCreateDailySalaryRoster(date, fence);

  let unexpected: DailyBatchUnexpectedError | null = null;
  let result: BatchDailyResult;
  try {
    result = await computeDailyForAllMachineWorkers(
      date,
      undefined,
      fence,
      true,
      roster,
    );
  } catch (error) {
    if (!(error instanceof DailyBatchUnexpectedError)) throw error;
    unexpected = error;
    result = error.partialResult;
  }
  const { settled, errors } = result;
  if (unexpected) {
    logPartialBatchProgress('daily-salary', settled.length, errors.length);
    // DAILY_WORKER_SALARY is one aggregate notification per date. Enqueuing a
    // partial aggregate would consume its dedupe key and suppress the complete
    // summary on retry, so leave partial progress to counts-only observability.
    throw unexpected;
  }
  if (errors.length > 0) {
    logPartialBatchProgress('daily-salary', settled.length, errors.length);
    throw new DailySalaryBatchIncompleteError(result);
  }

  const summary = await prepareDailySalarySummary(date, roster, fence);
  if (summary.workerCount > 0 && !summary.notificationQueued) {
    await dispatchNotification(
      'DAILY_WORKER_SALARY',
      {
        date,
        workerCount: summary.workerCount,
        totalAmount: summary.totalAmount,
      },
      { dedupeKey: dailySalaryNotificationKey(date) },
    );
  }
  return {
    status: 'ok' as const,
    date,
    workerCount: summary.workerCount,
    errorCount: 0,
  };
}

export class DailySalaryBatchIncompleteError extends Error {
  readonly partialResult: BatchDailyResult;

  constructor(partialResult: BatchDailyResult) {
    super('daily salary batch contains unresolved worker errors');
    this.name = 'DailySalaryBatchIncompleteError';
    this.partialResult = partialResult;
  }
}

export async function runHourlyPayrollTask(month: string, fence?: ExecutionFence) {
  let unexpected: HourlyBatchUnexpectedError | null = null;
  let result: BatchHourlyResult;
  try {
    result = await computeHourlyForAllInMonth(month, undefined, fence);
  } catch (error) {
    if (!(error instanceof HourlyBatchUnexpectedError)) throw error;
    unexpected = error;
    result = error.partialResult;
  }
  const { settled, errors } = result;
  if (unexpected) {
    logPartialBatchProgress('hourly-payroll', settled.length, errors.length);
    throw unexpected;
  }
  return {
    status: 'ok' as const,
    month,
    workerCount: settled.length,
    errorCount: errors.length,
  };
}

async function dispatchCsSettlementNotifications(
  settled: SettledCommission[],
  fence?: ExecutionFence,
): Promise<void> {
  const needsPostCommitDispatch = settled.filter(
    (row) => !row.notificationQueued,
  );
  if (needsPostCommitDispatch.length > 0) {
    const csIds = Array.from(
      new Set(needsPostCommitDispatch.map((row) => row.csUserId)),
    );
    // The name is presentation-only. A settlement may already be committed
    // when this best-effort lookup runs, so a transient read failure must not
    // prevent its durable, deduplicated notification from being enqueued.
    // Falling back to the immutable user id also preserves the original batch
    // failure below, which is the error the worker must retry and report.
    const users = await db.user
      .findMany({
        where: { id: { in: csIds } },
        select: { id: true, displayName: true },
      })
      .catch((error: unknown) => {
        console.error(
          '[cs-settle] user display-name lookup failed; using user ids:',
          error instanceof Error ? error.name : 'UnknownError',
        );
        return [];
      });
    const nameById = new Map(users.map((user) => [user.id, user.displayName]));
    for (const row of needsPostCommitDispatch) {
      await assertExecutionFence(fence);
      await dispatchNotification(
        'CS_PERIOD_SETTLED',
        {
          settledCount: 1,
          csName: nameById.get(row.csUserId) ?? row.csUserId,
          totalSales: formatMoneyPlain(row.totalSales),
          commission: formatMoneyPlain(row.commissionAmount),
        },
        {
          dedupeKey: `notification:CS_PERIOD_SETTLED:${row.periodId}`,
        },
      );
    }
  }
}

export async function runCsSettleTask(fence?: ExecutionFence) {
  let unexpected: CsBatchUnexpectedError | null = null;
  let result: BatchSettleResult;
  try {
    result = await settleReadyCsPeriods(undefined, undefined, fence);
  } catch (error) {
    if (!(error instanceof CsBatchUnexpectedError)) throw error;
    unexpected = error;
    result = error.partialResult;
  }
  const { settled, errors } = result;
  await dispatchCsSettlementNotifications(settled, fence);
  // The successful rows are already committed and their deduplicated
  // notifications have now been queued. Rethrow so Sentry and the durable job
  // retry the unprocessed tail rather than silently marking a partial run OK.
  if (unexpected) throw unexpected;
  return {
    status: 'ok' as const,
    settledCount: settled.length,
    errorCount: errors.length,
  };
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
export async function runCsPeriodEndingTask(
  runDate: string,
  fence?: ExecutionFence,
) {
  const rows = await getEndingPeriods();
  for (const [index, row] of rows.entries()) {
    await assertExecutionFence(fence);
    await dispatchNotification(
      'CS_PERIOD_ENDING',
      {
        periodId: row.id,
        csName: row.csDisplayName,
        daysLeft: row.daysUntilEnd,
        totalSales: formatMoneyPlain(row.salesForTier),
      },
      {
        dedupeKey: `notification:CS_PERIOD_ENDING:${runDate}:${row.id}`,
        spreadIndex: index,
      },
    );
  }
  return { status: 'ok' as const, endingCount: rows.length };
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
  return {
    status: 'ok' as const,
    runDate,
    expiredCount,
    scrubbedFilterCount,
  };
}
