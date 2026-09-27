import { createHash } from 'node:crypto';
import type { PieceworkPriceBook, Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { writeAuditLogInTx, type AuditActor } from '@/lib/audit-log';
import { databaseClockNow } from '@/lib/background-jobs/clock';
import { salaryIdentityLockKey } from '@/lib/salary/hourly-lock';
import { assertActivePieceworkAdmin, PieceworkPriceBookAdminError } from '@/lib/salary/piecework-price-book-admin';
import { pieceworkCancellationSchema, type PieceworkCancellationInput, type PieceworkCancellationReview } from './piecework-cancellation-input';

export function pieceworkScheduleCancellationEnabled() {
  return process.env.PIECEWORK_SCHEDULE_CANCEL_ENABLED === 'true';
}
export function requirePieceworkCancellationEnabled() {
  if (!pieceworkScheduleCancellationEnabled()) throw new PieceworkPriceBookAdminError('取消调价计划尚未开放，请联系管理员');
}

async function lock(tx: Prisma.TransactionClient, workerId: string | null, actor: AuditActor) {
  if (workerId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(workerId)}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'))`;
  // Intentionally do not require the worker to remain active: an inactive
  // account must still be able to have its erroneous future plan cancelled.
  return assertActivePieceworkAdmin(tx, actor);
}
function revision(book: PieceworkPriceBook) {
  return { id: book.id, version: book.version, effectiveFrom: book.effectiveFrom!.toISOString(), effectiveTo: book.effectiveTo?.toISOString() ?? null, updatedAt: book.updatedAt.toISOString() };
}
export function assertFuturePieceworkCancellation(effectiveFrom: Date, now: Date) {
  if (effectiveFrom.getTime() <= now.getTime()) throw new PieceworkPriceBookAdminError('该工价已经生效，不能取消；请新建调价草稿');
}
async function readReview(tx: Prisma.TransactionClient, workerId: string | null, targetId: string): Promise<PieceworkCancellationReview> {
  const target = await tx.pieceworkPriceBook.findUnique({ where: { id: targetId } });
  if (!target || target.workerId !== workerId) throw new PieceworkPriceBookAdminError('调价计划不属于当前账号或统一工价，请重新打开对应页面');
  if (target.status !== 'PUBLISHED' || !target.effectiveFrom) throw new PieceworkPriceBookAdminError('该调价计划已取消或尚未发布，请重新核对');
  assertFuturePieceworkCancellation(target.effectiveFrom, await databaseClockNow(tx));
  const referenced = await tx.productionReport.findFirst({ where: { OR: [
    { priceBookId: target.id }, { snapshot: { path: ['payroll', 'policyBookId'], equals: target.id } },
  ] }, select: { id: true } });
  if (referenced) throw new PieceworkPriceBookAdminError('该工价已有报工记录，不能取消；请新建调价草稿');
  const [predecessor, successor] = await Promise.all([
    tx.pieceworkPriceBook.findFirst({ where: { workerId, status: 'PUBLISHED', effectiveFrom: { lt: target.effectiveFrom } }, orderBy: { effectiveFrom: 'desc' } }),
    tx.pieceworkPriceBook.findFirst({ where: { workerId, status: 'PUBLISHED', effectiveFrom: { gt: target.effectiveFrom } }, orderBy: { effectiveFrom: 'asc' } }),
  ]);
  if ((predecessor && (predecessor.effectiveTo?.getTime() !== target.effectiveFrom.getTime() || predecessor.version >= target.version)) ||
    (successor?.effectiveFrom?.getTime() ?? null) !== (target.effectiveTo?.getTime() ?? null) || (successor && successor.version <= target.version)) {
    throw new PieceworkPriceBookAdminError('相邻工价的生效时间不连续，请先核对工价记录');
  }
  return { workerId, target: revision(target), predecessor: predecessor ? revision(predecessor) : null, successor: successor ? revision(successor) : null };
}

export async function reviewPieceworkCancellation(workerId: string | null, targetId: string, actor: AuditActor) {
  requirePieceworkCancellationEnabled();
  return db.$transaction(async (tx) => {
    await lock(tx, workerId, actor);
    return readReview(tx, workerId, targetId);
  });
}

export async function cancelPieceworkSchedule(raw: PieceworkCancellationInput, actor: AuditActor) {
  requirePieceworkCancellationEnabled();
  const parsed = pieceworkCancellationSchema.safeParse(raw);
  if (!parsed.success) throw new PieceworkPriceBookAdminError('取消信息不完整，请重新核对计划并填写取消原因');
  const input = parsed.data;
  const requestHash = createHash('sha256').update(JSON.stringify({ reason: input.reason, review: input.review })).digest('hex');
  try {
    return await db.$transaction(async (tx) => {
      const admin = await lock(tx, input.review.workerId, actor);
      const existing = await tx.pieceworkCancellation.findUnique({ where: { actorId_clientRequestId: { actorId: admin.id, clientRequestId: input.clientRequestId } } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new PieceworkPriceBookAdminError('本次取消内容与原记录不同，请重新核对计划');
        return { cancellationId: existing.id, targetId: existing.targetBookId, replayed: true };
      }
      const current = await readReview(tx, input.review.workerId, input.review.target.id);
      if (JSON.stringify(current) !== JSON.stringify(input.review)) throw new PieceworkPriceBookAdminError('相邻调价计划已变化，请重新核对后取消');
      const now = await databaseClockNow(tx);
      assertFuturePieceworkCancellation(new Date(current.target.effectiveFrom), now);
      const operation = await tx.pieceworkCancellation.create({ data: {
        clientRequestId: input.clientRequestId, actorId: admin.id, workerId: current.workerId,
        targetBookId: current.target.id, targetEffectiveFrom: current.target.effectiveFrom, targetEffectiveTo: current.target.effectiveTo, targetUpdatedAt: current.target.updatedAt,
        predecessorBookId: current.predecessor?.id ?? null, predecessorPreviousTo: current.predecessor?.effectiveTo ?? null,
        predecessorNewTo: current.predecessor ? current.target.effectiveTo : null, predecessorUpdatedAt: current.predecessor?.updatedAt ?? null,
        successorBookId: current.successor?.id ?? null, successorEffectiveFrom: current.successor?.effectiveFrom ?? null, successorEffectiveTo: current.successor?.effectiveTo ?? null, successorUpdatedAt: current.successor?.updatedAt ?? null,
        reason: input.reason, requestHash, createdAt: now,
      } });
      const updatedAt = new Date(Math.max(now.getTime(), new Date(current.target.updatedAt).getTime() + 1));
      // Remove S from the non-deferrable published exclusion before extending P.
      await tx.pieceworkPriceBook.update({ where: { id: current.target.id, updatedAt: new Date(current.target.updatedAt) }, data: {
        status: 'CANCELLED', cancelledAt: now, cancelledById: admin.id, cancelReason: input.reason, cancellationId: operation.id, updatedAt,
      } });
      if (current.predecessor) await tx.pieceworkPriceBook.update({ where: { id: current.predecessor.id, updatedAt: new Date(current.predecessor.updatedAt) }, data: {
        effectiveTo: current.target.effectiveTo,
        updatedAt: new Date(Math.max(now.getTime(), new Date(current.predecessor.updatedAt).getTime() + 1)),
      } });
      await writeAuditLogInTx(tx, { actor: admin, action: 'CANCEL_SCHEDULE', entityType: 'PieceworkPriceBook', entityId: current.target.id,
        before: current, after: { status: 'CANCELLED', cancellationId: operation.id, predecessorEffectiveTo: current.predecessor ? current.target.effectiveTo : null }, requestMetadata: { clientRequestId: input.clientRequestId, reason: input.reason } });
      return { cancellationId: operation.id, targetId: current.target.id, replayed: false };
    });
  } catch (error) {
    // A commit can cross the effective boundary after application validation.
    // The deferred database check remains authoritative, with recoverable copy.
    if (error instanceof Error && error.message.includes('Piecework cancellation')) throw new PieceworkPriceBookAdminError('取消未完成，计划可能已生效或相邻计划已变化；请重新核对');
    throw error;
  }
}
