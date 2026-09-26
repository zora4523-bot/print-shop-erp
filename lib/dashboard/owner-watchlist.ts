import type { Prisma } from '../../generated/prisma/client';
import {
  OrderStatus,
  OutsourceStatus,
  Role,
} from '../../generated/prisma/enums';
import { db } from '../db';
import {
  paginatedResult,
  paginationWindow,
  type PaginatedResult,
} from '../admin/table';
import {
  ORDER_EXTERNAL_SALES_SELECT,
  orderExternalSalesName,
} from '../order/external-sales-name';
import {
  DUE_SOON_DAYS,
  PROMISE_ALERT_STATUSES,
  promisedDaysLeft,
} from '../order/promised-date';
import { getSetting } from '../settings';
import { shanghaiDayBoundary, todayShanghai } from './shanghai-clock';

// Owner dashboard watchlists — read-only lists that surface things
// the owner needs to do or notice "right now":
//
//   - getPendingShipments — completedAt 已落、尚未发货的工单
//   - getOverdueOutsourcing — outsource orders past expectedDate
//   - getDueOrders / getRecentOverReports — 交期预警与超计划报工
//
// Each function returns plain JSON-serialisable rows; Decimal columns
// are always handed to the caller as strings (`.toFixed(2)`). Page-
// level rendering only does presentation.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────
// 待发货 — 已完成生产但尚未发货，按 (急单优先, 完工时间正序) 排列
// ─────────────────────────────────────────────────────────────────────

// 关注列表按“工单名称 + 工单号”指认工单、另列工单归属的外部销售（收费单即
// 提交人，免费重做取原单），取代已停用的客户名称/简称（业主 2026-09-27）。
// 外部销售不代表生产跟进人或当前负责人。
export type PendingShipmentRow = {
  id: string;
  orderNo: string;
  customName: string | null;
  isUrgent: boolean;
  completedAt: Date;
  promisedDate: Date | null;
  externalSalesName: string | null;
};

export type PendingShipmentsResult = PaginatedResult<PendingShipmentRow> & {
  hasMore: boolean;
};

/**
 * 完工但未发货的工单。统一完工闸口以 completedAt 作为事实标记，并将
 * canonical 工单收口到 PACKING；legacy 工单仍使用 COMPLETED。暂停中的
 * ON_HOLD 仍是生产完成事实，但当前不可发货，
 * 因此也不进入本操作队列。急单优先，
 * 同优先级里完工早的排前面（&ldquo;最该催的在最上&rdquo;）。
 *
 * `take: limit + 1` 是&ldquo;hasMore&rdquo; 探针：取 11 条，前 10 条入 rows，
 * 第 11 条只判断"有没有"，不入返回。UI 据此渲染&ldquo;查看全部 →&rdquo;。
 */
export async function getPendingShipments(
  _now: Date = new Date(),
  limit = 10,
  page = 1,
): Promise<PendingShipmentsResult> {
  void _now;
  const where: Prisma.OrderWhereInput = {
    completedAt: { not: null },
    shippedAt: null,
    status: { in: [OrderStatus.PACKING, OrderStatus.COMPLETED] },
  };
  const total = await db.order.count({ where });
  const window = paginationWindow(total, page, limit);
  const raw = await db.order.findMany({
    where,
    orderBy: [{ isUrgent: 'desc' }, { completedAt: 'asc' }, { orderNo: 'asc' }],
    skip: window.skip,
    take: window.take + 1,
    select: {
      id: true,
      orderNo: true,
      customName: true,
      isUrgent: true,
      completedAt: true,
      promisedDate: true,
      ...ORDER_EXTERNAL_SALES_SELECT,
    },
  });

  const rows: PendingShipmentRow[] = raw.slice(0, window.take).map((r) => ({
    id: r.id,
    orderNo: r.orderNo,
    customName: r.customName,
    isUrgent: r.isUrgent,
    // where.completedAt != null guarantees this projection is present.
    completedAt: r.completedAt as Date,
    promisedDate: r.promisedDate,
    externalSalesName: orderExternalSalesName(r),
  }));

  return {
    ...paginatedResult(rows, total, window),
    hasMore: raw.length > window.take,
  };
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
    orderBy: [{ expectedDate: 'asc' }, { id: 'asc' }],
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
  customName: string | null;
  externalSalesName: string | null;
  status: OrderStatus;
  isUrgent: boolean;
  promisedDate: Date;
  // 负 = 已逾期天数取反（-2 = 逾期 2 天），0 = 今天到期，正 = 剩余天数
  daysLeft: number;
};

