import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { databaseClockNow } from '@/lib/background-jobs/clock';
import { parseStrictYmd } from '@/lib/auth/schemas';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import { orderCascadeLockKey } from '@/lib/order/locks';
import { employmentCoversDate } from '@/lib/salary/employment';
import { salaryIdentityLockKey } from '@/lib/salary/hourly-lock';
import { PieceworkPricingError } from '@/lib/salary/piecework-pricing';
import { FoilWageInputError } from '@/lib/salary/foil-wage';
import { ProductionInputError } from './input-error';
import { dispatchProductionCompletionNotification, type ProductionCompletionNotification } from '@/lib/production-completion';
import { registerProductionCompletionInTx, type PlannedCompletionRecordSource } from './completion-registration';
import type { ProductionActor } from './dispatch';

/**
 * 业主 2026-10-01：单人流程工单一旦生产就是工单数量。师傅没点完成时，管理员批量完成
 * 或确认发货（填物流单号）即按计划数量代为登记完成并计提成，生产日期记为当天。
 * 有数量待审批、仍有未安排师傅的生产、或师傅当天不在雇佣期时一律拦下，不做部分登记。
 */
export class PlannedCompletionError extends Error {
  constructor(
    readonly code: 'ORDER_NOT_FOUND' | 'STALE_VERSION' | 'NOT_SIMPLE_PRODUCTION' | 'INVALID_STATUS' | 'CHANGE_PENDING'
      | 'QUANTITY_PENDING' | 'UNASSIGNED_PRODUCTION' | 'WORKER_UNAVAILABLE' | 'NOTHING_TO_COMPLETE' | 'REGISTRATION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'PlannedCompletionError';
  }
}

const COMPLETABLE_STATUSES = ['RELEASED', 'FOILING', 'PACKING'] as const;
const REASONS: Record<PlannedCompletionRecordSource, string> = {
  ADMIN_BATCH: '管理员批量完成，按计划数量登记',
  SHIPMENT_AUTO: '确认发货，按计划数量自动登记完成',
};

type Client = Pick<Prisma.TransactionClient, 'productionJob' | 'productionOperation' | 'productionProgressStep'>;

/** Current-version facts that decide whether the order can be completed at plan. */
async function loadPlannedCompletion(client: Client, orderId: string, workOrderVersion: number) {
  const [jobs, operations, steps] = await Promise.all([
    client.productionJob.findMany({ where: { orderId, workOrderVersion, status: { not: 'CANCELLED' } },
      select: { id: true, revision: true, label: true, workerId: true, workerName: true, plannedQty: true, status: true, operationId: true, progressStepId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    // Same remaining-unit rule as reopenAssignedProductionInTx: packing is not registered in this flow.
    client.productionOperation.findMany({ where: { orderId, workOrderVersion, status: { in: ['PENDING', 'IN_PROGRESS'] }, operationType: { not: 'PACKING' } }, select: { id: true } }),
    client.productionProgressStep.findMany({ where: { orderId, workOrderVersion, status: { in: ['PENDING', 'IN_PROGRESS'] } }, select: { id: true } }),
  ]);
  const linkedOperations = new Set(jobs.flatMap(job => job.operationId ? [job.operationId] : []));
  const linkedSteps = new Set(jobs.flatMap(job => job.progressStepId ? [job.progressStepId] : []));
  return {
    pending: jobs.filter(job => job.status === 'PENDING'),
    requested: jobs.filter(job => job.status === 'REQUESTED'),
    unassignedUnits: operations.filter(row => !linkedOperations.has(row.id)).length + steps.filter(row => !linkedSteps.has(row.id)).length,
  };
}

/** Read-only preview for the shipping and batch confirmations. */
export async function getPlannedCompletionPreview(orderId: string, workOrderVersion: number) {
  const plan = await loadPlannedCompletion(db, orderId, workOrderVersion);
  return {
    pendingJobs: plan.pending.map(job => ({ label: job.label, workerName: job.workerName, plannedQty: job.plannedQty.toString() })),
    requestedCount: plan.requested.length,
    unassignedUnits: plan.unassignedUnits,
  };
}

/**
 * Completes every pending current-version job at its planned quantity inside the
 * caller's transaction. All-or-nothing: any blocker throws and the caller rolls back.
 * Returns the order-completion notification for the caller to dispatch after commit.
 */
export async function completePlannedProductionInTx(tx: Prisma.TransactionClient, orderId: string, actor: ProductionActor, source: PlannedCompletionRecordSource) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(orderId)}))`;
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { simpleProduction: true, status: true, workOrderVersion: true } });
  if (!order) throw new PlannedCompletionError('ORDER_NOT_FOUND', '工单不存在，请刷新后核对');
  if (!order.simpleProduction) throw new PlannedCompletionError('NOT_SIMPLE_PRODUCTION', '该工单按工序扫码报工，请按工序登记');
  if (!(COMPLETABLE_STATUSES as readonly string[]).includes(order.status)) throw new PlannedCompletionError('INVALID_STATUS', '工单当前状态不能登记生产完成');
  if (await tx.orderChangeRequest.count({ where: { orderId, status: 'PENDING' } })) throw new PlannedCompletionError('CHANGE_PENDING', '工单修改待审批，请先处理变更');
  const plan = await loadPlannedCompletion(tx, orderId, order.workOrderVersion);
  if (plan.requested.length) throw new PlannedCompletionError('QUANTITY_PENDING', `有 ${plan.requested.length} 个生产任务数量待审批，请先审批`);
  if (plan.unassignedUnits) throw new PlannedCompletionError('UNASSIGNED_PRODUCTION', '仍有未安排师傅的生产，请先排单');
  const today = todayShanghai(await databaseClockNow(tx));
  const workDate = parseStrictYmd(today)!;
  // Every registration below takes worker lock → price-book → day gate → worker day.
  // Take all worker locks first (sorted, like dispatch) so a second worker's lock is never
  // requested while this transaction already holds the global day gate.
  for (const workerId of [...new Set(plan.pending.map(job => job.workerId))].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(workerId)}))`;
  }
  const workers = await tx.user.findMany({ where: { id: { in: [...new Set(plan.pending.map(job => job.workerId))] } },
    select: { id: true, displayName: true, isActive: true, role: true, employmentStartDate: true, employmentEndDate: true } });
  const unavailable = workers.filter(worker => !worker.isActive || worker.role !== 'WORKER' || !employmentCoversDate(workDate, worker));
  if (unavailable.length) throw new PlannedCompletionError('WORKER_UNAVAILABLE', `${unavailable.map(worker => worker.displayName).join('、')} 当前不能登记生产，请先改派生产任务`);
  let notification: ProductionCompletionNotification | undefined;
  for (const job of plan.pending) {
    try {
      const result = await registerProductionCompletionInTx(tx, { jobId: job.id, revision: job.revision, quantity: job.plannedQty.toString(), mode: 'BACKFILL',
        reason: REASONS[source], workDate: today }, actor, { recordSource: source });
      notification = result.notification ?? notification;
    } catch (error) {
      // Curated domain messages only; unknown failures keep propagating unchanged.
      if (error instanceof PieceworkPricingError || error instanceof ProductionInputError || error instanceof FoilWageInputError) {
        throw new PlannedCompletionError('REGISTRATION_FAILED', `${job.workerName}（${job.label}）：${error.message}`);
      }
      throw error;
    }
  }
  return { completedJobs: plan.pending.map(job => ({ id: job.id, label: job.label, workerName: job.workerName, plannedQty: job.plannedQty.toString() })), notification };
}

