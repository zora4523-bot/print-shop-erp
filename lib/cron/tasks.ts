import Decimal from 'decimal.js';
import { Role } from '../../generated/prisma/enums';
import { generateBillsForPeriod } from '../bill';
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
import { settleReadyCsPeriods } from '../salary/cs';
import { computeDailyForAllMachineWorkers } from '../salary/daily';
import { computeHourlyForAllInMonth } from '../salary/hourly-aggregate';

export async function runDailySalaryTask(date: string) {
  const { settled, errors } = await computeDailyForAllMachineWorkers(date);
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
  const { settled, errors } = await computeHourlyForAllInMonth(month);
  return {
    status: 'ok' as const,
    month,
    workerCount: settled.length,
    errorCount: errors.length,
  };
}

export async function runCsSettleTask() {
  const { settled, errors } = await settleReadyCsPeriods();
  if (settled.length > 0) {
    const csIds = Array.from(new Set(settled.map((row) => row.csUserId)));
    const users = await db.user.findMany({
      where: { id: { in: csIds } },
      select: { id: true, displayName: true },
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
  return {
    status: 'ok' as const,
    settledCount: settled.length,
    errorCount: errors.length,
  };
}

export async function runGenerateBillsTask(period: string) {
  const result = await generateBillsForPeriod(period, {
    id: 'system',
    role: Role.OWNER,
  });
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
