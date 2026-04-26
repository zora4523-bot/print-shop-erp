import Decimal from 'decimal.js';
import {
  OrderStatus,
  OutsourceStatus,
  Role,
  SalaryPeriodStatus,
} from '../../generated/prisma/enums';
import { db } from '../db';
import { calcCsCommission } from '../salary/cs-commission';
import { getActiveCsTiers } from '../salary/rules';
import { shanghaiDayBoundary, todayShanghai } from './shanghai-clock';

// Owner dashboard watchlists — 3 read-only lists that surface things
// the owner needs to do or notice "right now":
//
//   - getPendingShipments — COMPLETED orders waiting to ship
//   - getOverdueOutsourcing — outsource orders past expectedDate
//   - getEndingPeriods — CS salary periods with periodEnd in the
//                        next 7 days (with predicted commission)
//
// Each function returns plain JSON-serialisable rows; Decimal columns
// are always handed to the caller as strings (`.toFixed(2)`). Page-
// level rendering only does presentation.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────
// 待发货 — COMPLETED 工单按 (急单优先, 完工时间正序) 排列
// ─────────────────────────────────────────────────────────────────────

export type PendingShipmentRow = {
  id: string;
  orderNo: string;
  customerRef: string | null;
  isUrgent: boolean;
  completedAt: Date;
  submitterDisplayName: string;
};

export type PendingShipmentsResult = {
  rows: PendingShipmentRow[];
  hasMore: boolean;
};

/**
 * 完工但未发货的工单。SHIPPED / FINISHED / CANCELLED 不算（COMPLETED
 * 是&ldquo;待发货&rdquo;唯一状态——见 lib/order/status-machine.ts）。急单优先，
 * 同优先级里完工早的排前面（&ldquo;最该催的在最上&rdquo;）。
 *
 * `take: limit + 1` 是&ldquo;hasMore&rdquo; 探针：取 11 条，前 10 条入 rows，
 * 第 11 条只判断"有没有"，不入返回。UI 据此渲染&ldquo;查看全部 →&rdquo;。
 */
export async function getPendingShipments(
  _now: Date = new Date(),
  limit = 10,
): Promise<PendingShipmentsResult> {
  void _now;
  const raw = await db.order.findMany({
    where: { status: OrderStatus.COMPLETED },
    orderBy: [{ isUrgent: 'desc' }, { completedAt: 'asc' }],
    take: limit + 1,
    select: {
      id: true,
      orderNo: true,
      customerRef: true,
      isUrgent: true,
      completedAt: true,
      submitter: { select: { displayName: true } },
    },
  });

  const rows: PendingShipmentRow[] = raw.slice(0, limit).map((r) => ({
    id: r.id,
    orderNo: r.orderNo,
    customerRef: r.customerRef,
    isUrgent: r.isUrgent,
    // status=COMPLETED guarantees completedAt is set (status-machine
    // always stamps it on transition); narrow the type for downstream.
    completedAt: r.completedAt as Date,
    submitterDisplayName: r.submitter.displayName,
  }));

  return { rows, hasMore: raw.length > limit };
}

// ─────────────────────────────────────────────────────────────────────
// 超期外协 — expectedDate < 今日 0:00 (Shanghai) 且仍未收
// ─────────────────────────────────────────────────────────────────────

export type OverdueOutsourceRow = {
  id: string;
  supplierName: string;
  expectedDate: Date;
  status: OutsourceStatus;
  orderNo: string | null;
  daysOverdue: number;
};

/**
 * 超期外协：状态在 SENT / IN_PROGRESS（未收），expectedDate < 今日
 * Shanghai 0:00（不含今日）。`expectedDate = null` 不算（用户没填的
 * 单不发噪音）。RECEIVED / CANCELLED 已闭环，不算。
 *
 * `daysOverdue` 在 JS 侧算（schema 没存）：Math.floor((today - expected)
 * / 1day)。expected = today 不出现在结果里（半开区间），所以最少
 * 1 天。
 */
export async function getOverdueOutsourcing(
  now: Date = new Date(),
): Promise<OverdueOutsourceRow[]> {
  const today = todayShanghai(now);
  const { start: todayStart } = shanghaiDayBoundary(today);

  const raw = await db.outsourceOrder.findMany({
    where: {
      status: { in: [OutsourceStatus.SENT, OutsourceStatus.IN_PROGRESS] },
      expectedDate: { lt: todayStart },
      NOT: { expectedDate: null },
    },
    orderBy: { expectedDate: 'asc' },
    select: {
      id: true,
      supplierName: true,
      expectedDate: true,
      status: true,
      order: { select: { orderNo: true } },
    },
  });

  return raw.map((r) => ({
    id: r.id,
    supplierName: r.supplierName,
    expectedDate: r.expectedDate as Date,
    status: r.status,
    orderNo: r.order?.orderNo ?? null,
    daysOverdue: Math.floor(
      (todayStart.getTime() - (r.expectedDate as Date).getTime()) / MS_PER_DAY,
    ),
  }));
}

