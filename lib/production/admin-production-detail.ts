import 'server-only';
import { db } from '@/lib/db';
import { assertProductionAdmin, type ProductionActor } from './dispatch';

/** Internal DTO stays behind administrator authorization, separate from sales detail. */
export async function getAdminProductionDetail(orderId: string, actor: ProductionActor) {
  return db.$transaction(async tx => {
    await assertProductionAdmin(tx, actor);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, workOrderVersion: true } });
    const jobs = await tx.productionJob.findMany({ where: { orderId }, orderBy: [{ workOrderVersion: 'desc' }, { createdAt: 'asc' }],
      include: { factReview: true, wages: { include: { worker: { select: { displayName: true } } } } } });
    const workers = await tx.user.findMany({ where: { role: 'WORKER' }, select: { id: true, displayName: true }, orderBy: { displayName: 'asc' } });
    const settlements = await tx.pieceworkSettlement.findMany({ where: { reporterId: { in: [...new Set(jobs.map(job => job.workerId))] } }, select: { reporterId: true, workDate: true } });
    return { order, workers, jobs: jobs.map(job => ({ ...job,
      historical: job.workOrderVersion !== order.workOrderVersion || ['CANCELLED', 'SHIPPED', 'SETTLED', 'FINISHED'].includes(order.status),
      settledWorkDates: settlements.filter(row => row.reporterId === job.workerId).map(row => row.workDate.toISOString().slice(0, 10)),
    })) };
  });
}
