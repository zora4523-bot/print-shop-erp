import Decimal from 'decimal.js';
import { db } from '../db';
import {
  currentShanghaiMonth,
  shanghaiDayBoundary,
  todayShanghai,
} from './shanghai-clock';

// Read-only KPIs for the owner dashboard. Two top-level helpers:
//   - getTodayOrderStats(now)   → 4 counters around today's order flow
//   - getMonthlyBillStats(now)  → totals for the current Shanghai month
//
// All money returned as plain decimal-string ("0.00") so server →
// client serialization is safe (Decimal can't cross the wire).

export type TodayOrderStats = {
  date: string; // YYYY-MM-DD (Asia/Shanghai)
  submittedToday: number;
  urgentSubmittedToday: number;
  completedToday: number;
  completedYesterday: number;
  shippedToday: number;
};

export type MonthlyBillStats = {
  month: string; // YYYY-MM
  total: string; // 千分位 已交给 UI；这里只到 toFixed(2)
  paid: string;
  outstanding: string;
};

/**
 * 4 indices from a single Promise.all over today (and yesterday for
 * completedToday's diff). Each subquery is a `count` against an
 * indexed timestamp range — Prisma compiles to a simple `>= AND <`
 * predicate, no SQL gymnastics.
 *
 * `completedYesterday` lets the UI compute a same-window diff (`今日
 * vs 昨日`) without needing a second round-trip.
 */
export async function getTodayOrderStats(
  now: Date = new Date(),
): Promise<TodayOrderStats> {
  const today = todayShanghai(now);
  const { start: todayStart, end: todayEnd } = shanghaiDayBoundary(today);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayEnd = todayStart;

  const [
    submittedToday,
    urgentSubmittedToday,
    completedToday,
    completedYesterday,
    shippedToday,
  ] = await Promise.all([
    db.order.count({
      where: { submittedAt: { gte: todayStart, lt: todayEnd } },
    }),
    db.order.count({
      where: {
        submittedAt: { gte: todayStart, lt: todayEnd },
        isUrgent: true,
      },
    }),
    db.order.count({
      where: { completedAt: { gte: todayStart, lt: todayEnd } },
    }),
    db.order.count({
      where: { completedAt: { gte: yesterdayStart, lt: yesterdayEnd } },
    }),
    db.order.count({
      where: { shippedAt: { gte: todayStart, lt: todayEnd } },
    }),
  ]);

  return {
    date: today,
    submittedToday,
    urgentSubmittedToday,
    completedToday,
    completedYesterday,
    shippedToday,
  };
}

/**
 * 当月账单总额 / 已收 / 应收。不区分 BillStatus —— DRAFT 也算 pipeline
 * 的一部分；&ldquo;outstanding&rdquo; 数字本身承担 paid vs total 的视觉信号。
 *
 * 用 sumDecimal 而不是 prisma `_sum`：3+ 张账单累加用 JS Number 会
 * 漂移分级精度（0.1 + 0.2 经典坑），Decimal.js 才是数值正确的来源。
 */
export async function getMonthlyBillStats(
  now: Date = new Date(),
): Promise<MonthlyBillStats> {
  const month = currentShanghaiMonth(now);
  const bills = await db.bill.findMany({
    where: { period: month },
    select: { totalAmount: true, paidAmount: true },
  });

  const total = sumDecimal(bills.map((b) => b.totalAmount));
  const paid = sumDecimal(bills.map((b) => b.paidAmount));
  const outstanding = total.minus(paid);

  return {
    month,
    total: total.toFixed(2),
    paid: paid.toFixed(2),
    outstanding: outstanding.toFixed(2),
  };
}

// Same shape as lib/salary/summary.ts:sumDecimal — duplicated here
// instead of importing because that module pulls Prisma + the salary
// module's full type surface, and dashboard helpers should stay
// thin. If a third callsite shows up we'll promote to lib/utils.
function sumDecimal(values: readonly unknown[]): Decimal {
  return values.reduce<Decimal>(
    (acc, v) => acc.plus(new Decimal(v as Decimal.Value)),
    new Decimal(0),
  );
}
