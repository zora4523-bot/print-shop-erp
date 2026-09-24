import Decimal from 'decimal.js';
import { PieceworkSettlementStatus } from '../../generated/prisma/enums';
import { db } from '../db';
import { currentShanghaiMonth, todayShanghai } from '../dashboard/shanghai-clock';
import { shanghaiDayRange } from './daily-common';

// Read-only aggregates for the owner's salary index page. Every query
// here is a sum over existing tables — no new state, no writes. Kept
// out of lib/salary/daily.ts so imports stay one-directional (daily is a
// source; summary is a consumer).

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
  ]);

  const dailyToday = foldPaidGroups(
    dailyTodayGroups,
    (group) => group._sum.actualSalary,
  );
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