export type DueOrdersResult = PaginatedResult<DueOrderRow> & {
  // 满足条件的总数（不受 limit 影响）。看板只渲染前 limit 条，footer 用
  // total 说明「一共积了多少」——这正是这张表最该暴露的信号：没闭环的
  // 逾期单（尤其被遗忘的 DRAFT）会一直挂在这个窗口里，不报总数就只能
  // 看到冰山尖。
  // 窗口右界的上海日历日（YYYY-MM-DD）。页面拼「查看全部」链接的
  // promisedTo 参数时直接用它，保证列表页筛出来的和这里查的是同一批；
  // 时区运算留在 lib 侧，页面不自己再算一遍。
  promisedThroughYmd: string;
};

// 兼容现有调用的默认窗口；首页预览和完整关注列表可分别传入所需页大小。
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
  page = 1,
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

  const total = await db.order.count({ where });
  const window = paginationWindow(total, page, limit);
  const raw = await db.order.findMany({
    where,
    // orderNo 兜底：同交期同急单时 Postgres 不保证行序，加了它相邻两次
    // 渲染截断掉的才是同一批（不加会出现「刷新一下这单就没了」）。
    orderBy: [
      { promisedDate: 'asc' },
      { isUrgent: 'desc' },
      { orderNo: 'asc' },
    ],
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      orderNo: true,
      customName: true,
      status: true,
      isUrgent: true,
      promisedDate: true,
      ...ORDER_EXTERNAL_SALES_SELECT,
    },
  });

  return {
    ...paginatedResult(
      raw.map((r) => ({
        id: r.id,
        orderNo: r.orderNo,
        customName: r.customName,
        externalSalesName: orderExternalSalesName(r),
        status: r.status,
        isUrgent: r.isUrgent,
        promisedDate: r.promisedDate as Date,
        daysLeft: promisedDaysLeft(r.promisedDate as Date, now),
      })),
      total,
      window,
    ),
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
  quantities: OverReportQuantities | null;
};

export type OverReportQuantities = {
  completedQty: number;
  defectQty: number;
  reworkQty: number;
  totalQty: number;
};

export type OverReportsResult = PaginatedResult<OverReportRow> & {
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
 * 历史任务允许师傅确认超计划报工，因此保留老板直接查看的知情通道。
 *
 * 数据源是历史 reportTask 在事务中写入的 OrderLog。该 legacy 写入口已退役；
 * 当前 ProductionOperation / ProgressStep 报工直接拒绝累计合格数超计划。
 * 保留这些审计记录的可见性，不把被拒绝的报工或工单进度异常混成同一类事件。
 * changedFields 只保存三项实际数量，计划数和款式仅存在于历史备注文本，
 * 因而不从自由备注推导计划量、超出量或任务归属。
 *
 * findMany 与 count 共用同一个 where 对象：分开写一旦漂移，footer 会报一个
 * 和列表对不上的数字，而且没人看得出来（同 getDueOrders）。
 */
export async function getRecentOverReports(
  now: Date = new Date(),
  limit = OVER_REPORTS_DEFAULT_LIMIT,
  page = 1,
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

  const total = await db.orderLog.count({ where });
  const window = paginationWindow(total, page, limit);
  const raw = await db.orderLog.findMany({
    where,
    // 最近的排最前，同时间用 id 保持分页顺序稳定。
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      orderId: true,
      remark: true,
      changedFields: true,
      createdAt: true,
      order: { select: { orderNo: true } },
      operator: { select: { displayName: true } },
    },
  });

  return {
    ...paginatedResult(
      raw.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        orderNo: r.order.orderNo,
        operatorDisplayName: r.operator.displayName,
        remark: r.remark,
        createdAt: r.createdAt,
        quantities: overReportQuantities(r.changedFields),
      })),
      total,
      window,
    ),
    sinceYmd: todayShanghai(since),
  };
}

/** Historical TASK_OVER_REPORT audit snapshots use non-negative integer after values. */
function overReportQuantities(
  changedFields: Prisma.JsonValue,
): OverReportQuantities | null {
  if (
    !changedFields ||
    typeof changedFields !== 'object' ||
    Array.isArray(changedFields)
  ) {
    return null;
  }
  const readQuantity = (field: string): number | null => {
    const change = changedFields[field];
    if (!change || typeof change !== 'object' || Array.isArray(change)) return null;
    const value = change.after;
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value
      : null;
  };
  const completedQty = readQuantity('completedQty');
  const defectQty = readQuantity('defectQty');
  const reworkQty = readQuantity('reworkQty');
  if (completedQty === null || defectQty === null || reworkQty === null) return null;
  const totalQty = completedQty + defectQty + reworkQty;
  return Number.isSafeInteger(totalQty)
    ? { completedQty, defectQty, reworkQty, totalQty }
    : null;
}

// Re-export the Role enum value used by callers that want to label the
// submitter role on the watchlist (kept here so call-sites don't have
// to drill into generated/prisma).
export { Role };
