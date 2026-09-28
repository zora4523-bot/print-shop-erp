import 'server-only';
import type { Prisma } from '@/generated/prisma/client';

/** Queryable obligations, including people with no wage row yet. Callers authorize. */
export async function listProductionWageObligations(tx: Pick<Prisma.TransactionClient, 'productionJob'>, input: { workerId?: string; workDate?: Date }) {
  const date = input.workDate;
  const jobs = await tx.productionJob.findMany({ where: {
    ...(input.workerId ? { workerId: input.workerId } : {}),
    OR: [
      { status: 'REQUESTED', ...(date ? { workDate: date } : {}) },
      { factReview: { is: { status: { in: ['OPEN', 'CONFLICT', 'WAGES_DUE'] }, ...(date ? { periodStart: { lte: date }, periodEnd: { gte: date } } : {}) } } },
    ],
  }, orderBy: [{ workerId: 'asc' }, { createdAt: 'asc' }], select: {
    id: true, orderId: true, workOrderVersion: true, label: true, status: true, workerId: true, workerName: true,
    workDate: true, requestedQty: true, worker: { select: { username: true } },
    order: { select: { orderNo: true, customName: true } },
    factReview: { select: { status: true, periodStart: true, periodEnd: true } },
  } });
  return jobs.map(job => ({ id: job.id, orderId: job.orderId, version: job.workOrderVersion, label: job.label,
    orderName: job.order.customName || job.order.orderNo, workerId: job.workerId, workerName: job.workerName, username: job.worker.username,
    status: job.factReview?.status === 'WAGES_DUE' ? 'WAGES_DUE' : job.status === 'REQUESTED' ? 'REQUESTED' : 'REVIEW',
    workDate: job.workDate?.toISOString().slice(0, 10) ?? null,
    periodStart: job.factReview?.periodStart.toISOString().slice(0, 10) ?? null, periodEnd: job.factReview?.periodEnd.toISOString().slice(0, 10) ?? null,
    quantity: job.requestedQty?.toString() ?? null,
  }));
}
