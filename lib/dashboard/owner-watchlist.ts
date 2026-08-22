import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import {
  OrderStatus,
  OutsourceStatus,
  Role,
  SalaryPeriodStatus,
} from '../../generated/prisma/enums';
import { db } from '../db';
import {
  DUE_SOON_DAYS,
  PROMISE_ALERT_STATUSES,
  promisedDaysLeft,
} from '../order/promised-date';
import { calcCsCommission } from '../salary/cs-commission';
import { getActiveCsTiers } from '../salary/rules';
import { getSetting } from '../settings';
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
// 超期外协 — 逾期天数 >= outsource_overdue_days 且仍未收
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
 * 超期外协：状态在 SENT / IN_PROGRESS（未收），且逾期天数 >= 阈值。
 * `expectedDate = null` 不算（用户没填的单不发噪音）。
 * RECEIVED / CANCELLED 已闭环，不算。
 *
 * 阈值取自 Setting 的 `outsource_overdue_days`（默认 1）。之前这里写死的
 * `expectedDate < todayStart` 恰好等价于阈值 = 1，也就是说 seed 里那行配置
 * 从来只是碰巧和代码一致，改它没有任何效果。
 *
 * `daysOverdue` 在 JS 侧算（schema 没存），走 promisedDaysLeft 的**日历日**
 * 口径。不能直接用 todayStart 减 expectedDate：前者是上海日界（UTC 零点 −8h），
 * 后者由 parseStrictYmd 存成「该日历日的 UTC 零点」，两个锚点差 8 小时，
 * Math.floor 之后恒少 1 天——看板会把逾期 1 天的单显示成「超期 0 天」。
 * 阈值为 N 时，结果里最小的 daysOverdue 就是 N。
 */
