import type { Prisma } from '@/generated/prisma/client';
import { operationTypeForReporterAccount } from './reporter-operation-lane';
import { progressCraftIdsForReporter } from './progress-reporter-lane';
import { dispatchOrderInclude, dispatchTargets, productionSourceKey, type DispatchTarget } from './dispatch-plan';

export async function eligibleProductionWorker(tx: Pick<Prisma.TransactionClient, 'user' | 'craft'>, workerId: string, target: DispatchTarget) {
  const worker = await tx.user.findUnique({ where: { id: workerId } });
  if (!worker || worker.role !== 'WORKER' || !worker.isActive || worker.workerType === 'PACKER') throw new Error('师傅账号不可安排生产，请重新选择');
  const eligible = target.operationType ? operationTypeForReporterAccount(worker) === target.operationType
    : target.craftId && (await progressCraftIdsForReporter(tx, worker)).includes(target.craftId);
  if (!eligible) throw new Error(`${worker.displayName} 的工种不适合${target.label}，请重新选择`);
  return worker;
}
export async function currentDispatchTargets(tx: Pick<Prisma.TransactionClient, 'order' | 'craft'>, id: string) {
  const order = await tx.order.findUnique({ where: { id }, include: dispatchOrderInclude });
  if (!order) throw new Error('工单不存在，请返回工单列表');
  const crafts = await tx.craft.findMany({ where: { id: { in: [...new Set(order.items.flatMap(item => item.crafts))] } } });
  return { order, targets: dispatchTargets(order, crafts) };
}
export async function targetLinks(tx: Prisma.TransactionClient, orderId: string, version: number) {
  const operations = await tx.productionOperation.findMany({ where: { orderId, workOrderVersion: version, operationType: { not: 'PACKING' } }, include: { sources: true, reports: { select: { id: true } } } });
  const steps = await tx.productionProgressStep.findMany({ where: { orderId, workOrderVersion: version }, include: { reports: { select: { id: true } } } });
  return new Map<string, { operationId: string | null; progressStepId: string | null; hasHistory: boolean }>([
    ...operations.map(op => [productionSourceKey(op.operationType, op.sources.flatMap(source => source.orderItemId ? [source.orderItemId] : [])), { operationId: op.id, progressStepId: null, hasHistory: op.reports.length > 0 || !op.carriedCompletedQty.isZero() }] as const),
    ...steps.map(step => [productionSourceKey(`CRAFT:${step.craftId}`, [step.orderItemId]), { operationId: null, progressStepId: step.id, hasHistory: step.reports.length > 0 || !step.carriedCompletedQty.isZero() }] as const),
  ]);
}
