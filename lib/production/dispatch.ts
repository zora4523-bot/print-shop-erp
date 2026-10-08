import { ProductionInputError } from '@/lib/production/input-error';
import { salaryIdentityLockKey } from '@/lib/salary/hourly-lock';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { orderCascadeLockKey } from '@/lib/order/locks';
import { createOrderPrintRequestInTx } from '@/lib/order/print-jobs';
import { releaseFactoryOrderInTx } from '@/lib/order/admin-workflow';
import { dispatchNotification } from '@/lib/notification/dispatch';
import { dispatchProductionCompletionNotification, type ProductionCompletionNotification } from '@/lib/production-completion';
import { currentDispatchTargets, eligibleProductionWorker, targetLinks } from './dispatch-targets';
import { assertNoHistoricalProductionReview } from './fact-guards';

export type ProductionActor = { id: string; role: Role };
export const dispatchSchema = z.object({
  requestKey: z.string().min(8).max(128),
  orders: z.array(z.object({ id: z.string().min(1), revision: z.number().int().positive(), version: z.number().int().positive(),
    assignments: z.record(z.string(), z.string().min(1)),
  }).strict()).min(1).max(20),
}).strict();
type DispatchInput = z.infer<typeof dispatchSchema>;
export async function assertProductionAdmin(tx: Prisma.TransactionClient, actor: ProductionActor) {
  const account = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isActive: true } });
  if (actor.role !== 'ADMIN' || account?.role !== 'ADMIN' || !account.isActive) throw new ProductionInputError('无权操作，请使用有效的管理员账号');
}
/** One transaction owns the batch, including release, prints and assignments. */
export async function publishProductionDispatch(raw: DispatchInput, actor: ProductionActor) {
  const input = dispatchSchema.parse(raw);
  if (new Set(input.orders.map(order => order.id)).size !== input.orders.length) throw new ProductionInputError('重复选择了工单，请重新选择');
  const orders = [...input.orders].sort((a, b) => a.id.localeCompare(b.id));
  const requestHash = createHash('sha256').update(JSON.stringify(orders.map(order => ({ ...order, assignments: Object.entries(order.assignments).sort() })))).digest('hex');
  const result = await db.$transaction(async tx => {
    await assertProductionAdmin(tx, actor);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-dispatch:${input.requestKey}`}))`;
    const replay = await tx.productionDispatchBatch.findUnique({ where: { id: input.requestKey } });
    if (replay) {
      if (replay.actorId !== actor.id || replay.requestHash !== requestHash) throw new ProductionInputError('提交内容已变化，请刷新后重新安排');
      return { notifications: [], completions: [], ids: orders.map(order => order.id) };
    }
    for (const row of orders) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(row.id)}))`;
    const previousOwners = await tx.productionJob.findMany({ where: { orderId: { in: orders.map(row => row.id) } }, select: { workerId: true } });
    for (const workerId of [...new Set([...orders.flatMap(row => Object.values(row.assignments)), ...previousOwners.map(row => row.workerId)])].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(workerId)}))`;
    const notifications = [];
    const completions: ProductionCompletionNotification[] = [];
    let count = 0;
    for (const row of orders) {
      const { order, targets } = await currentDispatchTargets(tx, row.id);
      if (order.revision !== row.revision || order.workOrderVersion !== row.version) throw new ProductionInputError(`${order.orderNo} 已修改，请刷新排单`);
      await assertNoHistoricalProductionReview(tx, order.id);
      if (await tx.orderChangeRequest.count({ where: { orderId: order.id, status: 'PENDING' } })) throw new ProductionInputError(`${order.orderNo} 有待审批修改，请先处理`);
      if (order.purpose === 'SAMPLE_SHIPMENT') throw new ProductionInputError(`${order.orderNo} 是寄样工单，请直接处理发货`);
      if (!['PENDING_FACTORY', 'SUBMITTED', 'CONFIRMED', 'RELEASED', 'FOILING', 'PACKING'].includes(order.status)) throw new ProductionInputError(`${order.orderNo} 当前不可排单，请核对工单状态`);
      count += targets.length;
      if (count > 100 || targets.length === 0) throw new ProductionInputError('请选择有生产任务的工单，每批最多 100 项');
      if (Object.keys(row.assignments).length !== targets.length || targets.some(target => !row.assignments[target.key])) throw new ProductionInputError(`${order.orderNo} 尚未安排全部生产师傅`);
      if (!order.simpleProduction && await tx.productionJob.count({ where: { orderId: order.id } })) throw new ProductionInputError('生产流程不一致，请核对工单');
      if (!order.simpleProduction && (await tx.productionOperation.count({ where: { orderId: order.id, OR: [
        { reports: { some: {} } }, { workOrderProgress: { some: {} } },
        { carriedCompletedQty: { gt: 0 } }, { carriedWorkOrderProgressQty: { gt: 0 } },
      ] } }) || await tx.productionProgressStep.count({ where: { orderId: order.id, OR: [
        { reports: { some: {} } }, { carriedCompletedQty: { gt: 0 } },
      ] } }) || await tx.productionTask.count({ where: { orderItem: { orderId: order.id }, OR: [
        { status: { in: ['IN_PROGRESS', 'COMPLETED'] } }, { completedQty: { gt: 0 } }, { pieceworkAmount: { gt: 0 } },
      ] } }))) throw new ProductionInputError(`${order.orderNo} 已有历史报工，请继续按原工序登记`);
      const workers = new Map<string, Awaited<ReturnType<typeof eligibleProductionWorker>>>();
      const currentJobs = await tx.productionJob.findMany({ where: { orderId: order.id, workOrderVersion: row.version } });
      const pastProduction = await tx.productionJob.findMany({ where: { orderId: order.id, workOrderVersion: { lt: row.version }, status: 'COMPLETED' } });
      for (const target of targets) {
        const prior = currentJobs.find(job => job.sourceKey === target.key);
        // Keeping a historical owner is not a new assignment (including inactive accounts).
        if (prior?.workerId === row.assignments[target.key]) {
          const owner = await tx.user.findUniqueOrThrow({ where: { id: prior.workerId } });
          workers.set(target.key, owner);
        } else {
          workers.set(target.key, await eligibleProductionWorker(tx, row.assignments[target.key], target));
        }
      }
      if (!['RELEASED', 'FOILING', 'PACKING'].includes(order.status)) {
        const released = await releaseFactoryOrderInTx(tx, { orderId: order.id, expectedRevision: row.revision, expectedWorkOrderVersion: row.version, printIdempotencyKey: createHash('sha256').update(`${input.requestKey}:${order.id}`).digest('hex') }, actor);
        if (released.postCommitNotification) notifications.push(released.postCommitNotification);
        if (released.completionNotification) completions.push(released.completionNotification);
      }
      let assignmentChanged = !order.simpleProduction;
      const links = await targetLinks(tx, order.id, row.version);
      for (const target of targets) {
        const link = links.get(target.key);
        if (!link) throw new ProductionInputError(`${order.orderNo} 缺少当前生产工序，请刷新后核对工单资料`);
        if (link.hasHistory) throw new ProductionInputError(`${order.orderNo} 已有历史报工，请核对原生产记录后处理`);
        const existing = await tx.productionJob.findFirst({ where: { orderId: order.id, workOrderVersion: row.version, sourceKey: target.key } });
        const worker = workers.get(target.key)!;
        if (existing) {
          if (existing.workerId === worker.id) continue;
          if (existing.status !== 'PENDING') throw new ProductionInputError(`${order.orderNo} 已登记生产或申请数量，不能转移归属`);
          const proof = await tx.productionFactReview.findUnique({ where: { jobId: existing.id } });
          if (proof?.status !== 'UNPRODUCED' || proof.jobRevision !== existing.revision) throw new ProductionInputError(`${order.orderNo} 请先在生产记录中核实原师傅尚未生产，再调整归属`);
          assignmentChanged = true;
          await tx.productionJob.update({ where: { id: existing.id }, data: { workerId: worker.id, workerName: worker.displayName, revision: { increment: 1 } } });
        } else {
          assignmentChanged = true;
          await tx.productionJob.create({ data: { orderId: order.id, workOrderVersion: row.version,
            operationId: link.operationId, progressStepId: link.progressStepId, workerId: worker.id, workerName: worker.displayName,
            sourceKey: target.key, label: target.label, plannedQty: target.quantity,
            manualPricing: order.kind === 'REWORK' || pastProduction.some(job => {
              const snapshot = job.snapshot as { lane?: string; items?: Array<{ id: string }> };
              return snapshot.lane === target.snapshot.lane && snapshot.items?.some(item => target.itemIds.includes(item.id));
            }), snapshot: target.snapshot } });
        }
      }
      await tx.order.update({ where: { id: order.id }, data: { simpleProduction: true, revision: { increment: 1 } } });
      if (assignmentChanged && !await tx.orderPrintJob.findFirst({ where: { orderId: order.id, workOrderVersion: row.version, state: 'PENDING', resolution: { is: null } } })) {
        const previousPrint = await tx.orderPrintJob.findFirst({ where: { orderId: order.id, workOrderVersion: row.version } });
        await createOrderPrintRequestInTx(tx, { orderId: order.id, workOrderVersion: row.version, printKind: previousPrint ? 'REPRINT' : 'INITIAL', reason: '生产师傅安排已更新，请核对纸质工单', idempotencyKey: createHash('sha256').update(`assignment-print:${input.requestKey}:${order.id}`).digest('hex') }, actor);
      }
      await tx.orderLog.create({ data: { orderId: order.id, operatorId: actor.id, action: 'PRODUCTION_ASSIGNED', changedFields: { version: row.version, assignments: targets.map(target => ({ task: target.label, workerId: workers.get(target.key)!.id, workerName: workers.get(target.key)!.displayName })) } } });
    }
    await tx.productionDispatchBatch.create({ data: { id: input.requestKey, requestHash, actorId: actor.id, result: { orderIds: orders.map(order => order.id) } } });
    return { notifications, completions, ids: orders.map(order => order.id) };
  }, { timeout: 30000 });
  for (const payload of result.notifications) await dispatchNotification('ORDER_SCHEDULED', payload, { dedupeKey: `notification:ORDER_SCHEDULED:${payload.orderId}` });
  for (const notification of result.completions) await dispatchProductionCompletionNotification(notification);
  return result.ids;
}
