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
  targets: z.array(z.object({ anchorId: z.string().min(1), amount: z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/) }).strict()).min(1).max(500),
}).strict();
/** REPORT 锚定自己，REVERSAL 锚定被冲正的报工，ADJUSTMENT 锚定它核定的那笔报工。 */
function anchorReportId(report: WageOperation['reports'][number]): string | null {
  if (report.entryType === 'REPORT') return report.id;
  if (report.entryType === 'REVERSAL') return report.reversalOfId;
  return (report.snapshot as { anchorReportId?: string } | null)?.anchorReportId ?? null;
}
/**
 * 台账只增不改，冲正是「作废原报工」（业主 2026-09-19 拍板按记账惯例）：被冲正的报工连同它的
 * 冲正行、人工核定差额整体作废，单独成只读组，不再参与改价——否则原报工日还能被改成 0（倒扣）
 * 或翻倍（冲正后又发一遍）。可核定的只有仍然有效的报工及其差额。
 */
function summarize(operation: WageOperation) {
  const reversedIds = new Set(operation.reports.flatMap((r) => r.entryType === 'REVERSAL' && r.reversalOfId ? [r.reversalOfId] : []));
  const groups = new Map<string, { anchorId: string; reporterId: string; name: string; date: string; amount: Decimal; settled: boolean; quantity: Decimal; voided: boolean }>();
  for (const report of operation.reports) {
    const anchor = anchorReportId(report); const voided = anchor !== null && reversedIds.has(anchor);
    const date = formatDateInputShanghai(report.reportedAt); const key = `${report.reporterId}:${date}:${voided ? 'void' : 'live'}`;
    const group = groups.get(key) ?? { anchorId: report.id, reporterId: report.reporterId, name: report.reporter.displayName, date, amount: new Decimal(0), settled: false, quantity: new Decimal(0), voided };
    if (report.entryType === 'REPORT' && !operation.reports.some((r) => r.id === group.anchorId && r.entryType === 'REPORT')) group.anchorId = report.id;
    group.amount = group.amount.plus(report.amount.toString()); group.quantity = group.quantity.plus(report.reportedCompletedQty.toString());
    group.settled ||= Boolean(report.settlementItem); groups.set(key, group);
  }
  // 与确认时的抵消记录同源；跨日冲正仍保留原报工日和冲正日各自的金额。
  const voidedAdjustmentDeltas = new Map<string, Decimal>();
  for (const { anchor, residual } of voidedAdjustmentResiduals(operation)) {
    const key = `${anchor.reporterId}:${formatDateInputShanghai(anchor.reportedAt)}:void`;
    voidedAdjustmentDeltas.set(key, (voidedAdjustmentDeltas.get(key) ?? new Decimal(0)).minus(residual));
  }
  return { id: operation.id, orderId: operation.orderId, type: operation.operationType, reviewRequired: operation.payrollReviewRequired,
    revision: createHash('sha256').update(JSON.stringify({ updatedAt: operation.updatedAt?.toISOString(), reports: operation.reports.map((r) => [r.id, r.amount.toString()]) })).digest('hex'),
    groups: [...groups.entries()].map(([key, g]) => ({ ...g, editable: !g.voided && !g.settled && operation.reports.some((r) => r.id === g.anchorId && r.entryType === 'REPORT'), amount: g.amount.toFixed(2), quantity: g.quantity.toString(), voidedAdjustmentDelta: (voidedAdjustmentDeltas.get(key) ?? new Decimal(0)).toFixed(2) })),
  };
}
/** 已作废报工上残留的人工核定差额：冲正只否定原报工金额，不含后来的 ADJUSTMENT。 */
function voidedAdjustmentResiduals(operation: WageOperation) {
  const reversedIds = new Set(operation.reports.flatMap((r) => r.entryType === 'REVERSAL' && r.reversalOfId ? [r.reversalOfId] : []));
  return operation.reports.filter((r) => r.entryType === 'REPORT' && reversedIds.has(r.id)).flatMap((anchor) => {
    const residual = operation.reports.filter((r) => r.entryType === 'ADJUSTMENT' && anchorReportId(r) === anchor.id)
      .reduce((sum, r) => sum.plus(r.amount.toString()), new Decimal(0));
    return residual.isZero() ? [] : [{ anchor, residual }];
  });
}
export async function listOrderWages(orderId: string, actor: AuditActor) {
  await assertActivePieceworkAdmin(db, actor);
  return (await db.productionOperation.findMany({ where: { orderId, reports: { some: {} } }, include, orderBy: { createdAt: 'asc' } })).map(summarize);
}
export async function reviewOrderWages(raw: z.infer<typeof wageReviewSchema>, actor: AuditActor) {
  const input = wageReviewSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await assertActivePieceworkAdmin(tx, actor);
    const locator = await tx.productionOperation.findUnique({ where: { id: input.operationId }, select: { orderId: true } });
    if (!locator) throw new WageReviewError('工序不存在，请刷新工单');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(locator.orderId)}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operationLockKey(input.operationId)}))`;
    // Match live reporting: publication precedes every reporting-day lock.
    // The INSERT trigger also takes publication; taking it only there would
    // invert this order when a cancellation/publisher is queued in between.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('print-shop-erp:piecework-price-book:publish'))`;
    const admin = await assertActivePieceworkAdmin(tx, actor);
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
      const amount = new Decimal(target.amount);
      if (group.editable && amount.isNegative()) throw new WageReviewError('核定提成不能小于 0');
      const delta = amount.minus(group.amount);
      if (delta.isZero()) continue;
      const settlement = await tx.pieceworkSettlement.findUnique({ where: { reporterId_workDate: { reporterId: group.reporterId, workDate: new Date(`${group.date}T00:00:00Z`) } } });
      if (settlement || group.settled) throw new WageReviewError(`${group.name} ${group.date} 已结算，不能修改该日工资`);
      const anchor = operation.reports.find((r) => r.id === group.anchorId)!;
      if (anchor.entryType !== 'REPORT') throw new WageReviewError('冲正记录不能单独改价，请核对原报工日期');
      if (group.voided) throw new WageReviewError(`${group.name} ${group.date} 的报工已冲正，不能再核定金额`);
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
    // 冲正要让作废的工作净额归零：把残留差额反向记在原报工日（触发器要求 ADJUSTMENT 与锚点同日）。
    // 原报工日已结算就无处可记——明确拒绝，绝不悄悄少发 / 多发。
    for (const { anchor, residual } of voidedAdjustmentResiduals(operation)) {
      const date = formatDateInputShanghai(anchor.reportedAt);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pieceworkReportingDayGateLockKey(date)}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pieceworkSettlementLockKey(anchor.reporterId, date)}))`;
      const settlement = await tx.pieceworkSettlement.findUnique({ where: { reporterId_workDate: { reporterId: anchor.reporterId, workDate: new Date(`${date}T00:00:00Z`) } } });
      if (settlement || anchor.settlementItem) throw new WageReviewError(`${anchor.reporter.displayName} ${date} 已结算，已冲正报工上的人工核定差额 ${residual.toFixed(2)} 元无法自动抵消，请联系技术支持处理`);
      const priorPayroll = (anchor.snapshot as { payroll?: Prisma.InputJsonObject } | null)?.payroll ?? {};
      await tx.productionReport.create({ data: {
        operationId: operation.id, reporterId: anchor.reporterId, entryType: 'ADJUSTMENT', adjustedById: admin.id,
        reportedCompletedQty: 0, defectQty: 0, reworkQty: 0, chargeableQty: 0, unit: anchor.unit, rate: anchor.rate,
        amount: residual.negated().toFixed(2), wageSupplement: residual.negated().toFixed(2), priceBookId: anchor.priceBookId,
        priceBookVersion: anchor.priceBookVersion, ruleSetSha256: anchor.ruleSetSha256, reportedAt: anchor.reportedAt,
        idempotencyKey: `wage-void:${input.revision}:${anchor.id}`,
        snapshot: { anchorReportId: anchor.id, reason: `报工已冲正，抵消此前的人工核定差额：${input.reason}`, before: residual.toFixed(2), after: '0.00', voidedAnchor: true, payroll: { ...priorPayroll, manual: true } },
      } });
    }
    await tx.productionOperation.update({ where: { id: operation.id }, data: { payrollReviewRequired: false } });
    await writeAuditLogInTx(tx, { actor: admin, action: 'CONFIRM_WAGES', entityType: 'ProductionWageReview', entityId: auditKey, before: current, after: { targets: input.targets, reason: input.reason } });
    return { orderId: locator.orderId };
  });
}
