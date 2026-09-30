import Decimal from 'decimal.js';
import { productionScopesOverlap } from './production-scope';
import { createHash } from 'node:crypto';
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
import { dispatchProductionCompletionNotification } from '@/lib/production-completion';
import { completionPricingBasis } from './completion-pricing';
import { priceCompletionQuantity } from './completion-wage';
import { reconcileProductionOrderInTx } from './order-state';
import { assertNoHistoricalProductionReview } from './fact-guards';
import { reconcileResolvedHistoryInTx } from './recovery-projection';
import { assertProductionAdmin, type ProductionActor } from './dispatch';

export const completionSchema = z.object({
  jobId: z.string().min(1), revision: z.number().int().nonnegative(),
  quantity: z.string().regex(/^[1-9]\d{0,9}$/),
  mode: z.enum(['COMPLETE', 'BACKFILL', 'APPROVE', 'REJECT', 'RECOVER']),
  reason: z.string().trim().max(500).default(''),
  workDate: z.string().optional(),
  notActuallyProduced: z.boolean().optional(),
  confirmedSettledDay: z.boolean().optional(),
  confirmedAdditionalProduction: z.boolean().optional(),
  reviewRevision: z.number().int().nonnegative().optional(),
  itemQuantities: z.record(z.string(), z.string().regex(/^(0|[1-9]\d{0,9})$/)).optional(),
}).strict();
type CompletionInput = z.infer<typeof completionSchema>;

