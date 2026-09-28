import Decimal from 'decimal.js';
import type { Prisma, ProductionJob } from '@/generated/prisma/client';
import { currentDispatchTargets, targetLinks } from './dispatch-targets';

function fingerprint(snapshot: Prisma.JsonValue) {
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && typeof snapshot.fingerprint === 'string' ? snapshot.fingerprint : null;
}
/** Carry only identifiable physical pieces; never let one style's surplus satisfy another. */
export function revisionProductionQuantities(target: { fingerprint: string; snapshot: Prisma.InputJsonObject }, history: Array<Pick<ProductionJob, 'status' | 'snapshot' | 'completedQty'>>) {
  const items = target.snapshot.items as Array<{ id: string; quantity: number }>;
  const produced = new Map(items.map(item => [item.id, new Decimal(0)]));
  for (const job of history) {
    if (job.status !== 'COMPLETED') continue;
    const snapshot = job.snapshot as Record<string, Prisma.JsonValue>;
    const sourceFingerprints = snapshot.itemFingerprints as Record<string, string> | undefined;
    const targetFingerprints = target.snapshot.itemFingerprints as Record<string, string> | undefined;
    const perItem = !!sourceFingerprints && !!targetFingerprints && typeof snapshot.lane === 'string';
    if (perItem ? snapshot.lane !== target.snapshot.lane : fingerprint(job.snapshot) !== target.fingerprint) continue;
    const original = snapshot.items as Array<{ id: string; quantity: number }>;
    const quantities = snapshot.productionQuantities as Record<string, string> | undefined
      ?? Object.fromEntries(original.map(item => [item.id, String(item.quantity)]));
    const sum = Object.values(quantities).reduce((total, qty) => total.plus(qty), new Decimal(0));
    // A changed aggregate quantity cannot identify which of multiple styles was produced.
    // Conservatively leave these pieces for administrator verification in the revised task.
    if (original.length > 1 && !job.completedQty?.eq(sum)) continue;
    for (const item of original) {
      if (perItem && (!sourceFingerprints![item.id] || sourceFingerprints![item.id] !== targetFingerprints![item.id])) continue;
      if (produced.has(item.id)) produced.set(item.id, produced.get(item.id)!.plus(original.length === 1 ? job.completedQty?.toString() ?? '0' : quantities[item.id] ?? '0'));
    }
  }
  const quantities = Object.fromEntries(items.map(item => [item.id, Decimal.max(0, new Decimal(item.quantity).minus(produced.get(item.id)!)).toString()]));
  return { quantities, remaining: Object.values(quantities).reduce((sum, quantity) => sum.plus(quantity), new Decimal(0)) };
}
/** Revision appends production, never reprices or reassigns earned wages. */
export async function inheritProductionJobsInTx(tx: Prisma.TransactionClient, orderId: string, actorId: string) {
  const { order, targets } = await currentDispatchTargets(tx, orderId);
  if (!order.simpleProduction) return;
  const history = await tx.productionJob.findMany({ where: { orderId, workOrderVersion: { lt: order.workOrderVersion } }, orderBy: [{ workOrderVersion: 'desc' }, { id: 'asc' }] });
  const links = await targetLinks(tx, orderId, order.workOrderVersion);
  let unfinished = 0;
  for (const target of targets) {
    const link = links.get(target.key);
    if (!link) throw new Error('改版生产明细不完整，请核对工单');
    const sameLane = history.filter(job => job.sourceKey.split(':').slice(0, -1).join(':') === target.key.split(':').slice(0, -1).join(':'));
    const overlapping = sameLane.filter(job => {
      const snapshot = job.snapshot as { items?: Array<{ id: string }> };
      return snapshot.items?.some(item => target.itemIds.includes(item.id));
    });
    const prior = history.find(job => job.sourceKey === target.key)
      ?? (new Set(overlapping.map(job => job.workerId)).size === 1 ? overlapping[0] : undefined);
    if (!prior) { unfinished++; continue; }
    const production = revisionProductionQuantities(target, history);
    const quantity = production.remaining;
    const done = new Decimal(target.quantity).minus(quantity);
    // Existing ownership is historical. An inactive worker may be backfilled by an admin;
    // only a new/incompatible craft needs reassignment, never an inferred owner.
    await tx.productionJob.create({ data: { orderId, workOrderVersion: order.workOrderVersion,
      operationId: link.operationId, progressStepId: link.progressStepId, workerId: prior.workerId, workerName: prior.workerName,
      sourceKey: target.key, label: target.label, plannedQty: quantity.toString(), status: quantity.isZero() ? 'CARRIED' : 'PENDING',
      manualPricing: true, snapshot: { ...target.snapshot, previousJobId: prior.id, carriedQty: done.toString(), productionQuantities: production.quantities, reason: '工单改版新增生产' } } });
    if (quantity.isZero()) {
      if (link.operationId) await tx.productionOperation.update({ where: { id: link.operationId }, data: { status: 'COMPLETED' } });
      if (link.progressStepId) await tx.productionProgressStep.update({ where: { id: link.progressStepId }, data: { status: 'COMPLETED' } });
    } else {
      unfinished++;
    }
  }
  await tx.productionJob.updateMany({ where: { orderId, workOrderVersion: { lt: order.workOrderVersion }, status: { in: ['PENDING', 'REQUESTED'] } }, data: { status: 'CANCELLED', revision: { increment: 1 } } });
  if (unfinished && ['RELEASED', 'FOILING', 'PACKING'].includes(order.status)) await tx.order.update({ where: { id: orderId }, data: { status: 'RELEASED', completedAt: null } });
  await tx.orderLog.create({ data: { orderId, operatorId: actorId, action: 'PRODUCTION_OWNERSHIP_INHERITED', changedFields: { workOrderVersion: order.workOrderVersion, unfinished, historicalWagesPreserved: true } } });
}

