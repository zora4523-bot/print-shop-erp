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
import { currentDispatchTargets, eligibleProductionWorker, targetLinks } from './dispatch-targets';

export type ProductionActor = { id: string; role: Role };
export const dispatchSchema = z.object({
  requestKey: z.string().min(8).max(128),
  orders: z.array(z.object({ id: z.string().min(1), revision: z.number().int().positive(), version: z.number().int().positive(),
    assignments: z.record(z.string(), z.string().min(1)),
  }).strict()).min(1).max(20),
}).strict();
export type DispatchInput = z.infer<typeof dispatchSchema>;
export async function assertProductionAdmin(tx: Prisma.TransactionClient, actor: ProductionActor) {
  const account = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isActive: true } });
  if (actor.role !== 'ADMIN' || account?.role !== 'ADMIN' || !account.isActive) throw new Error('无权操作，请使用有效的管理员账号');
}
/** One transaction owns the batch, including release, prints and assignments. */
export async function publishProductionDispatch(raw: DispatchInput, actor: ProductionActor) {
  const input = dispatchSchema.parse(raw);
  if (new Set(input.orders.map(order => order.id)).size !== input.orders.length) throw new Error('重复选择了工单，请重新选择');
  const orders = [...input.orders].sort((a, b) => a.id.localeCompare(b.id));
  const requestHash = createHash('sha256').update(JSON.stringify(orders.map(order => ({ ...order, assignments: Object.entries(order.assignments).sort() })))).digest('hex');
  const result = await db.$transaction(async tx => {
    await assertProductionAdmin(tx, actor);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-dispatch:${input.requestKey}`}))`;
    const replay = await tx.productionDispatchBatch.findUnique({ where: { id: input.requestKey } });
    if (replay) {
      if (replay.actorId !== actor.id || replay.requestHash !== requestHash) throw new Error('提交内容已变化，请刷新后重新安排');
      return { notifications: [], ids: orders.map(order => order.id) };
    }
    for (const row of orders) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(row.id)}))`;
    for (const workerId of [...new Set(orders.flatMap(row => Object.values(row.assignments)))].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(workerId)}))`;
    const notifications = [];
    let count = 0;
    for (const row of orders) {
      const { order, targets } = await currentDispatchTargets(tx, row.id);
      if (order.revision !== row.revision || order.workOrderVersion !== row.version) throw new Error(`${order.orderNo} 已修改，请刷新排单`);
      if (await tx.orderChangeRequest.count({ where: { orderId: order.id, status: 'PENDING' } })) throw new Error(`${order.orderNo} 有待审批修改，请先处理`);
      if (!['CONFIRMED', 'RELEASED', 'FOILING', 'PACKING'].includes(order.status)) throw new Error(`${order.orderNo} 当前不可排单，请核对工单状态`);
      count += targets.length;
      if (count > 100 || targets.length === 0) throw new Error('请选择有生产任务的工单，每批最多 100 项');
      if (Object.keys(row.assignments).length !== targets.length || targets.some(target => !row.assignments[target.key])) throw new Error(`${order.orderNo} 尚未安排全部生产师傅`);
      if (!order.simpleProduction && await tx.productionJob.count({ where: { orderId: order.id } })) throw new Error('生产流程不一致，请核对工单');
      const workers = new Map<string, Awaited<ReturnType<typeof eligibleProductionWorker>>>();
      const currentJobs = await tx.productionJob.findMany({ where: { orderId: order.id, workOrderVersion: row.version } });
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
      }
      let assignmentChanged = !order.simpleProduction;
      const links = await targetLinks(tx, order.id, row.version);
      for (const target of targets) {
        const link = links.get(target.key);
        if (!link || link.hasHistory) throw new Error(`${order.orderNo} 已有历史报工，请核对原生产记录后处理`);
        const existing = await tx.productionJob.findFirst({ where: { orderId: order.id, workOrderVersion: row.version, sourceKey: target.key } });
        const worker = workers.get(target.key)!;
        if (existing) {
          if (existing.workerId === worker.id) continue;
          if (existing.status !== 'PENDING') throw new Error(`${order.orderNo} 已登记生产或申请数量，不能转移归属`);
          assignmentChanged = true;
          await tx.productionJob.update({ where: { id: existing.id }, data: { workerId: worker.id, workerName: worker.displayName, revision: { increment: 1 } } });
        } else {
          assignmentChanged = true;
          await tx.productionJob.create({ data: { orderId: order.id, workOrderVersion: row.version,
            operationId: link.operationId, progressStepId: link.progressStepId, workerId: worker.id, workerName: worker.displayName,
            sourceKey: target.key, label: target.label, plannedQty: target.quantity, manualPricing: order.kind === 'REWORK' || row.version > 1, snapshot: target.snapshot } });
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
    return { notifications, ids: orders.map(order => order.id) };
  }, { timeout: 30000 });
  for (const payload of result.notifications) await dispatchNotification('ORDER_SCHEDULED', payload, { dedupeKey: `notification:ORDER_SCHEDULED:${payload.orderId}` });
  return result.ids;
}
