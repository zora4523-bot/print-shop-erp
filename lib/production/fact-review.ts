import { ProductionInputError } from '@/lib/production/input-error';
import { z } from 'zod';
import { db } from '@/lib/db';
import { parseStrictYmd } from '@/lib/auth/schemas';
import { databaseClockNow } from '@/lib/background-jobs/clock';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import { orderCascadeLockKey } from '@/lib/order/locks';
import { salaryIdentityLockKey } from '@/lib/salary/hourly-lock';
import { assertProductionAdmin, type ProductionActor } from './dispatch';
import { reconcileResolvedHistoryInTx } from './recovery-projection';
import { reconcileProductionOrderInTx } from './order-state';
import { dispatchProductionCompletionNotification } from '@/lib/production-completion';
import { includeHistoricalProductionInTx } from './conflict-resolution';

export const factReviewSchema = z.object({
  jobId: z.string().min(1), jobRevision: z.number().int().nonnegative(), reviewRevision: z.number().int().min(-1),
  mode: z.enum(['UNPRODUCED', 'OPEN', 'DISMISS_WAGE', 'INCLUDED_LATER']), reason: z.string().trim().min(1).max(500),
  periodStart: z.string().optional(), periodEnd: z.string().optional(), notActuallyProduced: z.boolean().optional(),
  relatedJobId: z.string().optional(), quantity: z.string().regex(/^[1-9]\d{0,9}$/).optional(), workDate: z.string().optional(), confirmedIncluded: z.boolean().optional(),
}).strict();

/** Explicit evidence is required; PENDING alone never means nothing was made. */
export async function reviewProductionFact(raw: z.infer<typeof factReviewSchema>, actor: ProductionActor) {
  const input = factReviewSchema.parse(raw);
  const result = await db.$transaction(async tx => {
    await assertProductionAdmin(tx, actor);
    const locator = await tx.productionJob.findUniqueOrThrow({ where: { id: input.jobId }, select: { orderId: true } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(locator.orderId)}))`;
    const job = await tx.productionJob.findUniqueOrThrow({ where: { id: input.jobId }, include: { factReview: true, operation: true, progressStep: true } });
    const owners = await tx.productionJob.findMany({ where: { orderId: job.orderId }, select: { workerId: true } });
    for (const workerId of [...new Set(owners.map(row => row.workerId))].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(workerId)}))`;
    const previous = job.factReview?.evidence as Record<string, unknown> | undefined;
    if (input.mode === 'INCLUDED_LATER' && job.factReview?.status === 'RESOLVED' && job.factReview.resolvedById === actor.id
      && previous?.resolution === 'INCLUDED_LATER' && previous.jobRevision === input.jobRevision && previous.relatedJobId === input.relatedJobId
      && previous.quantity === input.quantity && previous.workDate === input.workDate && job.factReview.reason === input.reason && input.confirmedIncluded) return { orderId: job.orderId };
    if (job.revision !== input.jobRevision || (job.factReview?.revision ?? -1) !== input.reviewRevision) throw new ProductionInputError('生产核对内容已变化，请刷新后核对');
    const now = await databaseClockNow(tx);
    if (input.mode === 'INCLUDED_LATER') {
      if (!job.factReview || !['OPEN', 'CONFLICT'].includes(job.factReview.status) || !['PENDING', 'CANCELLED', 'REQUESTED'].includes(job.status)) throw new ProductionInputError('该历史核对已经处理，请刷新核对');
      await includeHistoricalProductionInTx(tx, job, input, actor, now);
      await reconcileResolvedHistoryInTx(tx, job.orderId, actor.id);
      const completed = await reconcileProductionOrderInTx(tx, job.orderId, actor.id, now);
      return { orderId: job.orderId, notification: completed.notification };
    }
    if (input.mode === 'OPEN' && ['CONTINUED', 'INCLUDED_LATER'].includes(String(previous?.resolution))) throw new ProductionInputError('该任务已由新版承接或计入后续登记，不能作为独立漏登记重复核定');
    const releasedAt = job.operation?.createdAt ?? job.progressStep?.createdAt;
    if (!releasedAt) throw new ProductionInputError('原生产任务资料缺失，请核对历史记录');
    if (input.mode === 'UNPRODUCED' && (!['PENDING', 'CANCELLED'].includes(job.status) || input.notActuallyProduced !== true || job.requestedQty)) throw new ProductionInputError('请先处理数量申请，并核实确实没有生产；已生产请补登记');
    if (input.mode === 'OPEN' && !['PENDING', 'CANCELLED', 'REQUESTED'].includes(job.status)) throw new ProductionInputError('已登记完成的真实生产不能再次建立漏登记');
    if (input.mode === 'DISMISS_WAGE' && job.factReview?.status !== 'WAGES_DUE') throw new ProductionInputError('只有待补发工资义务可以据证关闭');
    const periodStart = job.workDate ?? parseStrictYmd(input.periodStart ?? todayShanghai(releasedAt));
    const periodEnd = job.workDate ?? parseStrictYmd(input.periodEnd ?? todayShanghai(now));
    if (!periodStart || !periodEnd || periodStart > periodEnd || todayShanghai(periodStart) < todayShanghai(releasedAt)
      || periodEnd.toISOString().slice(0, 10) > todayShanghai(now)) throw new ProductionInputError('核对期间须在原任务下发至今天之间');
    const status = input.mode === 'DISMISS_WAGE' ? 'DISMISSED' : input.mode;
    const resolved = status !== 'OPEN';
    const evidence = { previousStatus: job.factReview?.status ?? null, jobStatus: job.status, jobRevision: job.revision,
      workerId: job.workerId, workerName: job.workerName, notActuallyProduced: input.notActuallyProduced ?? false,
      ...(input.mode === 'DISMISS_WAGE' ? { originalEvidence: job.factReview!.evidence, completedFactPreserved: true } : {}) };
    await tx.productionFactReview.upsert({ where: { jobId: job.id }, create: { jobId: job.id, jobRevision: job.revision, status, periodStart, periodEnd, reason: input.reason, evidence,
      createdById: actor.id, resolvedById: resolved ? actor.id : null, resolvedAt: resolved ? now : null },
      update: { jobRevision: job.revision, status, periodStart, periodEnd, reason: input.reason, evidence, resolvedById: resolved ? actor.id : null, resolvedAt: resolved ? now : null, revision: { increment: 1 } } });
    await tx.orderLog.create({ data: { orderId: job.orderId, operatorId: actor.id, action: 'PRODUCTION_FACT_REVIEWED', remark: input.reason,
      changedFields: { jobId: job.id, before: job.factReview?.status ?? null, after: status, evidence } } });
    if (status === 'UNPRODUCED' && job.factReview && ['OPEN', 'CONFLICT'].includes(job.factReview.status)) {
      await reconcileResolvedHistoryInTx(tx, job.orderId, actor.id);
      const completed = await reconcileProductionOrderInTx(tx, job.orderId, actor.id, now);
      return { orderId: job.orderId, notification: completed.notification };
    }
    return { orderId: job.orderId };
  });
  if (result.notification) await dispatchProductionCompletionNotification(result.notification);
  return result.orderId;
}
