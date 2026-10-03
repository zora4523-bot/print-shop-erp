import type { Prisma } from '@/generated/prisma/client';
import type { NotificationPayloadFor } from '@/lib/notification/events';
import { enqueueNotificationInTransaction } from '@/lib/notification/transactional-outbox';
import { dispatchNotification } from '@/lib/notification/dispatch';

export type PreparedProductionNotification = { payload: NotificationPayloadFor<'ORDER_SCHEDULED'>; queued: boolean; dedupeKey: string };
export async function enqueuePreparedProductionInTx(tx: Prisma.TransactionClient, orderId: string, taskCount: number): Promise<PreparedProductionNotification> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { orderNo: true } });
  const payload = { orderId, orderNo: order.orderNo, taskCount };
  const dedupeKey = `notification:ORDER_SCHEDULED:${orderId}`;
  const queued = await enqueueNotificationInTransaction(tx, 'ORDER_SCHEDULED', payload, { dedupeKey });
  return { payload, dedupeKey, queued };
}
export async function dispatchPreparedProduction(notification?: PreparedProductionNotification) {
  if (notification && !notification.queued) await dispatchNotification('ORDER_SCHEDULED', notification.payload, { dedupeKey: notification.dedupeKey });
}
