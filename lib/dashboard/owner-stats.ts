import Decimal from 'decimal.js';
import { AgentMonthlyBillStatus } from '../../generated/prisma/enums';
import { agentBillPeriodRange } from '../agent-monthly-billing/period';
import { db } from '../db';
import {
  currentShanghaiMonth,
  shanghaiDayBoundary,
  todayShanghai,
} from './shanghai-clock';

// Read-only KPIs for the owner dashboard. Two top-level helpers:
//   - getTodayOrderStats(now)   → 4 counters around today's order flow
//   - getMonthlyBillStats(now)  → 本月出账 / 本月收款 / 当前待收款
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
  total: string; // 本月确认出账；千分位交给 UI，这里只到 toFixed(2)
  paid: string; // 本月收款
  outstanding: string; // 当前全部待收款（不限账期）
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
 * 老板首页「本月已出账金额」卡片（业主 2026-09-23 拍板的口径，M-8）：
 *
 * - total：确认时间（confirmedAt）落在上海本月的代理商月度账单总额，
 *   状态为已确认或已收。v2 只能为已结束的月份出账，账期（period）永远
 *   早于本月，所以不能按「账期 = 本月」统计——那是结构上的空集。
 * - paid：收款时间（receivedAt）落在上海本月的收款合计，不论账单何时确认。
 * - outstanding：当前所有已确认、尚未收款的账单总额，不限账期；与
 *   /owner/agent-bills 的「待收款」同口径。v2 没有部分收款，整单结清。
 *
 * 三个数各自独立，不再满足 outstanding = total - paid。草稿账单不算出账
 * 也不算待收。聚合交给数据库；Prisma Decimal 转字符串后交给 Decimal.js，
 * 始终不经过 JS Number。
 */
export async function getMonthlyBillStats(
  now: Date = new Date(),
): Promise<MonthlyBillStats> {
  const month = currentShanghaiMonth(now);
  const { start, end } = agentBillPeriodRange(month);
  const [confirmedThisMonth, receivedThisMonth, receivable] = await Promise.all([
    db.agentMonthlyBill.aggregate({
      where: {
        status: {
          in: [AgentMonthlyBillStatus.CONFIRMED, AgentMonthlyBillStatus.PAID],
        },
        confirmedAt: { gte: start, lt: end },
      },
      _sum: { totalAmount: true },
    }),
    db.agentMonthlyBillReceipt.aggregate({
      where: { receivedAt: { gte: start, lt: end } },
      _sum: { amount: true },
    }),
    db.agentMonthlyBill.aggregate({
      where: { status: AgentMonthlyBillStatus.CONFIRMED },
      _sum: { totalAmount: true },
    }),
  ]);

  return {
    month,
    total: sumToFixed(confirmedThisMonth._sum.totalAmount),
    paid: sumToFixed(receivedThisMonth._sum.amount),
    outstanding: sumToFixed(receivable._sum.totalAmount),
  };
}

function sumToFixed(value: { toString(): string } | null | undefined): string {
  return new Decimal(value?.toString() ?? '0').toFixed(2);
}
