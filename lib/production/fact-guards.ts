import { ProductionInputError } from '@/lib/production/input-error';
import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';

const UNRESOLVED_FACT_STATUSES = ['OPEN', 'CONFLICT'];

/** A submitted request and an unverified missing registration are both obligations. */
export async function assertProductionFactsReadyForChange(tx: Prisma.TransactionClient, orderId: string, knownOrder?: { simpleProduction: boolean; workOrderVersion: number }, metadataOnly = false) {
  const order = knownOrder ?? await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { simpleProduction: true, workOrderVersion: true } });
  if (!order.simpleProduction) return;
  const jobs = await tx.productionJob.findMany({ where: { orderId }, include: { factReview: true } });
  for (const job of jobs) {
    if (job.status === 'REQUESTED') throw new ProductionInputError(`请先核定${job.workerName}的${job.label}数量申请（工单 v${job.workOrderVersion}）`);
    if (job.factReview && UNRESOLVED_FACT_STATUSES.includes(job.factReview.status)) throw new ProductionInputError(`请先核对${job.workerName}的${job.label}历史生产记录（工单 v${job.workOrderVersion}）`);
    if (!metadataOnly && job.status === 'PENDING' && job.workOrderVersion === order.workOrderVersion
      && !(job.factReview?.status === 'UNPRODUCED' && job.factReview.jobRevision === job.revision)) {
      throw new ProductionInputError(`请先核实${job.workerName}的${job.label}是否已生产；已做请补登记，未做请记录核对依据`);
    }
  }
}

/** Caller holds the order lock; unrelated orders remain usable. */
export async function assertNoHistoricalProductionReview(tx: Prisma.TransactionClient, orderId: string, exceptJobId?: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { workOrderVersion: true } });
  const pending = await tx.productionJob.findFirst({ where: { orderId, ...(exceptJobId ? { id: { not: exceptJobId } } : {}),
    OR: [
      { factReview: { is: { status: { in: UNRESOLVED_FACT_STATUSES } } } },
      { workOrderVersion: { lt: order.workOrderVersion }, status: 'REQUESTED' },
    ],
  } });
  if (pending) throw new ProductionInputError(`请先核对工单 v${pending.workOrderVersion} 中${pending.workerName}的${pending.label}生产记录`);
}

/** Bind review previews to facts, including a zero-production verification. */
export async function productionFactsToken(tx: Prisma.TransactionClient, orderId: string) {
  const jobs = await tx.productionJob.findMany({ where: { orderId }, orderBy: { id: 'asc' }, select: {
    id: true, revision: true, status: true, plannedQty: true, completedQty: true, requestedQty: true,
    workDate: true, factReview: { select: { status: true, revision: true, jobRevision: true } },
  } });
  return createHash('sha256').update(JSON.stringify(jobs)).digest('hex');
}
