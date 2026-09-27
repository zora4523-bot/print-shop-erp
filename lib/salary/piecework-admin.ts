import { foilFeeData } from './foil-wage-admin';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { db } from '../db';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import { databaseClockNow } from '../background-jobs/clock';
import {
  assertActivePieceworkAdmin, PieceworkPriceBookAdminError,
  publishPieceworkPriceBook, type PieceworkPriceBookManifest,
} from './piecework-price-book-admin';
import { ensurePieceworkPriceBookV1PlaceholderInTx } from './piecework-price-book-seed';
import {
  PIECEWORK_RATE_FIELDS, pieceworkDraftSchema, pieceworkRevisionSchema,
  type PieceworkDraftInput, type PieceworkRevision,
} from './piecework-admin-input';

const includeRules = { rules: { orderBy: [{ operationType: 'asc' }, { unit: 'asc' }] } } satisfies Prisma.PieceworkPriceBookInclude;
type Book = Prisma.PieceworkPriceBookGetPayload<{ include: typeof includeRules }>;
export function projectPieceworkBook(book: Book) {
  return {
    id: book.id, cancelledAt: book.cancelledAt?.toISOString() ?? null, cancelReason: book.cancelReason ?? null,
    workerId: book.workerId ?? null, useUnifiedRates: book.useUnifiedRates ?? false,
    version: book.version, status: book.status,
    updatedAt: book.updatedAt.toISOString(),
    effectiveFrom: book.effectiveFrom?.toISOString() ?? '',
    effectiveTo: book.effectiveTo?.toISOString() ?? '',
    sourceName: book.sourceName ?? '', publishNote: book.publishNote ?? '',
    rules: book.rules.map((r) => ({ operationType: r.operationType, unit: r.unit, amount: r.amount?.toFixed(4) ?? '', smallOrderAmount: r.smallOrderAmount?.toFixed(4) ?? '', setupAmount: r.setupAmount?.toFixed(4) ?? '' })),
  };
}
export type PieceworkAdminBook = ReturnType<typeof projectPieceworkBook>;
export async function listPieceworkAdminBooks(): Promise<PieceworkAdminBook[]> {
  return (await db.pieceworkPriceBook.findMany({ where: { workerId: null }, include: includeRules, orderBy: { version: 'desc' } })).map(projectPieceworkBook);
}
async function lock(tx: Prisma.TransactionClient, actor: AuditActor) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'))`;
  return assertActivePieceworkAdmin(tx, actor);
}
export async function createPieceworkDraft(actor: AuditActor) {
  return db.$transaction(async (tx) => {
    const activeActor = await lock(tx, actor);
    const draft = await tx.pieceworkPriceBook.findFirst({ where: { workerId: null, status: 'DRAFT' }, include: includeRules });
    if (draft) return projectPieceworkBook(draft);
    const latest = await tx.pieceworkPriceBook.findFirst({ where: { workerId: null, status: 'PUBLISHED' }, orderBy: { version: 'desc' }, include: includeRules });
    const highest = await tx.pieceworkPriceBook.findFirst({ orderBy: { version: 'desc' } });
    if (!highest) {
      await ensurePieceworkPriceBookV1PlaceholderInTx(tx);
    } else {
      await tx.pieceworkPriceBook.create({ data: {
        version: highest.version + 1,
        rules: { create: latest ? latest.rules.map((r) => ({ operationType: r.operationType, unit: r.unit, amount: r.amount, smallOrderAmount: r.smallOrderAmount, setupAmount: r.setupAmount })) : [
          { operationType: 'PARTIAL', unit: 'PER_PASS', amount: null },
          { operationType: 'FULL', unit: 'PER_PIECE', amount: null },
          { operationType: 'PACKING', unit: 'PER_BAG', amount: null },
        ] },
      } });
    }
    const created = await tx.pieceworkPriceBook.findFirstOrThrow({ where: { workerId: null, status: 'DRAFT' }, include: includeRules });
    await writeAuditLogInTx(tx, { actor: activeActor, action: 'CREATE_DRAFT', entityType: 'PieceworkPriceBook', entityId: created.id, after: projectPieceworkBook(created) });
    return projectPieceworkBook(created);
  });
}
function manifestFrom(book: Book): PieceworkPriceBookManifest {
  return {
    schemaVersion: 1, priceBookVersion: book.version,
    effectiveFrom: book.effectiveFrom?.toISOString() ?? null,
    sourceName: book.sourceName ?? '', publishNote: book.publishNote ?? '',
    rules: book.rules.map((r) => ({ operationType: r.operationType, unit: r.unit, amount: r.amount?.toFixed(4) ?? null, ...(r.smallOrderAmount != null && r.setupAmount != null ? { smallOrderAmount: r.smallOrderAmount.toFixed(4), setupAmount: r.setupAmount.toFixed(4) } : {}) })),
  };
}
export async function savePieceworkDraft(raw: PieceworkDraftInput, actor: AuditActor) {
  const parsed = pieceworkDraftSchema.safeParse(raw);
  if (!parsed.success) throw new PieceworkPriceBookAdminError('填写内容不正确，请检查金额和生效时间');
  const input = parsed.data;
  return db.$transaction(async (tx) => {
    const activeActor = await lock(tx, actor);
    await tx.$queryRaw`SELECT "id" FROM "PieceworkPriceBook" WHERE "version" = ${input.version} FOR UPDATE`;
    const book = await tx.pieceworkPriceBook.findUnique({ where: { version: input.version }, include: includeRules });
    if (!book || book.workerId || book.status !== 'DRAFT' || book.updatedAt.toISOString() !== input.updatedAt) {
      throw new PieceworkPriceBookAdminError('工价已被修改，请重新加载后核对');
    }
    for (const field of PIECEWORK_RATE_FIELDS) {
      const value = input[field.key];
      if (field.operationType === 'PACKING' && value === '') {
        await tx.pieceworkPriceRule.deleteMany({ where: { priceBookId: book.id, operationType: 'PACKING', unit: field.unit } });
      } else {
        await tx.pieceworkPriceRule.upsert({
          where: { priceBookId_operationType_unit: { priceBookId: book.id, operationType: field.operationType, unit: field.unit } },
          create: { priceBookId: book.id, operationType: field.operationType, unit: field.unit, amount: value === '' ? null : new Prisma.Decimal(value), ...foilFeeData(input, field.operationType) },
          update: { amount: value === '' ? null : new Prisma.Decimal(value), ...foilFeeData(input, field.operationType) },
        });
      }
    }
    const now = await databaseClockNow(tx);
    // Millisecond revision must advance even for two saves within one clock tick.
    const updatedAt = new Date(Math.max(now.getTime(), book.updatedAt.getTime() + 1));
    const updated = await tx.pieceworkPriceBook.update({ where: { id: book.id }, data: {
      effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : null,
      sourceName: input.sourceName, publishNote: input.publishNote, updatedAt,
      sourceSha256: null, manifestSha256: null, ruleSetSha256: null,
    }, include: includeRules });
    await writeAuditLogInTx(tx, { actor: activeActor, action: 'UPDATE_DRAFT', entityType: 'PieceworkPriceBook', entityId: book.id, before: projectPieceworkBook(book), after: projectPieceworkBook(updated) });
    return projectPieceworkBook(updated);
  });
}
export async function publishSavedPieceworkDraft(raw: PieceworkRevision, actor: AuditActor) {
  const input = pieceworkRevisionSchema.parse(raw);
  const book = await db.pieceworkPriceBook.findUnique({ where: { version: input.version }, include: includeRules });
  if (!book || book.workerId) throw new PieceworkPriceBookAdminError('工价不存在，请重新加载');
  if (book.status === 'CANCELLED') throw new PieceworkPriceBookAdminError('该调价计划已取消，请新建调价草稿');
  if (book.status === 'DRAFT' && book.updatedAt.toISOString() !== input.updatedAt) throw new PieceworkPriceBookAdminError('工价已被修改，请重新加载后核对');
  if (book.status === 'PUBLISHED') {
    const audit = await db.businessAuditLog.findFirst({
      where: { action: 'PUBLISH_VERSION', entityType: 'PieceworkPriceBook', entityId: book.id },
      orderBy: { createdAt: 'asc' }, select: { before: true },
    });
    const before = audit?.before;
    if (!before || typeof before !== 'object' || Array.isArray(before) || before.updatedAt !== input.updatedAt) {
      throw new PieceworkPriceBookAdminError('工价已被修改，请重新加载后核对');
    }
  }
  const manifest = manifestFrom(book);
  if (!manifest.sourceName || manifest.publishNote.trim().length < 2 || manifest.rules.some((r) => r.amount === null)) {
    throw new PieceworkPriceBookAdminError('请补齐烫金工价、调价依据和至少两字的调整说明后保存');
  }
  const sourceSha256 = book.status === 'PUBLISHED' && book.sourceSha256
    ? book.sourceSha256
    : createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  return publishPieceworkPriceBook({ manifest, sourceSha256, actor,
    expectedDraftUpdatedAt: new Date(input.updatedAt), effectiveImmediately: !manifest.effectiveFrom,
  });
}
