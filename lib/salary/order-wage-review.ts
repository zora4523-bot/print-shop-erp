import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { db } from '../db';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import { assertActivePieceworkAdmin } from './piecework-price-book-admin';
import { orderCascadeLockKey } from '../order/locks';
import { operationLockKey } from '../production/operation-reporting';
import { pieceworkReportingDayGateLockKey, pieceworkSettlementLockKey } from './piecework-lock';
import { formatDateInputShanghai } from '../format/dates';

const include = { reports: { orderBy: [{ reportedAt: 'asc' }, { id: 'asc' }], include: { reporter: { select: { displayName: true } }, settlementItem: true } } } satisfies Prisma.ProductionOperationInclude;
type WageOperation = Prisma.ProductionOperationGetPayload<{ include: typeof include }>;
export class WageReviewError extends Error {}
export const wageReviewSchema = z.object({
  operationId: z.string().min(1), revision: z.string().length(64), reason: z.string().trim().min(2).max(500),
  targets: z.array(z.object({ anchorId: z.string().min(1), amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/) }).strict()).min(1).max(500),
}).strict();
function summarize(operation: WageOperation) {
  const groups = new Map<string, { anchorId: string; reporterId: string; name: string; date: string; amount: Decimal; settled: boolean; quantity: Decimal }>();
  for (const report of operation.reports) {
    const date = formatDateInputShanghai(report.reportedAt); const key = `${report.reporterId}:${date}`;
    const group = groups.get(key) ?? { anchorId: report.id, reporterId: report.reporterId, name: report.reporter.displayName, date, amount: new Decimal(0), settled: false, quantity: new Decimal(0) };
    if (report.entryType === 'REPORT' && !operation.reports.some((r) => r.id === group.anchorId && r.entryType === 'REPORT')) group.anchorId = report.id;
    group.amount = group.amount.plus(report.amount.toString()); group.quantity = group.quantity.plus(report.reportedCompletedQty.toString());
    group.settled ||= Boolean(report.settlementItem); groups.set(key, group);
  }
  return { id: operation.id, orderId: operation.orderId, type: operation.operationType, reviewRequired: operation.payrollReviewRequired,
    revision: createHash('sha256').update(JSON.stringify({ updatedAt: operation.updatedAt?.toISOString(), reports: operation.reports.map((r) => [r.id, r.amount.toString()]) })).digest('hex'),
    groups: [...groups.values()].map((g) => ({ ...g, editable: !g.settled && operation.reports.some((r) => r.id === g.anchorId && r.entryType === 'REPORT'), amount: g.amount.toFixed(2), quantity: g.quantity.toString() })),
  };
}
export async function listOrderWages(orderId: string, actor: AuditActor) {
  await assertActivePieceworkAdmin(db, actor);
  return (await db.productionOperation.findMany({ where: { orderId, reports: { some: {} } }, include, orderBy: { createdAt: 'asc' } })).map(summarize);
}
export async function reviewOrderWages(raw: z.infer<typeof wageReviewSchema>, actor: AuditActor) {
  const input = wageReviewSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const admin = await assertActivePieceworkAdmin(tx, actor);
    const locator = await tx.productionOperation.findUnique({ where: { id: input.operationId }, select: { orderId: true } });
    if (!locator) throw new WageReviewError('工序不存在，请刷新工单');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(locator.orderId)}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operationLockKey(input.operationId)}))`;
    await tx.$queryRaw`SELECT id FROM "ProductionOperation" WHERE id=${input.operationId} FOR UPDATE`;
    const operation = await tx.productionOperation.findUniqueOrThrow({ where: { id: input.operationId }, include });
    const current = summarize(operation);
    const auditKey = `${input.operationId}:${input.revision}`;
    const replay = await tx.businessAuditLog.findFirst({ where: { entityType: 'ProductionWageReview', entityId: auditKey } });
    if (replay) {
      if (JSON.stringify(replay.after) !== JSON.stringify({ targets: input.targets, reason: input.reason })) {
        const saved = replay.after as { targets?: unknown; reason?: string } | null;
        if (saved?.reason !== input.reason || JSON.stringify(saved?.targets) !== JSON.stringify(input.targets)) throw new WageReviewError('这次核定已提交，请刷新后重新调整');
      }
      return { orderId: locator.orderId };
    }
    if (current.revision !== input.revision) throw new WageReviewError('报工明细已变化，请刷新后重新核定');
    if (input.targets.length !== current.groups.length || new Set(input.targets.map((t) => t.anchorId)).size !== current.groups.length) throw new WageReviewError('核定明细不完整，请刷新工单');
    const groups = [...current.groups].sort((a, b) => `${a.date}:${a.reporterId}`.localeCompare(`${b.date}:${b.reporterId}`));
    for (const group of groups) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pieceworkReportingDayGateLockKey(group.date)}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pieceworkSettlementLockKey(group.reporterId, group.date)}))`;
      const target = input.targets.find((t) => t.anchorId === group.anchorId);
      if (!target) throw new WageReviewError('核定对象不符，请刷新工单');
      const delta = new Decimal(target.amount).minus(group.amount);
      if (delta.isZero()) continue;
      const settlement = await tx.pieceworkSettlement.findUnique({ where: { reporterId_workDate: { reporterId: group.reporterId, workDate: new Date(`${group.date}T00:00:00Z`) } } });
      if (settlement || group.settled) throw new WageReviewError(`${group.name} ${group.date} 已结算，不能修改该日工资`);
      const anchor = operation.reports.find((r) => r.id === group.anchorId)!;
      if (anchor.entryType !== 'REPORT') throw new WageReviewError('冲正记录不能单独改价，请核对原报工日期');
      const priorPayroll = (anchor.snapshot as { payroll?: Prisma.InputJsonObject } | null)?.payroll ?? {};
      await tx.productionReport.create({ data: {
        operationId: operation.id, reporterId: group.reporterId, entryType: 'ADJUSTMENT', adjustedById: admin.id,
        reportedCompletedQty: 0, defectQty: 0, reworkQty: 0, chargeableQty: 0, unit: anchor.unit, rate: anchor.rate,
        amount: delta.toFixed(2), wageSupplement: delta.toFixed(2), priceBookId: anchor.priceBookId,
        priceBookVersion: anchor.priceBookVersion, ruleSetSha256: anchor.ruleSetSha256, reportedAt: anchor.reportedAt,
        idempotencyKey: `wage:${input.revision}:${anchor.id}`,
        snapshot: { anchorReportId: anchor.id, reason: input.reason, before: group.amount, after: new Decimal(target.amount).toFixed(2), payroll: { ...priorPayroll, manual: true } },
      } });
    }
    await tx.productionOperation.update({ where: { id: operation.id }, data: { payrollReviewRequired: false } });
    await writeAuditLogInTx(tx, { actor: admin, action: 'CONFIRM_WAGES', entityType: 'ProductionWageReview', entityId: auditKey, before: current, after: { targets: input.targets, reason: input.reason } });
    return { orderId: locator.orderId };
  });
}
