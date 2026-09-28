import type { Prisma } from '@/generated/prisma/client';
import { transitionOrder } from '@/lib/order/status-machine';
import { maybeCompleteProductionOrder, type ProductionCompletionTx } from '@/lib/production-completion';

/** Repricing alone is not a new physical completion or a new sales notification. */
export async function preserveCarriedCompletionInTx(tx: Prisma.TransactionClient, orderId: string, completedAt: Date | null) {
  if (!completedAt) return;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (!order.simpleProduction || order.requiresOutsource || !['PACKING', 'ON_HOLD'].includes(order.status)) return;
  const where = { orderId, workOrderVersion: order.workOrderVersion, status: { notIn: ['COMPLETED', 'CANCELLED'] as Array<'COMPLETED' | 'CANCELLED'> } };
  const remaining = await tx.productionOperation.count({ where: { ...where, operationType: { not: 'PACKING' } } })
    + await tx.productionProgressStep.count({ where });
  if (!remaining) await tx.order.update({ where: { id: orderId }, data: { completedAt } });
}

/** Caller holds the order lock. Historical facts never reopen a closed delivery. */
export async function reopenAssignedProductionInTx(tx: Prisma.TransactionClient, orderId: string, actorId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (!order.simpleProduction || !['RELEASED', 'FOILING', 'PACKING', 'ON_HOLD'].includes(order.status)) return;
  const where = { orderId, workOrderVersion: order.workOrderVersion, status: { in: ['PENDING', 'IN_PROGRESS'] as Array<'PENDING' | 'IN_PROGRESS'> } };
  const remaining = await tx.productionOperation.count({ where: { ...where, operationType: { not: 'PACKING' } } })
    + await tx.productionProgressStep.count({ where });
  if (!remaining) return;
  const status = order.status === 'ON_HOLD' || order.status === 'RELEASED'
    ? order.status : transitionOrder(order.status, 'RELEASED', { remainingAssignedProduction: true });
  await tx.order.update({ where: { id: orderId }, data: { status, completedAt: null } });
  if (status !== order.status) await tx.orderLog.create({ data: { orderId, operatorId: actorId, action: 'STATUS_CHANGE',
    changedFields: { status: { before: order.status, after: status }, workOrderVersion: order.workOrderVersion }, remark: '尚有生产任务未完成' } });
  return status;
}

/** Used after approvals, reopening a hold, and closing the last change request. */
export async function reconcileProductionOrderInTx(tx: Prisma.TransactionClient, orderId: string, actorId: string, now: Date) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  let currentStatus = order.status;
  if (order.simpleProduction && ['RELEASED', 'FOILING', 'PACKING'].includes(order.status)) {
    const jobs = await tx.productionJob.findMany({ where: { orderId, workOrderVersion: order.workOrderVersion } });
    for (const job of jobs) {
      if (!['COMPLETED', 'CARRIED'].includes(job.status)) continue;
      if (job.operationId) await tx.productionOperation.updateMany({ where: { id: job.operationId, status: { notIn: ['CANCELLED', 'COMPLETED'] } }, data: { status: 'COMPLETED' } });
      if (job.progressStepId) await tx.productionProgressStep.updateMany({ where: { id: job.progressStepId, status: { notIn: ['CANCELLED', 'COMPLETED'] } }, data: { status: 'COMPLETED' } });
    }
    currentStatus = await reopenAssignedProductionInTx(tx, orderId, actorId) ?? currentStatus;
  }
  const completion = await maybeCompleteProductionOrder(tx as unknown as ProductionCompletionTx, orderId, actorId, now);
  return { ...completion, orderStatus: completion.orderStatus ?? currentStatus };
}
