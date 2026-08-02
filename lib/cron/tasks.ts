import Decimal from 'decimal.js';
import { Role } from '../../generated/prisma/enums';
import {
  BillGenerationUnexpectedError,
  generateBillsForPeriod,
  type BillGenerationResult,
} from '../bill';
import { db } from '../db';
import { formatMoneyPlain } from '../dashboard/format';
import {
  getDueOrders,
  getEndingPeriods,
  getOverdueOutsourcing,
} from '../dashboard/owner-watchlist';
import { formatDateShanghai } from '../format/dates';
import { dispatchNotification } from '../notification/dispatch';
import { orderStatusZh } from '../order/log-format';
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

export async function runDailySalaryTask(date: string) {
  let unexpected: DailyBatchUnexpectedError | null = null;
  let result: BatchDailyResult;
  try {
    result = await computeDailyForAllMachineWorkers(date);
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
  if (settled.length > 0) {
    const totalAmount = settled
      .reduce<Decimal>(
        (sum, row) => sum.plus(new Decimal(row.actualSalary)),
        new Decimal(0),
      )
      .toFixed(2);
    await dispatchNotification(
      'DAILY_WORKER_SALARY',
      {
        date,
        workerCount: settled.length,
        totalAmount: formatMoneyPlain(totalAmount),
      },
      { dedupeKey: `notification:DAILY_WORKER_SALARY:${date}` },
    );
  }
  return {
    status: 'ok' as const,
    date,
    workerCount: settled.length,
    errorCount: errors.length,
  };
}

export async function runHourlyPayrollTask(month: string) {
  let unexpected: HourlyBatchUnexpectedError | null = null;
  let result: BatchHourlyResult;
  try {
    result = await computeHourlyForAllInMonth(month);
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
): Promise<void> {
  if (settled.length > 0) {
    const csIds = Array.from(new Set(settled.map((row) => row.csUserId)));
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
    for (const row of settled) {
      await dispatchNotification(
        'CS_PERIOD_SETTLED',
        {
          settledCount: settled.length,
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

export async function runCsSettleTask() {
  let unexpected: CsBatchUnexpectedError | null = null;
  let result: BatchSettleResult;
  try {
    result = await settleReadyCsPeriods();
  } catch (error) {
    if (!(error instanceof CsBatchUnexpectedError)) throw error;
    unexpected = error;
    result = error.partialResult;
  }
  const { settled, errors } = result;
  await dispatchCsSettlementNotifications(settled);
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

export async function runGenerateBillsTask(period: string) {
  let unexpected: BillGenerationUnexpectedError | null = null;
  let result: BillGenerationResult;
  try {
    result = await generateBillsForPeriod(period, {
      id: 'system',
      role: Role.ADMIN,
    });
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

export async function runOutsourceOverdueTask(runDate: string) {
  const rows = await getOverdueOutsourcing();
  for (const row of rows) {
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
      },
    );
  }
  return { status: 'ok' as const, overdueCount: rows.length };
}
export async function runCsPeriodEndingTask(runDate: string) {
  const rows = await getEndingPeriods();
  for (const row of rows) {
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
      },
    );
  }
  return { status: 'ok' as const, endingCount: rows.length };
}

export async function runOrderOverdueTask(runDate: string) {
  const rows = (await getDueOrders()).filter((row) => row.daysLeft < 0);
  for (const row of rows) {
    await dispatchNotification(
      'ORDER_OVERDUE',
      {
        orderId: row.id,
        orderNo: row.orderNo,
        customerRef: row.customerRef ?? '未填',
        promisedDate: formatDateShanghai(row.promisedDate),
        daysOverdue: -row.daysLeft,
        status: orderStatusZh(row.status),
      },
      {
        dedupeKey: `notification:ORDER_OVERDUE:${runDate}:${row.id}`,
      },
    );
  }
  return { status: 'ok' as const, overdueCount: rows.length };
}
