import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { orderCascadeLockKey } from '@/lib/order/locks';
import { salaryIdentityLockKey } from '@/lib/salary/hourly-lock';
import { assertProductionAdmin, type ProductionActor } from './dispatch';
import { lockProductionWageDay } from './completion-registration';

export const correctionSchema = z.object({ jobId: z.string().min(1), revision: z.number().int().nonnegative(), requestKey: z.string().min(8).max(100), reason: z.string().trim().min(1).max(500), notActuallyProduced: z.literal(true) }).strict();
export async function correctProductionRegistration(raw: z.infer<typeof correctionSchema>, actor: ProductionActor) {
  const input = correctionSchema.parse(raw);
  const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return db.$transaction(async tx => {
    await assertProductionAdmin(tx, actor);
    const locator = await tx.productionJob.findUnique({ where: { id: input.jobId }, select: { orderId: true } });
    if (!locator) throw new Error('生产记录不存在，请刷新查看');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(locator.orderId)}))`;
    const replay = await tx.productionDispatchBatch.findUnique({ where: { id: `correction:${input.requestKey}` } });
    if (replay) {
      if (replay.requestHash !== requestHash || replay.actorId !== actor.id) throw new Error('提交内容已变化，请重新核对');
      return locator.orderId;
    }
    const job = await tx.productionJob.findUniqueOrThrow({ where: { id: input.jobId }, include: { order: { include: { shipments: true } }, wages: true } });
    if (job.status !== 'COMPLETED' || job.revision !== input.revision || job.workOrderVersion !== job.order.workOrderVersion) throw new Error('记录已变化或已有后续生产，请刷新核对');
    if (!['RELEASED', 'FOILING', 'PACKING'].includes(job.order.status) || job.order.shipments.some(row => row.status === 'SHIPPED')) throw new Error('工单已关闭、暂停或发货，不能更正生产登记');
    if (await tx.orderChangeRequest.count({ where: { orderId: job.orderId, status: 'PENDING' } })) throw new Error('存在待审批修改，请先处理');
    const wages = [...job.wages].sort((a, b) => a.workerId.localeCompare(b.workerId));
    for (const wage of wages) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(wage.workerId)}))`;
    for (const wage of wages) await lockProductionWageDay(tx, wage.workerId, wage.workDate.toISOString().slice(0, 10));
    const changedFields = { jobId: job.id, correctionRevision: job.revision + 1, requestKey: input.requestKey,
      before: { status: job.status, workerId: job.workerId, workerName: job.workerName, completedQty: job.completedQty?.toString() ?? null,
        workDate: job.workDate?.toISOString() ?? null, completedAt: job.completedAt?.toISOString() ?? null, recordedById: job.recordedById, recordSource: job.recordSource,
        wages: wages.map(wage => ({ id: wage.id, workerId: wage.workerId, amount: wage.amount?.toString() ?? null })) },
      reason: input.reason, notActuallyProduced: true };
    await tx.orderLog.create({ data: { orderId: job.orderId, operatorId: actor.id, action: 'PRODUCTION_ERROR_CORRECTED', remark: input.reason, changedFields } });
    for (const wage of wages) {
      await tx.productionWage.update({ where: { id: wage.id }, data: { amount: '0', revision: { increment: 1 }, snapshot: { correction: changedFields, workDate: wage.workDate.toISOString().slice(0, 10) } } });
      await tx.productionWageEntry.create({ data: { wageId: wage.id, amount: wage.amount?.negated().toString() ?? '0', actorId: actor.id, reason: input.reason, requestKey: `${input.requestKey}:${wage.id}`, snapshot: changedFields } });
    }
    await tx.productionJob.update({ where: { id: job.id }, data: { status: 'PENDING', revision: { increment: 1 }, completedQty: null, completedAt: null, workDate: null, recordedById: null, recordSource: null, requestedQty: null, requestReason: null, requestedAt: null } });
    if (job.operationId) await tx.productionOperation.update({ where: { id: job.operationId }, data: { status: 'PENDING' } });
    if (job.progressStepId) await tx.productionProgressStep.update({ where: { id: job.progressStepId }, data: { status: 'PENDING' } });
    await tx.order.update({ where: { id: job.orderId }, data: { status: 'RELEASED', completedAt: null } });
    await tx.productionDispatchBatch.create({ data: { id: `correction:${input.requestKey}`, requestHash, actorId: actor.id, result: { orderId: job.orderId } } });
    return job.orderId;
  });
}
