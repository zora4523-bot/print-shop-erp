import 'server-only';

import { Role } from '@/generated/prisma/enums';
import { UnauthorizedError } from '@/lib/auth/errors';
import { db } from '@/lib/db';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { getAdminOrderByOrderNo, type AdminOrdersActor } from './admin-workspace';
import { getAdminOrderInlineOperations } from './admin-inline-operations';

type OrderVersion = {
  id: string; orderNo: string; revision: number; editVersion: number;
  workOrderVersion: number; priceRevision?: number;
};

/** Admin-only presentation data. The existing detail query has already enforced order scope. */
export async function getAdminOrderDetailPresentation(actor: AdminOrdersActor, order: OrderVersion) {
  if (actor.role !== Role.ADMIN) throw new UnauthorizedError('仅管理员可读取工单管理详情');
  const workspace = await getAdminOrderByOrderNo(actor, order.orderNo);
  if (!workspace) return null;
  const [inlineOperations, printJobs, workReports] = await Promise.all([
    getAdminOrderInlineOperations(actor, workspace),
    db.orderPrintJob.findMany({
      where: { orderId: order.id, requestJobId: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true, workOrderVersion: true, state: true, createdAt: true,
        resolution: { select: { state: true, createdAt: true } },
      },
    }),
    db.productionWorkOrderProgress.findMany({
      where: { orderId: order.id, workOrderVersion: order.workOrderVersion },
      orderBy: [{ reportedAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true, reportedAt: true, stage: true, workOrderProgressQuantity: true,
        workOrderVersion: true, reporter: { select: { displayName: true } },
      },
    }),
  ]);
  // A pricing or document edit between the independently guarded reads must not
  // place old line amounts next to newer totals or enable actions for a stale view.
  const current = await db.order.findUnique({
    where: { id: order.id },
    select: { revision: true, editVersion: true, workOrderVersion: true, priceRevision: true },
  });
  if (!current || current.revision !== order.revision || current.editVersion !== order.editVersion ||
    current.workOrderVersion !== order.workOrderVersion || current.priceRevision !== order.priceRevision ||
    workspace.id !== order.id || workspace.revision !== order.revision ||
    workspace.editVersion !== order.editVersion || workspace.workOrderVersion !== order.workOrderVersion) return null;
  return {
    workspace: { ...workspace, inlineOperations },
    prints: printJobs.map((job) => ({
      id: job.id, version: job.workOrderVersion, state: job.resolution?.state ?? job.state,
      at: formatDateTimeShanghai(job.resolution?.createdAt ?? job.createdAt),
    })),
    workReports: workReports.map((report) => ({
      id: report.id, reportedAt: report.reportedAt, stage: report.stage,
      quantity: report.workOrderProgressQuantity.toString(), workOrderVersion: report.workOrderVersion,
      reporterName: report.reporter.displayName, cumulative: null,
    })),
  };
}
