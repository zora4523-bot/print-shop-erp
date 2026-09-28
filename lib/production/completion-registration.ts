import Decimal from 'decimal.js';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { databaseClockNow } from '@/lib/background-jobs/clock';
import { parseStrictYmd } from '@/lib/auth/schemas';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import { orderCascadeLockKey } from '@/lib/order/locks';
import { salaryIdentityLockKey } from '@/lib/salary/hourly-lock';
import { pieceworkReportingDayGateLockKey, pieceworkSettlementLockKey } from '@/lib/salary/piecework-lock';
import { employmentCoversDate } from '@/lib/salary/employment';
import { resolveReporterPieceworkRate } from '@/lib/salary/piecework-rate-selection';
import { calculateFoilJobWage, fullFoilColorCount } from '@/lib/salary/foil-wage';
import { maybeCompleteProductionOrder, dispatchProductionCompletionNotification, type ProductionCompletionTx } from '@/lib/production-completion';
import { assertProductionAdmin, type ProductionActor } from './dispatch';

export const completionSchema = z.object({
  jobId: z.string().min(1), revision: z.number().int().nonnegative(),
  quantity: z.string().regex(/^[1-9]\d{0,9}$/),
  mode: z.enum(['COMPLETE', 'BACKFILL', 'APPROVE', 'REJECT']),
  reason: z.string().trim().max(500).default(''),
  workDate: z.string().optional(),
}).strict();
export type CompletionInput = z.infer<typeof completionSchema>;

