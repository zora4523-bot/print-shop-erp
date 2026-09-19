import { db } from '@/lib/db';
import { Role } from '@/generated/prisma/enums';
import { paginationWindow, paginatedResult, parsePositiveInt } from '@/lib/admin/table';
import { ReportDisputeError } from './report-dispute';
import type { Prisma } from '@/generated/prisma/client';

type Actor = { id: string; role: Role };
export async function assertWorkerPortalActor(actor: Actor) {
  if (actor.role !== Role.WORKER || !await db.user.findFirst({ where: { id: actor.id, role: Role.WORKER, isActive: true }, select: { id: true } })) {
    throw new ReportDisputeError('请使用已启用的师傅账号登录');
  }
}
export async function getWorkerReport(reportId: string, actor: Actor) {
  await assertWorkerPortalActor(actor);
  return db.productionReport.findFirst({ where: { id: reportId, reporterId: actor.id },
    include: { operation: { select: { id: true, operationType: true, payrollReviewRequired: true, order: { select: { id: true, orderNo: true, customName: true } } } },
      settlementItem: { select: { settlement: { select: { id: true, status: true } } } },
      disputes: { orderBy: { createdAt: 'desc' }, include: { resolvedBy: { select: { displayName: true } } } },
    },
  });
}
export async function listWorkerReports(actor: Actor, filters: { page?: string | string[]; q?: string; operationId?: string } = {}) {
  await assertWorkerPortalActor(actor);
  const q = filters.q?.trim().slice(0, 100);
  const where: Prisma.ProductionReportWhereInput = { reporterId: actor.id, operationId: filters.operationId,
    ...(q ? { operation: { order: { OR: [{ orderNo: { contains: q, mode: 'insensitive' } }, { customName: { contains: q, mode: 'insensitive' } }] } } } : {}),
  };
  return db.$transaction(async (tx) => {
    const total = await tx.productionReport.count({ where });
    const window = paginationWindow(total, parsePositiveInt(filters.page, { defaultValue: 1 }), 20);
    const rows = await tx.productionReport.findMany({ where, skip: window.skip, take: window.take,
      orderBy: [{ reportedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, reportedAt: true, reportedCompletedQty: true, amount: true, entryType: true,
        operation: { select: { operationType: true, payrollReviewRequired: true, order: { select: { orderNo: true, customName: true } } } },
      },
    });
    return paginatedResult(rows, total, window);
  }, { isolationLevel: 'RepeatableRead' });
}