export async function getOverdueOutsourcing(
  now: Date = new Date(),
): Promise<OverdueOutsourceRow[]> {
  const today = todayShanghai(now);
  const { start: todayStart } = shanghaiDayBoundary(today);
  const { days: overdueDays } = await getSetting('outsource_overdue_days');

  // daysOverdue >= N  ⟺  expectedDate <= todayStart - N 天
  //                   ⟺  expectedDate <  todayStart - (N-1) 天（日期是整天）
  // N = 1 时退化成原来的 expectedDate < todayStart。
  const cutoff = new Date(todayStart.getTime() - (overdueDays - 1) * MS_PER_DAY);

  const raw = await db.outsourceOrder.findMany({
    where: {
      status: { in: [OutsourceStatus.SENT, OutsourceStatus.IN_PROGRESS] },
      expectedDate: { lt: cutoff },
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

  return raw.map((r) => {
    // promisedDaysLeft 返回「还剩几天」（逾期为负），取反即逾期天数。复用它
    // 而不是自己再减一遍，是因为它已经把两边归一到日历日了。
    // 单独判 0 是为了不让 -0 漏出去：取反 0 得到的是 -0，页面上看不出来，
    // 但 Object.is(-0, 0) 是 false，断言和快照会莫名其妙地不等。
    const daysLeft = promisedDaysLeft(r.expectedDate as Date, now);
    return {
      id: r.id,
      supplierName: r.supplierName,
      expectedDate: r.expectedDate as Date,
      status: r.status,
      orderNo: r.order?.orderNo ?? null,
      daysOverdue: daysLeft === 0 ? 0 : -daysLeft,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// 交期预警 — promisedDate 已逾期或 DUE_SOON_DAYS 内到期，且工单未发货
// ─────────────────────────────────────────────────────────────────────

export type DueOrderRow = {
  id: string;
  orderNo: string;
  customerRef: string | null;
  status: OrderStatus;
  isUrgent: boolean;
  promisedDate: Date;
  // 负 = 已逾期天数取反（-2 = 逾期 2 天），0 = 今天到期，正 = 剩余天数
  daysLeft: number;
};

export type DueOrdersResult = {
  rows: DueOrderRow[];
  // 满足条件的总数（不受 limit 影响）。看板只渲染前 limit 条，footer 用
  // total 说明「一共积了多少」——这正是这张表最该暴露的信号：没闭环的
  // 逾期单（尤其被遗忘的 DRAFT）会一直挂在这个窗口里，不报总数就只能
  // 看到冰山尖。
  total: number;
  // 窗口右界的上海日历日（YYYY-MM-DD）。页面拼「查看全部」链接的
  // promisedTo 参数时直接用它，保证列表页筛出来的和这里查的是同一批；
  // 时区运算留在 lib 侧，页面不自己再算一遍。
  promisedThroughYmd: string;
};

// 看板一屏能看完的条数。和 getPendingShipments 取同一个数：两张表在同
// 一个 grid 里并排，行数不一致会让人以为其中一张「没数据了」。
export const DUE_ORDERS_DEFAULT_LIMIT = 10;

/**
 * 交期预警：未发货状态（PROMISE_ALERT_STATUSES）+ promisedDate 落在
 * "已逾期 .. 今日+DUE_SOON_DAYS" 窗口。promisedDate = null 不预警
 * （没承诺交期的单不发噪音）。口径与详情页徽标 / cron 推送共用
 * lib/order/promised-date。
 *
 * promisedDate 存日历日的 UTC 零点；以 Shanghai 次日边界比较可精确
 * 取"日历日 ≤ 今日+N"（D 的 UTC 零点恒大于 D-1 的上海日界、小于
 * D 的上海日界 — 与超期外协同款表示法）。
 *
 * **只取前 limit 条**：这个窗口只有上界没有下界，所有没闭环的逾期单会
 * 永久累积，无界查询迟早把首屏的 RSC payload 拖垮。截断本身对使用者
 * 必须可见 —— 所以同时返回 total，页面在 footer 里显示「共 N 条 · 查看
 * 全部」，而不是默默少给几行。
 *
 * 排序保持「交期最早的在前」= 逾期最久的先看到，被截断的是窗口右端
 * （最近几天才到期的）。积压很深时这个取舍会失真：一堆很久以前的僵尸
 * 草稿单会把明天到期的真活儿挤出前 10。total + 「查看全部」是给这种
 * 情况留的出口；根治要靠业务口径（DRAFT 该不该进预警、逾期超过多久
 * 停止预警），不在本函数里替业主定。
 */
export async function getDueOrders(
  now: Date = new Date(),
  limit = DUE_ORDERS_DEFAULT_LIMIT,
): Promise<DueOrdersResult> {
  const today = todayShanghai(now);
  const { start: todayStart } = shanghaiDayBoundary(today);
  const horizon = new Date(
    todayStart.getTime() + (DUE_SOON_DAYS + 1) * MS_PER_DAY,
  );

  // findMany 与 count 共用同一个 where 对象：分开写一旦漂移，footer 会
  // 报一个和列表对不上的数字，而且没人看得出来。
  const where: Prisma.OrderWhereInput = {
    status: { in: [...PROMISE_ALERT_STATUSES] },
    promisedDate: { lt: horizon },
    NOT: { promisedDate: null },
  };

  const [raw, total] = await Promise.all([
    db.order.findMany({
      where,
      // orderNo 兜底：同交期同急单时 Postgres 不保证行序，加了它相邻两次
      // 渲染截断掉的才是同一批（不加会出现「刷新一下这单就没了」）。
      orderBy: [
        { promisedDate: 'asc' },
        { isUrgent: 'desc' },
        { orderNo: 'asc' },
      ],
      take: limit,
      select: {
        id: true,
        orderNo: true,
        customerRef: true,
        status: true,
        isUrgent: true,
        promisedDate: true,
      },
    }),
    db.order.count({ where }),
  ]);

  return {
    rows: raw.map((r) => ({
      id: r.id,
      orderNo: r.orderNo,
      customerRef: r.customerRef,
      status: r.status,
      isUrgent: r.isUrgent,
      promisedDate: r.promisedDate as Date,
      daysLeft: promisedDaysLeft(r.promisedDate as Date, now),
    })),
    total,
    // todayStart 是「今日上海 0:00」的那个瞬间，+N 天再按上海格式化就是
    // 今日+N 的日历日（上海无夏令时，日长恒定 24h）。
    promisedThroughYmd: todayShanghai(
      new Date(todayStart.getTime() + DUE_SOON_DAYS * MS_PER_DAY),
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────
// 超计划报工 — 近 7 天 action='TASK_OVER_REPORT' 的工单日志
// ─────────────────────────────────────────────────────────────────────

export type OverReportRow = {
  id: string;
  orderId: string;
  orderNo: string;
  operatorDisplayName: string;
  remark: string | null;
  createdAt: Date;
};

export type OverReportsResult = {
  rows: OverReportRow[];
  // 窗口内的总条数（不受 limit 影响）。看板 footer 用它说「共 N 条」。
  total: number;
  // 窗口左界的上海日历日（YYYY-MM-DD），页面直接显示，不自己再算一遍。
  sinceYmd: string;
};

// 回看窗口。7 天（含今日）而不是自然周：自然周在周一早上会把上周五的
// 超报全部抹掉，而那恰好是最该被看到的时候。
export const OVER_REPORT_WINDOW_DAYS = 7;
export const OVER_REPORTS_DEFAULT_LIMIT = 10;

/**
 * 超计划报工的知情通道（业主 2026-08-21 拍板）。
 *
 * 单条报工的数量守卫允许师傅自己勾「确认超出计划数」就通过，而计件金额按
 * 合计数全额付（lib/production.ts 的 reportTask）。批准权在被发钱的人手里，
 * 所以必须有一条老板**不用主动去翻工单时间线**就能看见的通道 —— 就是这张表。
 *
 * 数据源是 OrderLog 里 action='TASK_OVER_REPORT' 的行，由 reportTask 在同一个
 * 事务里写。刻意**不**新增 NOTIFICATION_EVENTS：那要同步改 lib/notification/
 * events.ts 与 prisma/seed.ts 的默认模板，成本远高于在看板上多一张表。
 *
 * findMany 与 count 共用同一个 where 对象：分开写一旦漂移，footer 会报一个
 * 和列表对不上的数字，而且没人看得出来（同 getDueOrders）。
 */
export async function getRecentOverReports(
  now: Date = new Date(),
  limit = OVER_REPORTS_DEFAULT_LIMIT,
): Promise<OverReportsResult> {
  const today = todayShanghai(now);
  const { start: todayStart } = shanghaiDayBoundary(today);
  const since = new Date(
    todayStart.getTime() - (OVER_REPORT_WINDOW_DAYS - 1) * MS_PER_DAY,
  );

  const where: Prisma.OrderLogWhereInput = {
    action: 'TASK_OVER_REPORT',
    createdAt: { gte: since },
  };

  const [raw, total] = await Promise.all([
    db.orderLog.findMany({
      where,
      // 最近的排最前：超报是「刚发生的事」，越新越该先看到。
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        orderId: true,
        remark: true,
        createdAt: true,
        order: { select: { orderNo: true } },
        operator: { select: { displayName: true } },
      },
    }),
    db.orderLog.count({ where }),
  ]);

  return {
    rows: raw.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      orderNo: r.order.orderNo,
      operatorDisplayName: r.operator.displayName,
      remark: r.remark,
      createdAt: r.createdAt,
    })),
    total,
    sinceYmd: todayShanghai(since),
  };
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
  totalSales: string; // 本期累计（不含期初）
  initialSales: string; // 期初导入
  // 业绩合计（算档用） = totalSales + initialSales。这是 calcCsCommission
  // 实际喂入的数字，UI 渲染&ldquo;业绩合计&rdquo;列时直接用，避免显示数与提成
  // 计算口径分裂。
  salesForTier: string;
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
 * 业绩口径：周期预测直接读 SalaryPeriod.totalSales + initialSales。
 * totalSales 的权威来源是 CsSalesEntry 事件账本（客服提交工单记正数、
 * 批准变更记差额、取消记负数）；initialSales 只表示历史期初导入。
 * 客户付款 BillPayment 只影响应收，不改变客服业绩。Dashboard Slice C 的
 * 销售排行 / 产品分布仍按 Order.submittedAt 聚合，不在此重算周期账本。
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
      salesForTier: totalForCommission.toFixed(2),
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
