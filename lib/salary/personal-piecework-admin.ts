import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { db } from '../db';
import { databaseClockNow } from '../background-jobs/clock';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import { salaryIdentityLockKey } from './hourly-lock';
import { operationTypeForReporterAccount } from '../production/reporter-operation-lane';
import { assertActivePieceworkAdmin, PieceworkPriceBookAdminError } from './piecework-price-book-admin';
import { pieceworkDraftSchema, PIECEWORK_RATE_FIELDS } from './piecework-admin-input';
import { projectPieceworkBook } from './piecework-admin';

export const personalPieceworkSchema = pieceworkDraftSchema.extend({ workerId: z.string().min(1), useUnifiedRates: z.boolean() });
const include = { rules: { orderBy: [{ operationType: 'asc' }, { unit: 'asc' }] } } satisfies Prisma.PieceworkPriceBookInclude;
type PersonalBook = Prisma.PieceworkPriceBookGetPayload<{ include: typeof include }>;

export async function listPersonalPieceworkBooks(workerId: string) {
  return (await db.pieceworkPriceBook.findMany({ where: { workerId }, include, orderBy: { version: 'desc' } })).map(projectPieceworkBook);
}
async function lockPersonal(tx: Prisma.TransactionClient, workerId: string, actor: AuditActor) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(workerId)}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'))`;
  const admin = await assertActivePieceworkAdmin(tx, actor);
  const worker = await tx.user.findUnique({ where: { id: workerId } });
  const lane = worker && operationTypeForReporterAccount(worker);
  if (!lane) throw new PieceworkPriceBookAdminError('该账号未启用计件岗位，请先检查账号状态和工种');
  return { admin, lane };
}
export async function createPersonalPieceworkDraft(workerId: string, actor: AuditActor) {
  return db.$transaction(async (tx) => {
    const { admin, lane } = await lockPersonal(tx, workerId, actor);
    const previous = await tx.pieceworkPriceBook.findFirst({ where: { workerId }, include, orderBy: { version: 'desc' } });
    if (previous?.status === 'DRAFT') return projectPieceworkBook(previous);
    const latest = await tx.pieceworkPriceBook.findFirst({ orderBy: { version: 'desc' } });
    if (!latest) throw new PieceworkPriceBookAdminError('请先初始化统一工价');
    const book = await tx.pieceworkPriceBook.create({ data: {
      workerId, useUnifiedRates: previous?.useUnifiedRates ?? true, version: latest.version + 1,
      rules: { create: previous?.rules.filter((r) => r.operationType === lane).map((r) => ({ operationType: r.operationType, unit: r.unit, amount: r.amount })) ?? [] },
    }, include });
    await writeAuditLogInTx(tx, { actor: admin, action: 'CREATE_DRAFT', entityType: 'PieceworkPriceBook', entityId: book.id, after: projectPieceworkBook(book) });
    return projectPieceworkBook(book);
  });
}
export async function savePersonalPieceworkDraft(raw: z.infer<typeof personalPieceworkSchema>, actor: AuditActor) {
  const input = personalPieceworkSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const { admin, lane } = await lockPersonal(tx, input.workerId, actor);
    const book = await tx.pieceworkPriceBook.findUnique({ where: { version: input.version }, include });
    assertDraft(book, input.workerId, input.updatedAt);
    await tx.pieceworkPriceRule.deleteMany({ where: { priceBookId: book.id } });
    if (!input.useUnifiedRates) {
      for (const field of PIECEWORK_RATE_FIELDS.filter((f) => f.operationType === lane)) {
        const value = input[field.key];
        if (field.key === 'box' && !value) continue;
        await tx.pieceworkPriceRule.create({ data: { priceBookId: book.id, operationType: field.operationType, unit: field.unit, amount: value === '' ? null : new Prisma.Decimal(value) } });
      }
    }
    const now = await databaseClockNow(tx);
    const updated = await tx.pieceworkPriceBook.update({ where: { id: book.id }, data: {
      useUnifiedRates: input.useUnifiedRates, effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : null,
      sourceName: input.sourceName, publishNote: input.publishNote,
      updatedAt: new Date(Math.max(now.getTime(), book.updatedAt.getTime() + 1)),
    }, include });
    await writeAuditLogInTx(tx, { actor: admin, action: 'UPDATE_DRAFT', entityType: 'PieceworkPriceBook', entityId: updated.id, before: projectPieceworkBook(book), after: projectPieceworkBook(updated) });
    return projectPieceworkBook(updated);
  });
}
function assertDraft(book: PersonalBook | null, workerId: string, updatedAt: string): asserts book is PersonalBook {
  if (!book || book.workerId !== workerId || book.status !== 'DRAFT' || book.updatedAt.toISOString() !== updatedAt) throw new PieceworkPriceBookAdminError('工价已被修改，请重新加载后核对');
}
function assertPublishable(book: PersonalBook, lane: string) {
  if (!book.sourceName?.trim() || (book.publishNote?.trim().length ?? 0) < 2) throw new PieceworkPriceBookAdminError('请填写调价依据和调整说明后保存');
  const fields = PIECEWORK_RATE_FIELDS.filter((f) => f.operationType === lane && f.key !== 'box');
  if (!book.useUnifiedRates && (book.rules.some((r) => r.operationType !== lane || r.amount === null) || fields.some((f) => !book.rules.some((r) => r.unit === f.unit)))) throw new PieceworkPriceBookAdminError('请补齐当前岗位的个人工价后保存');
  if (book.useUnifiedRates && book.rules.length) throw new PieceworkPriceBookAdminError('工价模式与明细不符，请重新保存草稿');
}
export async function publishPersonalPieceworkDraft(input: { workerId: string; version: number; updatedAt: string }, actor: AuditActor) {
  return db.$transaction(async (tx) => {
    const { admin, lane } = await lockPersonal(tx, input.workerId, actor);
    const book = await tx.pieceworkPriceBook.findUnique({ where: { version: input.version }, include });
    if (book?.workerId === input.workerId && book.status === 'PUBLISHED') {
      const audit = await tx.businessAuditLog.findFirst({ where: { entityType: 'PieceworkPriceBook', entityId: book.id, action: 'PUBLISH_VERSION' }, select: { before: true } });
      const before = audit?.before;
      if (before && typeof before === 'object' && !Array.isArray(before) && before.updatedAt === input.updatedAt) return projectPieceworkBook(book);
    }
    assertDraft(book, input.workerId, input.updatedAt);
    assertPublishable(book, lane);
    const now = await databaseClockNow(tx);
    const effectiveFrom = book.effectiveFrom ?? now;
    if (effectiveFrom < now) throw new PieceworkPriceBookAdminError('生效时间已过，请修改后重新保存');
    const previous = await tx.pieceworkPriceBook.findFirst({ where: { workerId: input.workerId, status: 'PUBLISHED', effectiveTo: null }, orderBy: { version: 'desc' } });
    if (previous) {
      if (previous.effectiveFrom! >= effectiveFrom || previous.version >= book.version) throw new PieceworkPriceBookAdminError('生效时间须晚于该账号上一版工价');
      await tx.pieceworkPriceBook.update({ where: { id: previous.id }, data: { effectiveTo: effectiveFrom } });
    }
    const sha = createHash('sha256').update(JSON.stringify({ ...projectPieceworkBook(book), effectiveFrom: effectiveFrom.toISOString() })).digest('hex');
    const published = await tx.pieceworkPriceBook.update({ where: { id: book.id }, data: {
      status: 'PUBLISHED', effectiveFrom, publishedAt: now, publishedById: admin.id,
      sourceSha256: sha, manifestSha256: sha, ruleSetSha256: sha,
    }, include });
    await writeAuditLogInTx(tx, { actor: admin, action: 'PUBLISH_VERSION', entityType: 'PieceworkPriceBook', entityId: published.id, before: projectPieceworkBook(book), after: projectPieceworkBook(published) });
    return projectPieceworkBook(published);
  });
}