/** A shipped order's redo is a distinct delivery with inherited production ownership. */
export async function inheritReworkProductionJobsInTx(tx: Prisma.TransactionClient, orderId: string, actorId: string) {
  const { order, targets } = await currentDispatchTargets(tx, orderId);
  if (order.kind !== 'REWORK' || !order.sourceOrderId) return;
  const source = await tx.order.findUnique({ where: { id: order.sourceOrderId }, select: { simpleProduction: true } });
  if (!source?.simpleProduction) return;
  const history = await tx.productionJob.findMany({ where: { orderId: order.sourceOrderId, status: { in: ['COMPLETED', 'CARRIED'] } }, orderBy: [{ workOrderVersion: 'desc' }, { id: 'asc' }] });
  const links = await targetLinks(tx, orderId, order.workOrderVersion);
  await tx.order.update({ where: { id: orderId }, data: { simpleProduction: true } });
  for (const target of targets) {
    const sourceIds = order.items.filter(item => target.itemIds.includes(item.id)).flatMap(item => {
      const snapshot = item.pricingSnapshot as { sourceOrderItemId?: string } | null;
      return snapshot?.sourceOrderItemId ? [snapshot.sourceOrderItemId] : [];
    });
    const lane = target.key.split(':').slice(0, -1).join(':');
    const owners = sourceIds.map(id => history.find(job => job.sourceKey.split(':').slice(0, -1).join(':') === lane
      && (job.snapshot as { items?: Array<{ id: string }> }).items?.some(item => item.id === id)));
    if (sourceIds.length !== target.itemIds.length || owners.some(owner => !owner) || new Set(owners.map(owner => owner!.workerId)).size !== 1) continue;
    const owner = owners[0]!;
    const link = links.get(target.key);
    if (!link || await tx.productionJob.findFirst({ where: { orderId, workOrderVersion: order.workOrderVersion, sourceKey: target.key } })) continue;
    await tx.productionJob.create({ data: { orderId, workOrderVersion: order.workOrderVersion, operationId: link.operationId, progressStepId: link.progressStepId,
      workerId: owner.workerId, workerName: owner.workerName, label: target.label, sourceKey: target.key, plannedQty: target.quantity, manualPricing: true,
      snapshot: { ...target.snapshot, sourceOrderId: order.sourceOrderId, previousJobId: owner.id, reason: '关联重做生产' } } });
  }
  await tx.orderLog.create({ data: { orderId, operatorId: actorId, action: 'PRODUCTION_OWNERSHIP_INHERITED', changedFields: { sourceOrderId: order.sourceOrderId, historicalWagesPreserved: true } } });
}
