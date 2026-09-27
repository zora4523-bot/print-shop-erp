import { ORDER_EXTERNAL_SALES_SELECT, orderExternalSalesName } from './external-sales-name';
import type { Prisma } from '../../generated/prisma/client';
import { OrderStatus } from '../../generated/prisma/enums';
import { db } from '../db';
import {
  overdueCutoff,
  PROMISE_ALERT_STATUSES,
  promisedDaysLeft,
} from './promised-date';

// 每日「交期逾期」推送的扫描查询。
//
// 为什么不复用 lib/dashboard/owner-watchlist 的 getDueOrders：两者对
// 边界的要求正好相反。看板要的是「首屏能看完的前 N 条」，推送要的是
// 「今天该催的每一单」。共用一个查询时，看板替推送背了整个预警窗口的
// 全表扫描，推送又替看板背了 due-soon 的行再在 JS 里 filter 掉——两边
// 都拿不到自己想要的形状。
//
// 「逾期」的边界统一由 lib/order/promised-date 的 overdueCutoff 给出，
// 不在这里重算时区。

// fan-out 安全阀：单次推送最多发多少条。这不是业务阈值，是防止一次
// cron 把几百条消息灌进企业微信群（机器人有每分钟条数限制）、并顺带
// 把 durable 队列刷爆的工程上限。真的长期撞到这个数，说明积压需要业务
// 口径来收（哪些单不再预警），而不是把这个数字调大。
export const ORDER_OVERDUE_NOTIFY_CAP = 200;

export type OverdueOrderRow = {
  id: string;
  orderNo: string;
  /** 工单归属的外部销售（免费重做取原单销售）。 */
  externalSalesName: string | null;
  /** @deprecated 客户自 2026-09-13 起不再录入；仅供旧自定义模板。 */
  customerRef: string | null;
  status: OrderStatus;
  promisedDate: Date;
  // 已逾期天数，恒 >= 1（SQL 边界已经把「今天到期」排除）
  daysOverdue: number;
};

export type OverdueOrderScan = {
  rows: OverdueOrderRow[];
  // true = 逾期单数超过 cap，rows 只是最该催的前 cap 条
  truncated: boolean;
};

export async function scanOverdueOrders(
  now: Date = new Date(),
  cap: number = ORDER_OVERDUE_NOTIFY_CAP,
): Promise<OverdueOrderScan> {
  const where: Prisma.OrderWhereInput = {
    status: { in: [...PROMISE_ALERT_STATUSES] },
    // daysLeft < 0 的 SQL 形态；今天到期（daysLeft = 0）不推送。
    promisedDate: { lt: overdueCutoff(now) },
    NOT: { promisedDate: null },
  };

  // take: cap + 1 是截断探针（和 getPendingShipments 同款）：多取的那条
  // 只用来判断「还有没有」，不进 rows、不推送。
  const raw = await db.order.findMany({
    where,
    orderBy: [
      { promisedDate: 'asc' },
      { isUrgent: 'desc' },
      { orderNo: 'asc' },
    ],
    take: cap + 1,
    select: {
      id: true,
      orderNo: true,
      customerRef: true,
      ...ORDER_EXTERNAL_SALES_SELECT,
      status: true,
      promisedDate: true,
    },
  });

  const rows = raw.slice(0, cap).map((r) => ({
    id: r.id,
    orderNo: r.orderNo,
    externalSalesName: orderExternalSalesName(r),
    customerRef: r.customerRef,
    status: r.status,
    promisedDate: r.promisedDate as Date,
    // SQL 边界保证 daysLeft <= -1，取反必为正整数，不会漏出 -0。
    // 复用 promisedDaysLeft 而不是自己再减一遍：它已经把两边归一到
    // 上海日历日，和详情页徽标显示的天数是同一个数。
    daysOverdue: -promisedDaysLeft(r.promisedDate as Date, now),
  }));

  return { rows, truncated: raw.length > cap };
}