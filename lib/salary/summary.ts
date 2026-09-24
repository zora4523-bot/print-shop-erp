import Decimal from 'decimal.js';
import {
  PieceworkSettlementStatus,
  SalaryPeriodStatus,
} from '../../generated/prisma/enums';
import { db } from '../db';
import { currentShanghaiMonth, todayShanghai } from '../dashboard/shanghai-clock';
import { shanghaiDayRange } from './daily-common';

// Read-only aggregates for the owner's salary index page. Every query
// here is a sum over existing tables — no new state, no writes. Kept
// out of lib/salary/daily.ts and lib/salary/cs.ts so imports stay
// one-directional (daily / cs are sources; summary is a consumer).

export type SalaryIndexSummary = {
  today: string;
  currentMonth: string;
  // 新工序报工账本：与旧 DailyWorkerSalary 物理分查、分展示。
  pieceworkToday: {
    count: number;
    payableTotal: string;
    unpaidTotal: string;
  };
  pieceworkUnpaidAllTime: {
    count: number;
    payableTotal: string;
  };
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
  // 已结算客服周期（剩余底薪 + 提成未发放合计）
  csUnpaid: {
    count: number;
    totalIncome: string;
  };
  // 待结算周期：periodEnd < now 但 status=IN_PROGRESS 的个数
  csReadyToSettle: number;
  // 客服活跃周期统计：每位客服一条 IN_PROGRESS
  csActivePeriods: number;
};

export async function getSalaryIndexSummary(
  now: Date = new Date(),
): Promise<SalaryIndexSummary> {
  const today = todayShanghai(now);
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

  const month = currentShanghaiMonth(now);
  // Every total below is computed by PostgreSQL. The old shape pulled
  // whole unpaid ledgers into Node just to reduce them, which grows
  // without bound as unpaid rows accumulate.
  const [
    pieceworkTodayGroups,
    pieceworkUnpaidAgg,
    dailyTodayGroups,
    dailyUnpaidAgg,
    csUnpaidAgg,
    csReadyCount,
    csActiveCount,
  ] = await Promise.all([
    db.pieceworkSettlement.groupBy({
      by: ['status'],
      where: { workDate: todayDateCol },
      _count: { _all: true },
      _sum: { payableAmount: true },
    }),
    db.pieceworkSettlement.aggregate({
      where: { status: { not: PieceworkSettlementStatus.PAID } },
      _count: { _all: true },
      _sum: { payableAmount: true },
    }),
    // One scan of today's rows, split into the paid / unpaid buckets the
    // card needs. At most two groups come back.
    db.dailyWorkerSalary.groupBy({
      by: ['isPaid'],
      where: { date: todayDateCol },
      _count: { _all: true },
      _sum: { actualSalary: true },
    }),
    db.dailyWorkerSalary.aggregate({
      where: { isPaid: false },
      _count: { _all: true },
      _sum: { actualSalary: true },
    }),
    // The card wants SUM(base - paidBase + commission - paidCommission).
    // Summation is linear, so the per-row combination is identical to
    // combining the four column sums, and each column sum is exact
    // numeric arithmetic in PostgreSQL. No per-row clamping exists on
    // this path, so nothing blocks the pushdown.
    db.customerServiceCommission.aggregate({
      where: { isFullyPaid: false },
      _count: { _all: true },
      _sum: {
        monthlyBaseTotal: true,
        commissionAmount: true,
        paidBase: true,
        paidCommission: true,
      },
    }),
    db.salaryPeriod.count({
      where: {
        status: SalaryPeriodStatus.IN_PROGRESS,
        // SalaryPeriod.periodEnd is an inclusive PostgreSQL DATE. It becomes
        // due only when the Shanghai calendar has advanced to the next day;
        // comparing it with a timestamp would mark it due during its final day.
        periodEnd: { lt: todayDateCol },
      },
    }),
    db.salaryPeriod.count({
      where: { status: SalaryPeriodStatus.IN_PROGRESS },
    }),
  ]);

  const dailyToday = foldPaidGroups(
    dailyTodayGroups,
    (group) => group._sum.actualSalary,
  );
  const csUnpaidTotal = decimalFromSum(csUnpaidAgg._sum.monthlyBaseTotal)
    .minus(decimalFromSum(csUnpaidAgg._sum.paidBase))
    .plus(decimalFromSum(csUnpaidAgg._sum.commissionAmount))
    .minus(decimalFromSum(csUnpaidAgg._sum.paidCommission));
  let pieceworkTodayCount = 0;
  let pieceworkTodayTotal = new Decimal(0);
  let pieceworkTodayUnpaid = new Decimal(0);
  for (const group of pieceworkTodayGroups) {
    const amount = decimalFromSum(group._sum.payableAmount);
    pieceworkTodayCount += group._count._all;
    pieceworkTodayTotal = pieceworkTodayTotal.plus(amount);
    if (group.status !== PieceworkSettlementStatus.PAID) {
      pieceworkTodayUnpaid = pieceworkTodayUnpaid.plus(amount);
    }
  }

  return {
    today,
    currentMonth: month,
    pieceworkToday: {
      count: pieceworkTodayCount,
      payableTotal: pieceworkTodayTotal.toFixed(2),
      unpaidTotal: pieceworkTodayUnpaid.toFixed(2),
    },
    pieceworkUnpaidAllTime: {
      count: pieceworkUnpaidAgg._count._all,
      payableTotal: decimalFromSum(
        pieceworkUnpaidAgg._sum.payableAmount,
      ).toFixed(2),
    },
    dailyToday: {
      count: dailyToday.count,
      actualTotal: dailyToday.total.toFixed(2),
      unpaidTotal: dailyToday.unpaid.toFixed(2),
    },
    dailyUnpaidAllTime: {
      count: dailyUnpaidAgg._count._all,
      actualTotal: decimalFromSum(dailyUnpaidAgg._sum.actualSalary).toFixed(2),
    },
    csUnpaid: {
      count: csUnpaidAgg._count._all,
      totalIncome: csUnpaidTotal.toFixed(2),
    },
    csReadyToSettle: csReadyCount,
    csActivePeriods: csActiveCount,
  };
}

// Collapse the `by: ['isPaid']` buckets into the three numbers the card
// shows. At most two rows, so this stays O(1) regardless of table size.
function foldPaidGroups<T extends { isPaid: boolean; _count: { _all: number } }>(
  groups: readonly T[],
  amountOf: (group: T) => unknown,
): { count: number; total: Decimal; unpaid: Decimal } {
  let count = 0;
  let total = new Decimal(0);
  let unpaid = new Decimal(0);
  for (const group of groups) {
    const amount = decimalFromSum(amountOf(group));
    count += group._count._all;
    total = total.plus(amount);
    if (!group.isPaid) unpaid = unpaid.plus(amount);
  }
  return { count, total, unpaid };
}

// SUM over a Decimal column comes back as a Prisma Decimal, or null when
// the filter matched no rows. Prisma Decimal is opaque to TS here, so we
// go through its decimal string: never Number(), never a float.
function decimalFromSum(value: unknown): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  return new Decimal(String(value));
}
