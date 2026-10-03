import 'server-only';
import { db } from '@/lib/db';
import { assertProductionAdmin, type ProductionActor } from './dispatch';
import { readProductionRouting } from './routing';
import { inspectOrderProductionReadinessInTx } from '@/lib/order/production-readiness';

/** Internal DTO stays behind administrator authorization, separate from sales detail. */
export async function getAdminProductionDetail(orderId: string, actor: ProductionActor) {
  return db.$transaction(async tx => {
    await assertProductionAdmin(tx, actor);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, workOrderVersion: true, simpleProduction: true } });
    const jobs = await tx.productionJob.findMany({ where: { orderId }, orderBy: [{ workOrderVersion: 'desc' }, { createdAt: 'asc' }],
      include: { factReview: true, wages: { include: { worker: { select: { displayName: true } } } } } });
    const workers = await tx.user.findMany({ where: { role: 'WORKER' }, select: { id: true, displayName: true }, orderBy: { displayName: 'asc' } });
    const settlements = await tx.pieceworkSettlement.findMany({ where: { reporterId: { in: [...new Set(jobs.map(job => job.workerId))] } }, select: { reporterId: true, workDate: true } });
    const routing = (await readProductionRouting(tx, [orderId])).get(orderId);
    const pending = ['PENDING_FACTORY', 'SUBMITTED', 'CONFIRMED'].includes(order.status);
    const pendingReady = pending && (await inspectOrderProductionReadinessInTx(tx, orderId)).ready;
    const active = ['RELEASED', 'FOILING', 'PACKING'].includes(order.status);
    const legacyHistory = !order.simpleProduction && (await tx.productionOperation.count({ where: { orderId, OR: [{ reports: { some: {} } }, { workOrderProgress: { some: {} } }, { carriedCompletedQty: { gt: 0 } }, { carriedWorkOrderProgressQty: { gt: 0 } }] } })
      || await tx.productionProgressStep.count({ where: { orderId, OR: [{ reports: { some: {} } }, { carriedCompletedQty: { gt: 0 } }] } })
      || await tx.productionTask.count({ where: { orderItem: { orderId }, OR: [{ status: { in: ['IN_PROGRESS', 'COMPLETED'] } }, { completedQty: { gt: 0 } }, { pieceworkAmount: { gt: 0 } }] } }));
    const currentJobs = jobs.filter(job => job.workOrderVersion === order.workOrderVersion);
    const canAssign = routing?.kind === 'ASSIGN' && !legacyHistory && (pendingReady || (active && (!currentJobs.length || currentJobs.some(job => job.status === 'PENDING'))));
    return { order, workers, canAssign, jobs: jobs.map(job => ({ ...job,
      historical: job.workOrderVersion !== order.workOrderVersion || ['CANCELLED', 'SHIPPED', 'SETTLED', 'FINISHED'].includes(order.status),
      settledWorkDates: settlements.filter(row => row.reporterId === job.workerId).map(row => row.workDate.toISOString().slice(0, 10)),
    })) };
  });
}
