import { z } from 'zod';
import { db } from '@/lib/db';
import { Role } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';

export class ReportDisputeError extends Error {}
export const createReportDisputeSchema = z.object({
  reportId: z.string().min(1).max(128),
  reason: z.string().trim().min(5, '请填写至少 5 个字的问题说明').max(1000),
});
export const reviewReportDisputeSchema = z.object({
  disputeId: z.string().min(1).max(128),
  decision: z.enum(['RESOLVED', 'REJECTED']),
  resolution: z.string().trim().min(2, '请填写处理回复').max(1000),
});
type Actor = { id: string; role: Role };

async function assertActor(tx: Prisma.TransactionClient, actor: Actor, role: Role) {
  if (actor.role !== role || !await tx.user.findFirst({ where: { id: actor.id, role, isActive: true }, select: { id: true } })) {
    throw new ReportDisputeError('账号无权执行此操作，请重新登录');
  }
}

export async function createReportDispute(input: z.infer<typeof createReportDisputeSchema>, actor: Actor) {
  const parsed = createReportDisputeSchema.safeParse(input);
  if (!parsed.success) throw new ReportDisputeError('问题说明需为 5–1000 个字，请修改后重试');
  return db.$transaction(async (tx) => {
    await assertActor(tx, actor, Role.WORKER);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report-dispute:${parsed.data.reportId}`}))`;
    const report = await tx.productionReport.findFirst({
      where: { id: parsed.data.reportId, reporterId: actor.id },
      select: { id: true, operationId: true, operation: { select: { orderId: true } } },
    });
    if (!report) throw new ReportDisputeError('报工记录不存在或不属于本人，请返回报工列表');
    if (await tx.productionReportDispute.findFirst({ where: { reportId: report.id, status: 'PENDING' }, select: { id: true } })) {
      throw new ReportDisputeError('这条报工已有待处理问题，请查看管理员回复');
    }
    const dispute = await tx.productionReportDispute.create({ data: { reportId: report.id, reason: parsed.data.reason } });
    await tx.orderLog.create({ data: { orderId: report.operation.orderId, operatorId: actor.id,
      action: 'REPORT_DISPUTE_CREATED', remark: parsed.data.reason,
      changedFields: { reportId: { before: null, after: report.id }, disputeId: { before: null, after: dispute.id } },
    } });
    return { reportId: report.id, orderId: report.operation.orderId, operationId: report.operationId };
  });
}

export async function reviewReportDispute(input: z.infer<typeof reviewReportDisputeSchema>, actor: Actor) {
  const parsed = reviewReportDisputeSchema.safeParse(input);
  if (!parsed.success) throw new ReportDisputeError('处理回复需为 2–1000 个字，请修改后重试');
  return db.$transaction(async (tx) => {
    await assertActor(tx, actor, Role.ADMIN);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report-dispute-review:${input.disputeId}`}))`;
    const dispute = await tx.productionReportDispute.findUnique({ where: { id: input.disputeId },
      include: { report: { select: { operationId: true, operation: { select: { orderId: true } } } } },
    });
    if (!dispute || dispute.status !== 'PENDING') throw new ReportDisputeError('问题不存在或已处理，请刷新列表');
    await tx.productionReportDispute.update({ where: { id: dispute.id }, data: {
      status: parsed.data.decision, resolution: parsed.data.resolution, resolvedById: actor.id, resolvedAt: new Date(),
    } });
    await tx.orderLog.create({ data: { orderId: dispute.report.operation.orderId, operatorId: actor.id,
      action: 'REPORT_DISPUTE_REVIEWED', remark: parsed.data.resolution,
      changedFields: { disputeId: { before: dispute.id, after: dispute.id }, status: { before: dispute.status, after: parsed.data.decision } },
    } });
    return { reportId: dispute.reportId, orderId: dispute.report.operation.orderId, operationId: dispute.report.operationId };
  });
}

export async function listOrderReportDisputes(orderId: string, actor: Actor) {
  await assertActor(db, actor, Role.ADMIN);
  return db.productionReportDispute.findMany({ where: { report: { operation: { orderId } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { resolvedBy: { select: { displayName: true } }, report: { select: {
      reportedAt: true, amount: true, reporter: { select: { displayName: true } }, operation: { select: { operationType: true } },
    } } },
  });
}