// ─────────────────────────────────────────────────────────────────────
// 即将结算客服周期 — periodEnd ∈ [今日, 今日+7d)，按结束日正序
// ─────────────────────────────────────────────────────────────────────

export type EndingPeriodRow = {
  id: string;
  csUserId: string;
  csDisplayName: string;
  periodStart: Date;
  periodEnd: Date;
  durationMonths: number;
  totalSales: string;
  initialSales: string;
  monthlyBase: string;
  daysUntilEnd: number;
  // null = 找不到生效中的 tier 规则（极少见，UI 显示&ldquo;—&rdquo;不崩）
  predictedCommission: string | null;
  predictedTotalIncome: string | null;
  predictedBelowAllTiers: boolean | null;
};

/**
 * 7 天内结算的客服周期。periodEnd ∈ [今日 Shanghai 0:00, 今日 + 7d)，
 * status = IN_PROGRESS。预测金额：用 `totalSales + initialSales` 走
 * `calcCsCommission`，得到 commission；底薪合计 = monthlyBase ×
 * durationMonths；预测总收入 = 底薪 + commission。
 *
 * 业绩口径（DECISIONS 2026-04-26 业绩按 submittedAt）：dashboard 视角
 * 的&ldquo;预测&rdquo;就是按当前 SalaryPeriod.totalSales（已由 accumulateCsSales
 * 累加，触发于账单 mark-paid）。这里**不**重新按 submittedAt 算业绩
 * —— totalSales 已经是 ledger of record。dashboard 上&ldquo;按 submittedAt&rdquo;
 * 适用的是 Slice C 的销售排行 / 产品分布，不是这个周期预测。
 */
export async function getEndingPeriods(
  now: Date = new Date(),
): Promise<EndingPeriodRow[]> {
  const today = todayShanghai(now);
  const { start: todayStart } = shanghaiDayBoundary(today);
  const sevenDaysOut = new Date(todayStart.getTime() + 7 * MS_PER_DAY);

  const periods = await db.salaryPeriod.findMany({
    where: {
      status: SalaryPeriodStatus.IN_PROGRESS,
      periodEnd: { gte: todayStart, lt: sevenDaysOut },
    },
    orderBy: { periodEnd: 'asc' },
    select: {
      id: true,
      csUserId: true,
      periodStart: true,
      periodEnd: true,
      durationMonths: true,
      totalSales: true,
      initialSales: true,
      monthlyBase: true,
      csUser: { select: { displayName: true } },
    },
  });

  if (periods.length === 0) return [];

  // 一次取活动 tier；所有 period 共用（dashboard 是 owner 单帧视图，
  // 按当前生效规则预测就够了）。
  const tiers = await getActiveCsTiers(now);

  return periods.map((p) => {
    const totalForCommission = new Decimal(p.totalSales as unknown as Decimal.Value)
      .plus(new Decimal(p.initialSales as unknown as Decimal.Value));
    const monthlyBaseTotal = new Decimal(
      p.monthlyBase as unknown as Decimal.Value,
    ).times(p.durationMonths);

    let predictedCommission: string | null = null;
    let predictedTotalIncome: string | null = null;
    let predictedBelowAllTiers: boolean | null = null;
    if (tiers) {
      const breakdown = calcCsCommission(totalForCommission, tiers);
      predictedCommission = breakdown.commissionAmount.toFixed(2);
      predictedTotalIncome = monthlyBaseTotal
        .plus(breakdown.commissionAmount)
        .toFixed(2);
      predictedBelowAllTiers = breakdown.belowAllTiers;
    }

    return {
      id: p.id,
      csUserId: p.csUserId,
      csDisplayName: p.csUser.displayName,
      periodStart: p.periodStart as Date,
      periodEnd: p.periodEnd as Date,
      durationMonths: p.durationMonths,
      totalSales: new Decimal(
        p.totalSales as unknown as Decimal.Value,
      ).toFixed(2),
      initialSales: new Decimal(
        p.initialSales as unknown as Decimal.Value,
      ).toFixed(2),
      monthlyBase: new Decimal(
        p.monthlyBase as unknown as Decimal.Value,
      ).toFixed(2),
      daysUntilEnd: Math.floor(
        ((p.periodEnd as Date).getTime() - todayStart.getTime()) / MS_PER_DAY,
      ),
      predictedCommission,
      predictedTotalIncome,
      predictedBelowAllTiers,
    };
  });
}

// Re-export the Role enum value used by callers that want to label the
// submitter role on the watchlist (kept here so call-sites don't have
// to drill into generated/prisma).
export { Role };
