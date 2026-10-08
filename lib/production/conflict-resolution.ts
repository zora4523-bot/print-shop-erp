import { ProductionInputError } from '@/lib/production/input-error';
import Decimal from 'decimal.js';
import type { Prisma, ProductionJob } from '@/generated/prisma/client';
import { parseStrictYmd } from '@/lib/auth/schemas';
import type { ProductionActor } from './dispatch';

/** Link a duplicate historical registration to the one actual, paid/pending fact. */
export async function includeHistoricalProductionInTx(tx: Prisma.TransactionClient, job: ProductionJob, input: {
  relatedJobId?: string; quantity?: string; workDate?: string; confirmedIncluded?: boolean; reason: string;
}, actor: ProductionActor, now: Date) {
  if (!input.relatedJobId || !input.quantity || input.confirmedIncluded !== true || !input.workDate) throw new ProductionInputError('请核对关联生产、原日期与数量，并确认已经计入后续登记');
  const quantity = new Decimal(input.quantity);
  if (job.requestedQty && !quantity.eq(job.requestedQty.toString())) throw new ProductionInputError('旧申请必须全部计入后续登记；只有部分包含时请保留核对，不能关闭整条义务');
  const date = parseStrictYmd(input.workDate);
  const later = await tx.productionJob.findUnique({ where: { id: input.relatedJobId }, include: { wages: true } });
  const oldSnapshot = job.snapshot as Prisma.JsonObject;
  const nextSnapshot = later?.snapshot as Prisma.JsonObject | undefined;
  if (!date || !later || later.orderId !== job.orderId || later.workOrderVersion <= job.workOrderVersion || later.status !== 'COMPLETED'
    || later.workerId !== job.workerId || !later.workDate || later.workDate.getTime() !== date.getTime()
    || (job.workDate && job.workDate.getTime() !== date.getTime()) || !later.completedQty || new Decimal(input.quantity).gt(later.completedQty.toString())
    || typeof oldSnapshot.fingerprint !== 'string' || oldSnapshot.fingerprint !== nextSnapshot?.fingerprint) throw new ProductionInputError('只有原师傅、原日、相同实物且数量已包含的后续完成记录可关联；资料不匹配时请保留核对，不能把同一批产量重复登记');
  if (job.operationId && !later.wages.some(wage => wage.workerId === job.workerId && wage.workDate.getTime() === date.getTime())) throw new ProductionInputError('后续记录缺少原师傅原日工资义务，请先核对工资');
  if (await tx.productionWage.count({ where: { jobId: job.id } })) throw new ProductionInputError('旧任务已有工资，不能自动合并历史工资');
  const included = await tx.productionFactReview.findMany({ where: { status: 'RESOLVED', evidence: { path: ['relatedJobId'], equals: later.id } }, select: { evidence: true } });
  const used = included.reduce((sum, review) => sum.plus(String((review.evidence as Prisma.JsonObject).quantity)), new Decimal(0));
  if (used.plus(quantity).gt(later.completedQty.toString())) throw new ProductionInputError('关联登记可包含的数量不足，请核对其他旧记录，不能重复包含同一批产量');
  const evidence = { resolution: 'INCLUDED_LATER', jobId: job.id, jobRevision: job.revision, relatedJobId: later.id, relatedRevision: later.revision,
    workerId: job.workerId, workDate: input.workDate, quantity: input.quantity, requestedQty: job.requestedQty?.toString() ?? null, noNewProductionOrWage: true };
  await tx.orderLog.create({ data: { orderId: job.orderId, operatorId: actor.id, action: 'PRODUCTION_INCLUDED_LATER', remark: input.reason, changedFields: evidence } });
  await tx.productionJob.update({ where: { id: job.id }, data: { status: 'CANCELLED', workDate: date, revision: { increment: 1 } } });
  await tx.productionFactReview.update({ where: { jobId: job.id }, data: { status: 'RESOLVED', jobRevision: job.revision + 1, reason: input.reason,
    evidence, resolvedById: actor.id, resolvedAt: now, revision: { increment: 1 } } });
}
