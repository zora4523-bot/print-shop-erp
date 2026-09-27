import { db } from '../db';
import {
  ORDER_EXTERNAL_SALES_SELECT,
  orderExternalSalesName,
} from '../order/external-sales-name';
import type { NotificationEvent, NotificationPayloadFor } from './events';

// 2026-09-27 起这三类事件的载荷带 `externalSalesName`，交期逾期的默认模板也改用
// {externalSalesName}（DECISIONS 同日）。部署前入队、部署后才投递或重试的旧载荷
// 没有这个键，渲染器会把占位符原样发出去：这里按 orderId 回查工单补上，查不到
// 写“未填”。新载荷已带该键，不查库。
const EXTERNAL_SALES_PAYLOAD_EVENTS: ReadonlySet<NotificationEvent> = new Set([
  'URGENT_ORDER',
  'ORDER_COMPLETED',
  'ORDER_OVERDUE',
]);

export async function withLegacyExternalSalesName<E extends NotificationEvent>(
  event: E,
  payload: NotificationPayloadFor<E>,
): Promise<NotificationPayloadFor<E>> {
  const record = payload as unknown as Readonly<Record<string, unknown>>;
  if (
    !EXTERNAL_SALES_PAYLOAD_EVENTS.has(event) ||
    typeof record.externalSalesName === 'string'
  ) {
    return payload;
  }
  return {
    ...payload,
    externalSalesName: (await lookupExternalSalesName(record.orderId)) || '未填',
  } as NotificationPayloadFor<E>;
}

// 补名是尽力而为：回查失败只少一个名字，不能让本可送达的通知整体失败重试。
async function lookupExternalSalesName(orderId: unknown): Promise<string | null> {
  if (typeof orderId !== 'string' || !orderId) return null;
  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: ORDER_EXTERNAL_SALES_SELECT,
    });
    return order ? orderExternalSalesName(order) : null;
  } catch {
    return null;
  }
}
