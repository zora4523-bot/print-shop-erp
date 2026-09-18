import { db } from '@/lib/db';
import { paginationWindow, paginatedResult, parsePositiveInt } from '@/lib/admin/table';
import { assertWorkerPortalActor } from '@/lib/production/worker-report-portal';
import type { Role } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';

export async function listWorkerSettlementPage(actor: { id: string; role: Role }, input: { from?: Date; to?: Date; page?: string | string[]; status?: string }) {
  await assertWorkerPortalActor(actor);
  const periodWhere: Prisma.PieceworkSettlementWhereInput = { reporterId: actor.id, workDate: { gte: input.from, lte: input.to } };
  const where: Prisma.PieceworkSettlementWhereInput = { ...periodWhere };
  if (input.status === 'paid') where.status = 'PAID';
  if (input.status === 'unpaid') where.status = { not: 'PAID' };
  return db.$transaction(async (tx) => {
    const [total, sum, unpaid] = await Promise.all([
      tx.pieceworkSettlement.count({ where }),
      tx.pieceworkSettlement.aggregate({ where: periodWhere, _sum: { payableAmount: true } }),
      tx.pieceworkSettlement.aggregate({ where: { ...periodWhere, status: { not: 'PAID' } }, _sum: { payableAmount: true } }),
    ]);
    const window = paginationWindow(total, parsePositiveInt(input.page, { defaultValue: 1 }), 20);
    const rows = await tx.pieceworkSettlement.findMany({ where, skip: window.skip, take: window.take,
      orderBy: [{ workDate: 'desc' }, { id: 'desc' }],
      select: { id: true, workDate: true, status: true, reportAmount: true, adjustmentAmount: true, payableAmount: true, _count: { select: { items: true } } },
    });
    return { ...paginatedResult(rows, total, window), totalAmount: sum._sum.payableAmount?.toString() ?? '0', unpaidAmount: unpaid._sum.payableAmount?.toString() ?? '0' };
  }, { isolationLevel: 'RepeatableRead' });
}
