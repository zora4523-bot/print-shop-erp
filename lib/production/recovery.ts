import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { databaseClockNow } from '@/lib/background-jobs/clock';
import { orderCascadeLockKey } from '@/lib/order/locks';
import { salaryIdentityLockKey } from '@/lib/salary/hourly-lock';
import { createOrderPrintRequestInTx } from '@/lib/order/print-jobs';
import { dispatchProductionCompletionNotification, maybeCompleteProductionOrder, type ProductionCompletionTx } from '@/lib/production-completion';
import { activateProductionOperationsInTx } from './operation-materialization-service';
import { assertProductionAdmin, type ProductionActor } from './dispatch';
import { assertNoHistoricalProductionReview } from './fact-guards';

export const productionRecoverySchema = z.object({
  orderId: z.string().min(1), revision: z.number().int().positive(), version: z.number().int().positive(),
  mode: z.enum(['RELEASE_REWORK', 'FIX_FIRST_PRICING']), requestKey: z.string().min(8).max(100), reason: z.string().trim().min(1).max(500),
}).strict();

/** Read-only inventory; facts without a reliable quantity/date are never guessed. */
export async function scanProductionRecovery() {
  const [orders, jobs] = await Promise.all([
    db.order.findMany({ where: { simpleProduction: true, kind: 'REWORK', status: 'SCHEDULING' }, select: { id: true, orderNo: true, revision: true, workOrderVersion: true } }),
    db.productionJob.findMany({ where: { OR: [{ status: { in: ['REQUESTED', 'CANCELLED', 'PENDING'] } }, { factReview: { isNot: null } }] },
      include: { order: { select: { orderNo: true, status: true, workOrderVersion: true, kind: true, revision: true } }, factReview: true,
        wages: { select: { id: true, settlementId: true, workDate: true, amount: true } } }, orderBy: [{ orderId: 'asc' }, { workOrderVersion: 'asc' }, { id: 'asc' }] }),
  ]);
  const [laterJobs, settlements] = await Promise.all([
    db.productionJob.findMany({ where: { orderId: { in: [...new Set(jobs.map(job => job.orderId))] } }, select: {
      id: true, orderId: true, workOrderVersion: true, workerId: true, revision: true, status: true, workDate: true, completedQty: true,
      wages: { select: { id: true, workDate: true, amount: true, settlementId: true } },
    } }),
    db.pieceworkSettlement.findMany({ where: { reporterId: { in: [...new Set(jobs.map(job => job.workerId))] } }, select: { id: true, reporterId: true, workDate: true, status: true } }),
  ]);
  return { unreleasedRework: orders, jobs: jobs.filter(job => job.status === 'REQUESTED' || job.factReview || job.manualPricing || job.workOrderVersion < job.order.workOrderVersion || ['CANCELLED', 'SHIPPED', 'SETTLED', 'FINISHED'].includes(job.order.status)).map(job => ({
    id: job.id, orderId: job.orderId, orderNo: job.order.orderNo, orderStatus: job.order.status, orderRevision: job.order.revision,
    version: job.workOrderVersion, currentVersion: job.order.workOrderVersion, jobRevision: job.revision,
    workerId: job.workerId, workerName: job.workerName, workDate: job.workDate, requestedQty: job.requestedQty?.toString() ?? null,
    completedQty: job.completedQty?.toString() ?? null, status: job.status, manualPricing: job.manualPricing,
    review: job.factReview ? { status: job.factReview.status, revision: job.factReview.revision, periodStart: job.factReview.periodStart, periodEnd: job.factReview.periodEnd } : null,
    laterProduction: laterJobs.filter(later => later.orderId === job.orderId && later.workOrderVersion > job.workOrderVersion),
    originalSettlements: settlements.filter(row => row.reporterId === job.workerId && (job.workDate ? row.workDate.getTime() === job.workDate.getTime()
      : job.factReview ? row.workDate >= job.factReview.periodStart && row.workDate <= job.factReview.periodEnd : true)),
    wages: job.wages, next: job.factReview?.status === 'WAGES_DUE' ? '原账不变，待补发' : job.status === 'REQUESTED' || job.workOrderVersion < job.order.workOrderVersion ? '管理员核对原日、原量及后续生产，禁止自动改量' : '核对首次生产计价或重做下发条件',
    href: `/orders/${job.orderId}#production-job-${job.id}`,
  })) };
}