export async function lockProductionWageDay(tx: Prisma.TransactionClient, workerId: string, day: string) {
  const workDate = parseStrictYmd(day);
  if (!workDate) throw new Error('生产日期无效，请填写实际生产日期');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pieceworkReportingDayGateLockKey(day)}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pieceworkSettlementLockKey(workerId, day)}))`;
  if (await tx.pieceworkSettlement.findUnique({ where: { reporterId_workDate: { reporterId: workerId, workDate } } })) throw new Error(`${day} 的工资已结算，请联系管理员核对历史工资`);
  return workDate;
}

async function priceCompletion(tx: Prisma.TransactionClient, job: Prisma.ProductionJobGetPayload<{ include: { operation: { include: { sources: { include: { orderItem: true } } } } } }>, quantity: Decimal, at: Date) {
  if (job.manualPricing) return { amount: null, snapshot: { mode: 'MANUAL_REVISION' } };
  const op = job.operation;
  if (!op) return { amount: null, snapshot: { mode: 'NON_PIECEWORK' } };
  const selected = await resolveReporterPieceworkRate(tx, job.workerId, op.operationType, op.unit, at);
  const { rule, book } = selected;
  const pieceQty = op.sources.reduce((sum, source) => sum.plus(source.orderItem?.quantity ?? 0), new Decimal(0));
  if (!pieceQty.gt(0)) throw new Error('生产数量依据不完整，请核对工单');
  let multiplier = op.operationType === 'PARTIAL' ? op.payrollPassCount ?? op.plannedQty.div(pieceQty).toNumber() : 1;
  if (op.operationType === 'FULL' && rule.smallOrderAmount !== null && rule.setupAmount !== null) {
    const counts = op.sources.map(source => source.orderItem ? fullFoilColorCount(source.orderItem.frontFoilColors, source.orderItem.backFoilColors) : 0);
    if (!counts.length || counts.some(count => count !== counts[0])) return { amount: null, snapshot: { mode: 'MANUAL_MIXED_COLORS', priceBookId: book.id } };
    multiplier = counts[0];
  }
  const amount = rule.smallOrderAmount !== null && rule.setupAmount !== null
    ? calculateFoilJobWage(quantity.toNumber(), multiplier, { pieceRate: rule.amount.toString(), smallOrderAmount: rule.smallOrderAmount.toString(), setupAmount: rule.setupAmount.toString() }).totalAmount
    : quantity.mul(multiplier).mul(rule.amount.toString()).toFixed(2, Decimal.ROUND_HALF_UP);
  return { amount, snapshot: { mode: 'AUTOMATIC', priceBookId: book.id, priceBookVersion: book.version, ruleSetSha256: book.ruleSetSha256,
    source: selected.source, policyBookId: selected.policy?.id ?? null, policyBookVersion: selected.policy?.version ?? null, useUnifiedRates: selected.policy?.useUnifiedRates ?? true, rate: rule.amount.toString(), smallOrderAmount: rule.smallOrderAmount?.toString() ?? null,
    setupAmount: rule.setupAmount?.toString() ?? null, multiplier, quantity: quantity.toString() } };
}

export async function registerProductionCompletion(raw: CompletionInput, actor: ProductionActor) {
  const input = completionSchema.parse(raw);
  const result = await db.$transaction(async tx => {
    if (input.mode !== 'COMPLETE') await assertProductionAdmin(tx, actor);
    else if (actor.role !== 'WORKER') throw new Error('请使用生产师傅账号登记完成');
    const locator = await tx.productionJob.findUnique({ where: { id: input.jobId }, select: { orderId: true } });
    if (!locator) throw new Error('生产任务不存在，请刷新任务列表');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(locator.orderId)}))`;
    const job = await tx.productionJob.findUniqueOrThrow({ where: { id: input.jobId }, include: { order: true, operation: { include: { sources: { include: { orderItem: true } } } } } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(job.workerId)}))`;
    const worker = await tx.user.findUniqueOrThrow({ where: { id: job.workerId } });
    if (input.mode === 'COMPLETE' && (actor.id !== job.workerId || worker.role !== 'WORKER' || !worker.isActive)) throw new Error('该工单未安排给你，请联系管理员核对');
    if (job.workOrderVersion !== job.order.workOrderVersion) throw new Error('工单已改版，请打开当前生产任务');
    if (job.status === 'COMPLETED' && job.completedQty?.eq(input.quantity)) return { orderId: job.orderId, status: job.status };
    if (job.revision !== input.revision) throw new Error('登记内容已变化，请刷新后核对');
    if (!['RELEASED', 'FOILING', 'PACKING'].includes(job.order.status) || !job.order.simpleProduction) throw new Error('工单当前不能登记生产，请联系管理员核对状态');
    if (await tx.orderChangeRequest.count({ where: { orderId: job.orderId, status: 'PENDING' } })) throw new Error('工单修改待审批，请处理后重新登记');
    if (!['PENDING', 'REQUESTED'].includes(job.status)) throw new Error('该生产任务已经处理，请刷新查看');
    if (input.mode === 'REJECT') {
      if (job.status !== 'REQUESTED' || !input.reason) throw new Error('请填写数量申请的驳回原因');
      await tx.productionJob.update({ where: { id: job.id }, data: { status: 'PENDING', requestedQty: null, requestReason: null, requestedAt: null, workDate: null, revision: { increment: 1 } } });
      await tx.orderLog.create({ data: { orderId: job.orderId, operatorId: actor.id, action: 'PRODUCTION_QUANTITY_REJECTED', remark: input.reason, changedFields: { jobId: job.id, quantity: job.requestedQty?.toString() } } });
      return { orderId: job.orderId, status: 'PENDING' };
    }
    if (job.status === 'REQUESTED' && input.mode !== 'APPROVE') throw new Error('数量申请待审批，请联系管理员处理');
    if (input.mode === 'APPROVE' && job.status !== 'REQUESTED') throw new Error('数量申请已处理，请刷新查看');
    if (input.mode !== 'COMPLETE' && !input.reason) throw new Error('请填写核定或补登记说明');
    const now = await databaseClockNow(tx);
    const day = input.mode === 'COMPLETE' ? todayShanghai(now) : input.mode === 'APPROVE' ? job.workDate?.toISOString().slice(0, 10) : input.workDate;
    if (!day || day > todayShanghai(now) || day < todayShanghai(job.order.scheduledAt ?? job.order.createdAt) || (job.workOrderVersion > 1 && day < todayShanghai(job.createdAt))) throw new Error('生产日期须在下发至今天之间，请核对日期');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('print-shop-erp:piecework-price-book:publish'))`;
    const workDate = await lockProductionWageDay(tx, job.workerId, day);
    if (input.mode === 'COMPLETE' && todayShanghai(await databaseClockNow(tx)) !== day) throw new Error('日期已变化，请刷新后核对实际生产日期');
    if (!employmentCoversDate(workDate, worker)) throw new Error('生产日期不在师傅的雇佣期间，请核对日期');
    const quantity = new Decimal(input.quantity);
    if (input.mode === 'APPROVE' && !job.requestedQty?.eq(quantity)) throw new Error('审批数量与申请不一致，请刷新后核对');
    if (input.mode === 'COMPLETE' && !quantity.eq(job.plannedQty.toString())) {
      if (!input.reason) throw new Error('请填写数量修改原因');
      await tx.productionJob.update({ where: { id: job.id }, data: { status: 'REQUESTED', requestedQty: input.quantity, requestReason: input.reason, requestedAt: now, workDate, revision: { increment: 1 } } });
      await tx.orderLog.create({ data: { orderId: job.orderId, operatorId: actor.id, action: 'PRODUCTION_QUANTITY_REQUESTED', remark: input.reason, changedFields: { jobId: job.id, plannedQty: job.plannedQty.toString(), requestedQty: input.quantity, workDate: day } } });
      return { orderId: job.orderId, status: 'REQUESTED' };
    }
    const priced = await priceCompletion(tx, job, quantity, day === todayShanghai(now) ? now : new Date(`${day}T12:00:00+08:00`));
    await tx.productionJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', completedQty: quantity.toString(), completedAt: now, workDate,
      recordedById: actor.id, recordSource: input.mode === 'COMPLETE' ? 'WORKER_SCAN' : input.mode === 'BACKFILL' ? 'ADMIN_BACKFILL' : 'QUANTITY_APPROVAL', revision: { increment: 1 } } });
    if (job.operationId) await tx.productionOperation.update({ where: { id: job.operationId }, data: { status: 'COMPLETED' } });
    if (job.progressStepId) await tx.productionProgressStep.update({ where: { id: job.progressStepId }, data: { status: 'COMPLETED' } });
    // No artificial zero wage for no-pay craft progress. Revised paid jobs owe a pending wage.
    if (job.operationId) {
      const snapshot: Prisma.InputJsonObject = { ...priced.snapshot, jobId: job.id, workerName: job.workerName, completedQty: quantity.toString(), actorId: actor.id, workDate: day, reason: input.reason };
      const existingWage = await tx.productionWage.findUnique({ where: { jobId_workerId_workDate: { jobId: job.id, workerId: job.workerId, workDate } } });
      if (existingWage && !existingWage.amount?.isZero()) throw new Error('已有提成记录，请核对是否重复登记');
      const wage = existingWage ? await tx.productionWage.update({ where: { id: existingWage.id }, data: { amount: priced.amount, revision: { increment: 1 }, snapshot } })
        : await tx.productionWage.create({ data: { jobId: job.id, workerId: job.workerId, workDate, amount: priced.amount, snapshot } });
      if (priced.amount !== null) await tx.productionWageEntry.create({ data: { wageId: wage.id, amount: priced.amount, actorId: actor.id, reason: '实际生产完成计件', requestKey: `completion:${job.id}:${job.revision}`, snapshot } });

    }
    await tx.orderLog.create({ data: { orderId: job.orderId, operatorId: actor.id, action: 'PRODUCTION_REGISTERED', remark: input.reason || null,
      changedFields: { jobId: job.id, workerId: job.workerId, workerName: job.workerName, plannedQty: job.plannedQty.toString(), requestedQty: job.requestedQty?.toString() ?? null, actualQty: quantity.toString(), workDate: day, source: input.mode } } });
    const completed = await maybeCompleteProductionOrder(tx as unknown as ProductionCompletionTx, job.orderId, actor.id, now);
    return { orderId: job.orderId, status: 'COMPLETED', notification: completed.notification };
  });
  if ('notification' in result && result.notification) await dispatchProductionCompletionNotification(result.notification);
  return { orderId: result.orderId, status: result.status };
}
