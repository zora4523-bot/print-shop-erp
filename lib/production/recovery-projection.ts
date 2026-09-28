import { productionScopesOverlap, type ProductionScope } from './production-scope';
import type { Prisma } from '@/generated/prisma/client';
import { currentDispatchTargets } from './dispatch-targets';
import { revisionProductionQuantities } from './revision-jobs';

/** Only verified unproduced successors can have their remaining demand corrected. */
async function reconcileRecoveredProductionInTx(tx: Prisma.TransactionClient, orderId: string, sources: Array<ProductionScope & { workOrderVersion: number }>, actorId: string) {
  const sourceVersion = Math.min(...sources.map(source => source.workOrderVersion));
  const { order, targets } = await currentDispatchTargets(tx, orderId);
  if (order.workOrderVersion <= sourceVersion || !['RELEASED', 'FOILING', 'PACKING', 'ON_HOLD'].includes(order.status)) return;
  const jobs = await tx.productionJob.findMany({ where: { orderId, workOrderVersion: order.workOrderVersion }, include: { factReview: true } });
  const history = await tx.productionJob.findMany({ where: { orderId, workOrderVersion: { lt: order.workOrderVersion } } });
  for (const job of jobs) {
    if (job.status === 'CANCELLED' || !sources.some(source => productionScopesOverlap(source, job))) continue;
    if (job.status !== 'PENDING' || job.factReview?.status !== 'UNPRODUCED' || job.factReview.jobRevision !== job.revision) throw new Error('后续生产已有事实或未核实，请先核对后续任务');
    const target = targets.find(row => row.key === job.sourceKey);
    if (!target) throw new Error('后续生产资料不完整，请核对工单');
    const production = revisionProductionQuantities(target, history);
    const snapshot = job.snapshot as Prisma.JsonObject;
    const updated = await tx.productionJob.update({ where: { id: job.id }, data: {
      plannedQty: production.remaining.toString(), status: production.remaining.isZero() ? 'CARRIED' : 'PENDING',
      manualPricing: order.kind === 'REWORK' || history.some(previous => {
        const prior = previous.snapshot as { lane?: string; items?: Array<{ id: string }> };
        return previous.status === 'COMPLETED' && prior.lane === target.snapshot.lane && prior.items?.some(item => target.itemIds.includes(item.id));
      }),
      revision: { increment: 1 }, snapshot: { ...snapshot, productionQuantities: production.quantities,
        actualCarriedQuantities: production.actualQuantities, fulfilledQuantities: production.fulfilledQuantities, recoveredSourceVersion: sourceVersion },
    } });
    await tx.productionFactReview.update({ where: { id: job.factReview.id }, data: { jobRevision: updated.revision, revision: { increment: 1 } } });
    if (production.remaining.isZero()) {
      if (job.operationId) await tx.productionOperation.update({ where: { id: job.operationId }, data: { status: 'COMPLETED' } });
      if (job.progressStepId) await tx.productionProgressStep.update({ where: { id: job.progressStepId }, data: { status: 'COMPLETED' } });
    }
  }
  await tx.orderLog.create({ data: { orderId, operatorId: actorId, action: 'PRODUCTION_RECOVERY_RECONCILED', changedFields: { sourceVersion, currentVersion: order.workOrderVersion } } });
}

/** Closing the last unknown fact must also apply earlier recovered production. */
export async function reconcileResolvedHistoryInTx(tx: Prisma.TransactionClient, orderId: string, actorId: string) {
  if (await tx.productionFactReview.count({ where: { job: { orderId }, status: { in: ['OPEN', 'CONFLICT'] } } })) return;
  const pending = await tx.productionFactReview.findMany({ where: { job: { orderId, status: 'COMPLETED', recordSource: 'HISTORICAL_REVIEW' }, evidence: { path: ['projectionPending'], equals: true } }, include: { job: { select: { workOrderVersion: true, sourceKey: true, snapshot: true } } } });
  if (!pending.length) return;
  await reconcileRecoveredProductionInTx(tx, orderId, pending.map(review => review.job), actorId);
  for (const review of pending) await tx.productionFactReview.update({ where: { id: review.id }, data: { evidence: { ...(review.evidence as Prisma.JsonObject), projectionPending: false }, revision: { increment: 1 } } });
}