/** Only deterministic metadata repairs. Production recovery uses the audited UI. */
export async function repairProductionMetadata(raw: z.infer<typeof productionRecoverySchema>, actor: ProductionActor) {
  const input = productionRecoverySchema.parse(raw);
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const result = await db.$transaction(async tx => {
    await assertProductionAdmin(tx, actor);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(input.orderId)}))`;
    const key = `production-recovery:${input.requestKey}`;
    const replay = await tx.productionDispatchBatch.findUnique({ where: { id: key } });
    if (replay) {
      if (replay.requestHash !== hash || replay.actorId !== actor.id) throw new Error('恢复请求内容已变化，请重新扫描');
      return { orderId: input.orderId, replay: true };
    }
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: { productionJobs: { include: { wages: true } }, shipments: true } });
    if (!order.simpleProduction || order.revision !== input.revision || order.workOrderVersion !== input.version) throw new Error('恢复依据已变化，请重新扫描');
    for (const id of [...new Set(order.productionJobs.map(job => job.workerId))].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(id)}))`;
    await assertNoHistoricalProductionReview(tx, order.id);
    if (order.shipments.some(shipment => shipment.status === 'SHIPPED') || await tx.orderChangeRequest.count({ where: { orderId: order.id, status: 'PENDING' } })) throw new Error('已有发货或待审变更，不能自动恢复');
    if (order.productionJobs.some(job => ['COMPLETED', 'REQUESTED', 'CARRIED'].includes(job.status) || job.wages.length)) throw new Error('已有生产或工资事实，须人工核对历史，不允许自动改写');
    if (await tx.productionReport.count({ where: { operation: { orderId: order.id } } }) || await tx.productionProgressReport.count({ where: { progressStep: { orderId: order.id } } })) throw new Error('已有旧报工事实，请人工核对');
    if (input.mode === 'RELEASE_REWORK') {
      if (order.kind !== 'REWORK' || order.status !== 'SCHEDULING' || !order.sourceOrderId) throw new Error('仅恢复停在待排产的关联重做单');
      const source = await tx.order.findUniqueOrThrow({ where: { id: order.sourceOrderId }, select: { simpleProduction: true } });
      if (!source.simpleProduction) throw new Error('原单使用历史生产模式，请按原流程处理');
      await activateProductionOperationsInTx(tx, order.id, actor, undefined, { targetStatus: 'RELEASED' });
      if (!await tx.orderPrintJob.count({ where: { orderId: order.id, workOrderVersion: order.workOrderVersion } })) await createOrderPrintRequestInTx(tx, {
        orderId: order.id, workOrderVersion: order.workOrderVersion, printKind: 'INITIAL', reason: '恢复重做生产下发', idempotencyKey: hash,
      }, actor);
    } else {
      if (order.kind === 'REWORK' || !['RELEASED', 'FOILING', 'PACKING', 'ON_HOLD'].includes(order.status)) throw new Error('仅修正未生产的普通工单首次计价标记');
      for (const job of order.productionJobs.filter(row => row.workOrderVersion === input.version && row.status === 'PENDING' && row.manualPricing)) {
        await tx.productionJob.update({ where: { id: job.id }, data: { manualPricing: false, revision: { increment: 1 } } });
      }
    }
    await tx.order.update({ where: { id: order.id }, data: { revision: { increment: 1 } } });
    await tx.orderLog.create({ data: { orderId: order.id, operatorId: actor.id, action: 'PRODUCTION_METADATA_RECOVERED', remark: input.reason, changedFields: { mode: input.mode, requestKey: input.requestKey, beforeRevision: input.revision, historicalFactsPreserved: true } } });
    const completed = await maybeCompleteProductionOrder(tx as unknown as ProductionCompletionTx, order.id, actor.id, await databaseClockNow(tx));
    await tx.productionDispatchBatch.create({ data: { id: key, requestHash: hash, actorId: actor.id, result: { orderId: order.id } } });
    return { orderId: order.id, replay: false, notification: completed.notification };
  });
  if (result.notification) await dispatchProductionCompletionNotification(result.notification);
  return { orderId: result.orderId, replay: result.replay };
}
