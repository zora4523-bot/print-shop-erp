import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { orderCascadeLockKey } from '@/lib/order/locks';
import { assertProductionAdmin, type ProductionActor } from '@/lib/production/dispatch';
import { lockProductionWageDay } from '@/lib/production/completion-registration';
import { salaryIdentityLockKey } from './hourly-lock';
import { employmentCoversDate } from './employment';

export const productionWageSchema = z.object({
  jobId: z.string().min(1), requestKey: z.string().min(8).max(100), reason: z.string().trim().min(1).max(500),
  allocations: z.array(z.object({ workerId: z.string().min(1), amount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/), expectedRevision: z.number().int().min(-1) }).strict()).min(1).max(20),
}).strict();
export type ProductionWageInput = z.infer<typeof productionWageSchema>;
/** Final amounts, never extra whole amounts on top of an automatic wage. */
export async function allocateProductionWages(raw: ProductionWageInput, actor: ProductionActor) {
  const input = productionWageSchema.parse(raw);
  const allocations = [...input.allocations].sort((a, b) => a.workerId.localeCompare(b.workerId));
  if (new Set(allocations.map(row => row.workerId)).size !== allocations.length) throw new Error('参与师傅重复，请核对提成分配');
  const requestHash = createHash('sha256').update(JSON.stringify({ ...input, allocations })).digest('hex');
  return db.$transaction(async tx => {
    await assertProductionAdmin(tx, actor);
    const locator = await tx.productionJob.findUnique({ where: { id: input.jobId }, select: { orderId: true } });
    if (!locator) throw new Error('生产记录不存在，请刷新查看');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(locator.orderId)}))`;
    const replay = await tx.productionDispatchBatch.findUnique({ where: { id: `wage:${input.requestKey}` } });
    if (replay) {
      if (replay.requestHash !== requestHash || replay.actorId !== actor.id) throw new Error('提交内容已变化，请刷新后核对提成');
      return locator.orderId;
    }
    const job = await tx.productionJob.findUniqueOrThrow({ where: { id: input.jobId }, include: { wages: true } });
    if (job.status !== 'COMPLETED' || !job.workDate || !job.completedQty) throw new Error('尚未登记实际生产完成，请先核对生产记录');
    const currentWages = job.wages.filter(wage => wage.workDate.getTime() === job.workDate!.getTime());
    if (!allocations.some(row => row.workerId === job.workerId) || currentWages.some(wage => !allocations.some(row => row.workerId === wage.workerId))) throw new Error('请核对生产师傅及全部已登记参与人的最终提成');
    // Same sorted identity -> day -> worker/day order as account/report/settlement writers.
    for (const row of allocations) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(row.workerId)}))`;
    const workDate = job.workDate.toISOString().slice(0, 10);
    for (const row of allocations) await lockProductionWageDay(tx, row.workerId, workDate);
    for (const row of allocations) {
      const existing = currentWages.find(wage => wage.workerId === row.workerId);
      if ((existing?.revision ?? -1) !== row.expectedRevision || existing?.settlementId) throw new Error('提成已调整或结算，请刷新后核对');
      const worker = await tx.user.findUnique({ where: { id: row.workerId } });
      if (!worker || worker.role !== 'WORKER' || !employmentCoversDate(job.workDate, worker)) throw new Error('参与人或生产日期无效，请核对实际参与师傅');
      const amount = new Decimal(row.amount).toFixed(2);
      const difference = new Decimal(amount).minus(existing?.amount?.toString() ?? '0').toFixed(2);
      const snapshot: Prisma.InputJsonObject = { schemaVersion: 1, mode: 'MANUAL_ALLOCATION', jobId: job.id, workerName: worker.displayName, productionOwnerId: job.workerId,
        completedQty: job.completedQty.toString(), workDate, before: existing?.amount?.toString() ?? null, after: amount, reason: input.reason, actorId: actor.id };
      const wage = existing ? await tx.productionWage.update({ where: { id: existing.id }, data: { amount, revision: { increment: 1 }, snapshot } })
        : await tx.productionWage.create({ data: { jobId: job.id, workerId: row.workerId, workDate: job.workDate, amount, snapshot } });
      await tx.productionWageEntry.create({ data: { wageId: wage.id, amount: difference, actorId: actor.id, reason: input.reason, requestKey: `${input.requestKey}:${row.workerId}`, snapshot } });
    }
    await tx.productionDispatchBatch.create({ data: { id: `wage:${input.requestKey}`, requestHash, actorId: actor.id, result: { jobId: job.id } } });
    await tx.orderLog.create({ data: { orderId: job.orderId, operatorId: actor.id, action: 'PRODUCTION_WAGES_ALLOCATED', remark: input.reason, changedFields: { jobId: job.id, allocations } } });
    return job.orderId;
  });
}