async function lockProductionFactDay(tx: Prisma.TransactionClient, workerId: string, day: string) {
  const workDate = parseStrictYmd(day);
  if (!workDate) throw new Error('生产日期无效，请填写实际生产日期');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pieceworkReportingDayGateLockKey(day)}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pieceworkSettlementLockKey(workerId, day)}))`;
  const settlement = await tx.pieceworkSettlement.findUnique({ where: { reporterId_workDate: { reporterId: workerId, workDate } } });
  return { workDate, settlement };
}

/** Wage allocation and correction retain the strict original-day protection. */
export async function lockProductionWageDay(tx: Prisma.TransactionClient, workerId: string, day: string) {
  const { workDate, settlement } = await lockProductionFactDay(tx, workerId, day);
  if (settlement) throw new Error(`${day} 的工资已结算，请联系管理员核对历史工资`);
  return workDate;
}

export async function registerProductionCompletion(raw: CompletionInput, actor: ProductionActor) {
  const input = completionSchema.parse(raw);
  const requestHash = createHash('sha256').update(JSON.stringify([actor.id, input])).digest('hex');
  const result = await db.$transaction(async tx => {
    if (input.mode !== 'COMPLETE') await assertProductionAdmin(tx, actor);
    else if (actor.role !== 'WORKER') throw new Error('请使用生产师傅账号登记完成');
    // 业主 2026-10-01：师傅只按总数登记，各款实际数量按工单确定，由管理员核定/补登记。
    else if (input.itemQuantities) throw new Error('师傅按总数登记完成，逐款数量由管理员核定');
    const locator = await tx.productionJob.findUnique({ where: { id: input.jobId }, select: { orderId: true } });
    if (!locator) throw new Error('生产任务不存在，请刷新任务列表');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(locator.orderId)}))`;
    const job = await tx.productionJob.findUniqueOrThrow({ where: { id: input.jobId }, include: { order: true, operation: true, progressStep: true, factReview: true } });
    const owners = ['RECOVER', 'REJECT'].includes(input.mode)
      ? await tx.productionJob.findMany({ where: { orderId: job.orderId }, select: { workerId: true } }) : [job];
    for (const workerId of [...new Set(owners.map(row => row.workerId))].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(workerId)}))`;
    const worker = await tx.user.findUniqueOrThrow({ where: { id: job.workerId } });
    const current = job.workOrderVersion === job.order.workOrderVersion;
    const snapshot = job.snapshot as Prisma.JsonObject;
    if (input.mode === 'COMPLETE') {
      if (actor.id !== job.workerId || worker.role !== 'WORKER' || !worker.isActive) throw new Error('该工单未安排给你，请联系管理员核对');
      if (!current) throw new Error('工单已改版，请打开当前生产任务');
      if (!['RELEASED', 'FOILING', 'PACKING'].includes(job.order.status)) throw new Error('工单当前不能登记生产，请联系管理员核对状态');
      if (await tx.orderChangeRequest.count({ where: { orderId: job.orderId, status: 'PENDING' } })) throw new Error('工单修改待审批，请联系管理员核对实际生产');
    }
    if (!job.order.simpleProduction) throw new Error('请核对工单生产方式');
    if (snapshot.registrationRequestHash === requestHash && ['COMPLETED', 'REQUESTED'].includes(job.status)) return { orderId: job.orderId, status: job.status };
    if (job.revision !== input.revision) throw new Error('登记内容已变化，请刷新后核对');
    const historical = !current || ['CANCELLED', 'SHIPPED', 'SETTLED', 'FINISHED'].includes(job.order.status);
    if (historical && input.mode === 'APPROVE') throw new Error('请从历史生产核对入口核定原申请');
    if (input.mode === 'BACKFILL' && (historical || !['RELEASED', 'FOILING', 'PACKING', 'ON_HOLD'].includes(job.order.status))) throw new Error('请从历史生产核对入口处理，不能直接补登记');
    if (input.mode === 'RECOVER') {
      if (!job.factReview || !['OPEN', 'CONFLICT'].includes(job.factReview.status) || job.factReview.revision !== input.reviewRevision) throw new Error('历史核对记录已变化，请刷新后核对');
      // A later physical event cannot be silently reinterpreted by recovery.
      const successors = (await tx.productionJob.findMany({ where: { orderId: job.orderId, workOrderVersion: { gt: job.workOrderVersion } }, include: { factReview: true } })).filter(next => productionScopesOverlap(job, next));
      if (input.confirmedAdditionalProduction && !(successors.some(next => next.status === 'COMPLETED') && successors.every(next => ['COMPLETED', 'CARRIED', 'CANCELLED'].includes(next.status)))) throw new Error('只有后续生产已登记且没有待做或待审批任务时，才能据证核定额外生产');
      const dependent = successors.find(next => ['COMPLETED', 'CARRIED', 'REQUESTED'].includes(next.status)
        || (next.status === 'PENDING' && (next.factReview?.status !== 'UNPRODUCED' || next.factReview.jobRevision !== next.revision)));
      if (dependent && !(input.confirmedAdditionalProduction === true && successors.every(next => ['COMPLETED', 'CARRIED', 'CANCELLED'].includes(next.status)))) {
        const conflict = `后续 v${dependent.workOrderVersion} 已有生产或尚未核实，请先处理后续任务，不能重复计产`;
        const evidence = { previousEvidence: job.factReview.evidence, dependentJobId: dependent.id, dependentRevision: dependent.revision, dependentStatus: dependent.status };
        await tx.productionFactReview.update({ where: { id: job.factReview.id }, data: { status: 'CONFLICT', reason: conflict, evidence, revision: { increment: 1 } } });
        await tx.orderLog.create({ data: { orderId: job.orderId, operatorId: actor.id, action: 'PRODUCTION_RECOVERY_CONFLICT', remark: conflict, changedFields: { jobId: job.id, evidence } } });
        return { orderId: job.orderId, status: 'CONFLICT', conflict };
      }
    } else if (historical && !['APPROVE', 'REJECT'].includes(input.mode)) throw new Error('请从历史生产核对入口处理');
    if (!['RECOVER', 'REJECT'].includes(input.mode)) await assertNoHistoricalProductionReview(tx, job.orderId, job.id);
    if (!['PENDING', 'REQUESTED'].includes(job.status) && !(job.status === 'CANCELLED' && (input.mode === 'RECOVER' || (input.mode === 'REJECT' && job.requestedQty && job.factReview && ['OPEN', 'CONFLICT'].includes(job.factReview.status))))) throw new Error('该生产任务已经处理，请刷新查看');
    if (input.mode === 'REJECT') {
      if (!job.requestedQty || !input.reason || input.notActuallyProduced !== true || !job.workDate) throw new Error('请确认没有实际生产，并填写驳回依据；已生产但数量有误请核定正确数量');
      const day = job.workDate.toISOString().slice(0, 10);
      await lockProductionFactDay(tx, job.workerId, day);
      await tx.orderLog.create({ data: { orderId: job.orderId, operatorId: actor.id, action: 'PRODUCTION_QUANTITY_REJECTED', remark: input.reason,
        changedFields: { jobId: job.id, rejectedRevision: job.revision, workerId: job.workerId, requestedQty: job.requestedQty?.toString() ?? null, workDate: day, requestReason: job.requestReason, notActuallyProduced: true } } });
      await tx.productionJob.update({ where: { id: job.id }, data: { status: historical ? 'CANCELLED' : 'PENDING', requestedQty: null, requestReason: null, requestedAt: null, workDate: null,
        snapshot: { ...snapshot, registrationPricing: null, registrationRequestHash: null }, revision: { increment: 1 } } });
      await tx.productionFactReview.upsert({ where: { jobId: job.id }, create: { jobId: job.id, jobRevision: job.revision + 1, status: 'UNPRODUCED', periodStart: job.workDate, periodEnd: job.workDate, reason: input.reason, evidence: { notActuallyProduced: true }, createdById: actor.id, resolvedById: actor.id, resolvedAt: new Date() },
        update: { status: 'UNPRODUCED', jobRevision: job.revision + 1, reason: input.reason, resolvedById: actor.id, resolvedAt: new Date(), revision: { increment: 1 } } });
      if (historical) await reconcileResolvedHistoryInTx(tx, job.orderId, actor.id);
      const completed = await reconcileProductionOrderInTx(tx, job.orderId, actor.id, await databaseClockNow(tx));
      return { orderId: job.orderId, status: historical ? 'CANCELLED' : 'PENDING', notification: completed.notification };
    }
    if (job.status === 'REQUESTED' && !['APPROVE', 'RECOVER'].includes(input.mode)) throw new Error('数量申请待审批，请联系管理员处理');
    if (input.mode === 'APPROVE' && job.status !== 'REQUESTED') throw new Error('数量申请已处理，请刷新查看');
    if (input.mode !== 'COMPLETE' && !input.reason) throw new Error('请填写核定或补登记说明');
    const now = await databaseClockNow(tx);
    const day = input.mode === 'COMPLETE' ? todayShanghai(now) : job.workDate?.toISOString().slice(0, 10) ?? input.workDate;
    const releasedAt = typeof snapshot.productionStartedAt === 'string' ? new Date(snapshot.productionStartedAt) : job.operation?.createdAt ?? job.progressStep?.createdAt;
    if (!day || !releasedAt || day > todayShanghai(now) || day < todayShanghai(releasedAt)) throw new Error('生产日期须在原任务下发至今天之间，请核对日期');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('print-shop-erp:piecework-price-book:publish'))`;
    const { workDate, settlement } = await lockProductionFactDay(tx, job.workerId, day);
    if (settlement && (input.mode === 'COMPLETE' || input.confirmedSettledDay !== true)) throw new Error('原生产日工资已结算；请核对后确认仅登记事实及待补工资，登记后不能撤销生产事实');
    if (input.mode === 'COMPLETE' && todayShanghai(await databaseClockNow(tx)) !== day) throw new Error('日期已变化，请刷新后核对实际生产日期');
    if (!employmentCoversDate(workDate, worker)) throw new Error('生产日期不在师傅的雇佣期间，请核对日期');
    const quantity = new Decimal(input.quantity);
    const basis = await completionPricingBasis(tx, job, job.requestedAt ?? (day === todayShanghai(now) ? now : new Date(`${day}T12:00:00+08:00`)));
    if (input.mode === 'COMPLETE' && !quantity.eq(job.plannedQty.toString())) {
      if (!input.reason) throw new Error('请填写数量修改原因');
      await tx.productionJob.update({ where: { id: job.id }, data: { status: 'REQUESTED', requestedQty: input.quantity, requestReason: input.reason, requestedAt: now, workDate,
        snapshot: { ...snapshot, registrationPricing: basis, registrationRequestHash: requestHash }, revision: { increment: 1 } } });
      await tx.orderLog.create({ data: { orderId: job.orderId, operatorId: actor.id, action: 'PRODUCTION_QUANTITY_REQUESTED', remark: input.reason, changedFields: { jobId: job.id, plannedQty: job.plannedQty.toString(), requestedQty: input.quantity, workDate: day, pricing: basis } } });
      return { orderId: job.orderId, status: 'REQUESTED' };
    }
    const items = z.array(z.object({ id: z.string(), quantity: z.number().int().positive() })).nonempty().parse(snapshot.items);
    const plannedByItem = (snapshot.productionQuantities as Record<string, string> | undefined) ?? Object.fromEntries(items.map(item => [item.id, String(item.quantity)]));
    const actualByItem = input.itemQuantities ?? (items.length === 1 ? { [items[0].id]: quantity.toString() } : quantity.eq(job.plannedQty.toString()) ? plannedByItem : null);
    if (!actualByItem || Object.keys(actualByItem).length !== items.length || items.some(item => actualByItem[item.id] === undefined)
      || !Object.values(actualByItem).reduce((sum, qty) => sum.plus(qty), new Decimal(0)).eq(quantity)) throw new Error('请逐款核对实际生产数量，各款合计须与核定数量一致');
    const amount = priceCompletionQuantity(basis, quantity);
    const wageSnapshot: Prisma.InputJsonObject = { ...basis, jobId: job.id, workerName: job.workerName, completedQty: quantity.toString(), actualItemQuantities: actualByItem, actorId: actor.id, workDate: day, reason: input.reason,
      ...(input.mode === 'RECOVER' ? { resolution: input.confirmedAdditionalProduction ? 'ADDITIONAL_PRODUCTION' : 'RECOVERED', projectionPending: !input.confirmedAdditionalProduction } : {}) };
    await tx.productionJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', completedQty: quantity.toString(), completedAt: now, workDate,
      snapshot: { ...snapshot, registrationPricing: basis, registrationRequestHash: requestHash, actualItemQuantities: actualByItem,
        fulfilledQuantities: Object.fromEntries(items.map(item => [item.id, String(item.quantity)])) },
      recordedById: actor.id, recordSource: input.mode === 'COMPLETE' ? 'WORKER_SCAN' : input.mode === 'BACKFILL' ? 'ADMIN_BACKFILL' : input.mode === 'RECOVER' ? 'HISTORICAL_REVIEW' : 'QUANTITY_APPROVAL', revision: { increment: 1 } } });
    if (settlement && job.operationId) {
      const evidence = { ...wageSnapshot, settlementId: settlement.id, expectedAmount: amount, paidAmount: '0' };
      await tx.productionFactReview.upsert({ where: { jobId: job.id }, create: { jobId: job.id, jobRevision: job.revision + 1, status: 'WAGES_DUE', periodStart: workDate, periodEnd: workDate, reason: input.reason, evidence, createdById: actor.id, resolvedById: actor.id, resolvedAt: now },
        update: { jobRevision: job.revision + 1, status: 'WAGES_DUE', periodStart: workDate, periodEnd: workDate, reason: input.reason, evidence, resolvedById: actor.id, resolvedAt: now, revision: { increment: 1 } } });
    } else {
      if (job.operationId) {
        const existingWage = await tx.productionWage.findUnique({ where: { jobId_workerId_workDate: { jobId: job.id, workerId: job.workerId, workDate } } });
        if (existingWage && !existingWage.amount?.isZero()) throw new Error('已有提成记录，请核对是否重复登记');
        const wage = existingWage ? await tx.productionWage.update({ where: { id: existingWage.id }, data: { amount, revision: { increment: 1 }, snapshot: wageSnapshot } })
          : await tx.productionWage.create({ data: { jobId: job.id, workerId: job.workerId, workDate, amount, snapshot: wageSnapshot } });
        if (amount !== null) await tx.productionWageEntry.create({ data: { wageId: wage.id, amount, actorId: actor.id, reason: '实际生产完成计件', requestKey: `completion:${job.id}:${job.revision}`, snapshot: wageSnapshot } });
      }
      if (job.factReview) await tx.productionFactReview.update({ where: { id: job.factReview.id }, data: { status: 'RESOLVED', jobRevision: job.revision + 1, resolvedById: actor.id, resolvedAt: now, revision: { increment: 1 }, evidence: wageSnapshot } });
    }
    await tx.orderLog.create({ data: { orderId: job.orderId, operatorId: actor.id, action: 'PRODUCTION_REGISTERED', remark: input.reason || null,
      changedFields: { jobId: job.id, workerId: job.workerId, workerName: job.workerName, plannedQty: job.plannedQty.toString(), requestedQty: job.requestedQty?.toString() ?? null,
        actualQty: quantity.toString(), actualItemQuantities: actualByItem, workDate: day, source: input.mode, settledDayWagesDue: !!settlement && !!job.operationId } } });
    if (input.mode === 'RECOVER') await reconcileResolvedHistoryInTx(tx, job.orderId, actor.id);
    const completed = await reconcileProductionOrderInTx(tx, job.orderId, actor.id, now);
    return { orderId: job.orderId, status: 'COMPLETED', notification: completed.notification };
  });
  if ('conflict' in result && result.conflict) throw new Error(result.conflict);
  if ('notification' in result && result.notification) await dispatchProductionCompletionNotification(result.notification);
  return { orderId: result.orderId, status: result.status };
}