/** Batch entry: one order per transaction, guarded by the reviewed revision. */
export async function completeOrderProductionAtPlan(input: { orderId: string; expectedRevision: number; expectedWorkOrderVersion: number }, actor: ProductionActor) {
  const result = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(input.orderId)}))`;
    const order = await tx.order.findUnique({ where: { id: input.orderId }, select: { revision: true, workOrderVersion: true } });
    if (!order) throw new PlannedCompletionError('ORDER_NOT_FOUND', '工单不存在，请刷新后核对');
    if (order.revision !== input.expectedRevision || order.workOrderVersion !== input.expectedWorkOrderVersion) {
      throw new PlannedCompletionError('STALE_VERSION', '工单已更新，请刷新后重新选择');
    }
    const completed = await completePlannedProductionInTx(tx, input.orderId, actor, 'ADMIN_BATCH');
    if (!completed.completedJobs.length) throw new PlannedCompletionError('NOTHING_TO_COMPLETE', '没有待完成的生产任务');
    return completed;
  });
  if (result.notification) await dispatchProductionCompletionNotification(result.notification);
  return result;
}

/**
 * Whole-order shipping entry (shipOrder's own transaction). `order` is the locked read
 * taken by the ship transition. Returns null when there is nothing to complete or the
 * reviewed versions are already stale (the ship guard then reports it).
 */
export async function completePlannedProductionBeforeShipInTx(tx: Prisma.TransactionClient,
  order: { id: string; simpleProduction?: boolean; status: string; revision: number; editVersion: number; workOrderVersion: number; priceRevision: number },
  actor: ProductionActor,
  expected: { expectedRevision: number; expectedEditVersion: number; expectedWorkOrderVersion: number; expectedPriceRevision: number }) {
  if (!order.simpleProduction || (order.status !== 'RELEASED' && order.status !== 'FOILING')) return null;
  if (order.revision !== expected.expectedRevision || order.editVersion !== expected.expectedEditVersion
    || order.workOrderVersion !== expected.expectedWorkOrderVersion || order.priceRevision !== expected.expectedPriceRevision) return null;
  const { notification, completedJobs } = await completePlannedProductionInTx(tx, order.id, actor, 'SHIPMENT_AUTO');
  const after = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, revision: true, editVersion: true, workOrderVersion: true, priceRevision: true } });
  return { notification, completedJobCount: completedJobs.length, status: after.status, versions: { revision: after.revision, editVersion: after.editVersion, workOrderVersion: after.workOrderVersion, priceRevision: after.priceRevision } };
}
