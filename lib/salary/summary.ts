import Decimal from 'decimal.js';
import { SalaryPeriodStatus } from '../../generated/prisma/enums';
import { db } from '../db';
import { shanghaiDayRange } from './daily';

// Read-only aggregates for the owner's salary index page. Every query
// here is a sum over existing tables — no new state, no writes. Kept
// out of lib/salary/daily.ts and lib/salary/cs.ts so imports stay
// one-directional (daily / cs are sources; summary is a consumer).

export type SalaryIndexSummary = {
  today: string;
  // 师傅日薪（今天）
  dailyToday: {
    count: number;
    actualTotal: string;
    unpaidTotal: string;
  };
  // 未发放合计（所有日期，汇总未 isPaid 的记录）
  dailyUnpaidAllTime: {
    count: number;
    actualTotal: string;
  };
  // 客服提成（未发放合计）
  csUnpaid: {
    count: number;
    totalIncome: string;
  };
  // 待结算周期：periodEnd < now 但 status=IN_PROGRESS 的个数
  csReadyToSettle: number;
  // 客服活跃周期统计：每位客服一条 IN_PROGRESS
  csActivePeriods: number;
};

function todayShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function getSalaryIndexSummary(
  now: Date = new Date(),
): Promise<SalaryIndexSummary> {
  const today = todayShanghai();
  const { start: todayStart } = shanghaiDayRange(today);
  // `@db.Date` column: stored as UTC midnight, same convention as
  // shanghaiDayRange entry side.
  const todayDateCol = new Date(
    Date.UTC(
      Number(today.slice(0, 4)),
      Number(today.slice(5, 7)) - 1,
      Number(today.slice(8, 10)),
    ),
  );
  void todayStart; // kept for future if we want completed-at windowing

  const [
    dailyTodayRows,
    dailyUnpaidRows,
    csUnpaidRows,
    csReadyCount,
    csActiveCount,
  ] = await Promise.all([
    db.dailyWorkerSalary.findMany({
      where: { date: todayDateCol },
      select: { actualSalary: true, isPaid: true },
    }),
    db.dailyWorkerSalary.findMany({
      where: { isPaid: false },
      select: { actualSalary: true },
    }),
    db.customerServiceCommission.findMany({
      where: { isFullyPaid: false },
      select: { totalIncome: true },
    }),
    db.salaryPeriod.count({
      where: {
        status: SalaryPeriodStatus.IN_PROGRESS,
        periodEnd: { lt: now },
      },
    }),
    db.salaryPeriod.count({
      where: { status: SalaryPeriodStatus.IN_PROGRESS },
    }),
  ]);

  const dailyTodayTotal = sumDecimal(dailyTodayRows.map((r) => r.actualSalary));
  const dailyTodayUnpaid = sumDecimal(
    dailyTodayRows.filter((r) => !r.isPaid).map((r) => r.actualSalary),
  );
  const dailyUnpaidAll = sumDecimal(
    dailyUnpaidRows.map((r) => r.actualSalary),
  );
  const csUnpaidTotal = sumDecimal(csUnpaidRows.map((r) => r.totalIncome));

  return {
    today,
    dailyToday: {
      count: dailyTodayRows.length,
      actualTotal: dailyTodayTotal.toFixed(2),
      unpaidTotal: dailyTodayUnpaid.toFixed(2),
    },
    dailyUnpaidAllTime: {
      count: dailyUnpaidRows.length,
      actualTotal: dailyUnpaidAll.toFixed(2),
    },
    csUnpaid: {
      count: csUnpaidRows.length,
      totalIncome: csUnpaidTotal.toFixed(2),
    },
    csReadyToSettle: csReadyCount,
    csActivePeriods: csActiveCount,
  };
}

// Prisma Decimal is opaque to TS (declared as `unknown` on our raw
// query surface); we funnel through Decimal.js to keep sub-cent
// precision through the sum.
function sumDecimal(values: readonly unknown[]): Decimal {
  return values.reduce<Decimal>(
    (acc, v) => acc.plus(new Decimal(v as Decimal.Value)),
    new Decimal(0),
  );
}
