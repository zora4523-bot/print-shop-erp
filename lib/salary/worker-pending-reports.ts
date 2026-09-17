import { Prisma } from '../../generated/prisma/client';
import { db } from '../db';
import { paginationWindow, paginatedResult, parsePositiveInt } from '../admin/table';
import { shanghaiDayRange } from './daily-common';
import type { WorkerSalaryActor } from '../worker-portal';
import { WorkerPortalError } from '../worker-portal';

/** Only the signed-in worker's unlinked ledger entries; never other reporters. */
export async function listWorkerPendingReports(actor: WorkerSalaryActor, filters: {
  from?: string; to?: string; page?: string | string[];
} = {}) {
  if (actor.role !== 'WORKER') throw new WorkerPortalError('仅师傅账号可查看本人报工');
  return db.$transaction(async (tx) => {
    const worker = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isActive: true, workerType: true } });
    if (!worker?.isActive || worker.role !== 'WORKER' || !['MACHINE', 'PACKER'].includes(worker.workerType ?? '')) {
      throw new WorkerPortalError('账号未启用计件岗位，请联系管理员');
    }
    const where: Prisma.ProductionReportWhereInput = {
      reporterId: actor.id, settlementItem: null,
      reportedAt: { gte: filters.from ? shanghaiDayRange(filters.from).start : undefined, lt: filters.to ? shanghaiDayRange(filters.to).end : undefined },
    };
    const total = await tx.productionReport.count({ where });
    const window = paginationWindow(total, parsePositiveInt(filters.page, { defaultValue: 1 }), 20);
    const rows = await tx.productionReport.findMany({ where, skip: window.skip, take: window.take,
      orderBy: [{ reportedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, entryType: true, reportedAt: true, reportedCompletedQty: true, amount: true,
        operation: { select: { id: true, operationType: true, status: true, payrollReviewRequired: true, order: { select: { id: true, orderNo: true } } } } },
    });
    return paginatedResult(rows.map(({ reportedCompletedQty, ...row }) => ({ ...row, amount: row.amount.toString(), quantity: reportedCompletedQty.toString() })), total, window);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
