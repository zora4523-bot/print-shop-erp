import Decimal from 'decimal.js';
import { AgentMonthlyBillStatus } from '../../generated/prisma/enums';
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
 * 当月账单：已发的部分（ISSUED / PARTIAL_PAID / FULLY_PAID）的总额、已
 * 收、应收差额。
 *
 * 与 /owner/bills 的口径对齐（appel/(admin)/owner/bills/page.tsx 注释
 * 明示&ldquo;DRAFT 未发单不算应收&rdquo;）——dashboard 把
 * DRAFT 也算进来会让&ldquo;一生成账单数字就跳&rdquo;，与发单页不一致。DRAFT
 * 是&ldquo;未对外&rdquo;的草稿期，不应进应收。
 *
 * 聚合交给数据库，避免把当月全部账单行搬回 Node；Prisma Decimal 转成
 * 字符串后再交给 Decimal.js 做 outstanding，始终不经过 JS Number。
 */
export async function getMonthlyBillStats(
  now: Date = new Date(),
): Promise<MonthlyBillStats> {
  const month = currentShanghaiMonth(now);
  const [aggregation, receipts] = await Promise.all([
    db.agentMonthlyBill.aggregate({
      where: {
        period: month,
        status: {
          in: [AgentMonthlyBillStatus.CONFIRMED, AgentMonthlyBillStatus.PAID],
        },
      },
      _sum: { totalAmount: true },
    }),
    db.agentMonthlyBillReceipt.aggregate({
      where: { bill: { period: month, status: AgentMonthlyBillStatus.PAID } },
      _sum: { amount: true },
    }),
  ]);

  const total = new Decimal(aggregation._sum.totalAmount?.toString() ?? '0');
  const paid = new Decimal(receipts._sum.amount?.toString() ?? '0');
  const outstanding = total.minus(paid);

  return {
    month,
    total: total.toFixed(2),
    paid: paid.toFixed(2),
    outstanding: outstanding.toFixed(2),
  };
}
