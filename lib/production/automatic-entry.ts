import type { Prisma } from '@/generated/prisma/client';
import { activateProductionOperationsInTx } from './operation-materialization-service';
import { readProductionRouting } from './routing';
import { maybeCompleteProductionOrder, type ProductionCompletionTx } from '../production-completion';
import { enqueuePreparedProductionInTx } from './preparation-notification';

/** 调用者持有工单锁并已核对报价和待审批；仅推进不需要分配师傅的工单。 */
export async function activateUnassignedOrderInTx(tx: Prisma.TransactionClient, orderId: string, actorId: string, now: Date) {
  const routing = (await readProductionRouting(tx, [orderId])).get(orderId);
  if (!routing || routing.kind === 'BLOCKED' || routing.kind === 'ASSIGN') return null;
  const before = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
  const activated = await activateProductionOperationsInTx(tx, orderId, { id: actorId }, now, { targetStatus: 'RELEASED' });
  if (before.status !== activated.orderStatus && routing.kind !== 'SAMPLE') await tx.order.update({ where: { id: orderId }, data: { revision: { increment: 1 } } });
  // 无内部工序也无外协的工单直接待发货；包装工序仍保留原报工和工资规则。
  if (routing.kind !== 'SAMPLE') {
    const completed = await maybeCompleteProductionOrder(tx as unknown as ProductionCompletionTx, orderId, actorId, now);
    const scheduledNotification = !completed.completed && before.status !== activated.orderStatus
      ? await enqueuePreparedProductionInTx(tx, orderId, activated.operationIds.length + activated.progressStepIds.length) : undefined;
    return { status: completed.orderStatus ?? activated.orderStatus, notification: completed.notification, scheduledNotification };
  }
  return { status: activated.orderStatus, notification: undefined, scheduledNotification: undefined };
}
