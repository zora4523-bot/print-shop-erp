import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../../generated/prisma/enums';
const mocks = vi.hoisted(() => ({
  tx: { $executeRaw: vi.fn(), $queryRaw: vi.fn(),
    pieceworkPriceBook: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), findFirstOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    pieceworkPriceRule: { upsert: vi.fn(), deleteMany: vi.fn() },
    user: { findUnique: vi.fn() },
    businessAuditLog: { findFirst: vi.fn() },
  }, audit: vi.fn(), publish: vi.fn(), clock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: { ...mocks.tx, $transaction: (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx) } }));
vi.mock('@/lib/audit-log', () => ({ writeAuditLogInTx: mocks.audit }));
vi.mock('@/lib/background-jobs/clock', () => ({ databaseClockNow: mocks.clock }));
vi.mock('../piecework-price-book-admin', async (original) => ({ ...await original<typeof import('../piecework-price-book-admin')>(), publishPieceworkPriceBook: mocks.publish }));
import { createPieceworkDraft, savePieceworkDraft, publishSavedPieceworkDraft } from '../piecework-admin';
import { pieceworkDraftSchema } from '../piecework-admin-input';
const actor = { id: 'admin', username: 'admin', displayName: '管理员', role: Role.ADMIN };
const at = new Date('2026-09-16T00:00:00Z');
const rules = [
  { operationType: 'PARTIAL', unit: 'PER_PASS', amount: null },
  { operationType: 'FULL', unit: 'PER_PIECE', amount: null },
  { operationType: 'PACKING', unit: 'PER_BAG', amount: null },
];
const book = { id: 'book', version: 1, status: 'DRAFT', updatedAt: at, effectiveFrom: null, effectiveTo: null, sourceName: '', publishNote: '', rules };
const input = { version: 1, updatedAt: at.toISOString(), partial: '0.0075', full: '0.0125', bag: '0.3', box: '', sourceName: '管理员核价', publishNote: '首次发布', effectiveFrom: '' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.user.findUnique.mockResolvedValue({ ...actor, isActive: true });
  mocks.tx.pieceworkPriceBook.findUnique.mockResolvedValue(book);
  mocks.tx.pieceworkPriceBook.update.mockResolvedValue(book);
  mocks.tx.pieceworkPriceBook.findFirst.mockResolvedValue(book);
  mocks.clock.mockResolvedValue(at);
});
describe('计件工价后台', () => {
  it.each(['-1', '0.00001', '1e3', '10000000000', 'NaN', 'Infinity'])('rejects invalid amount %s', (partial) => {
    expect(pieceworkDraftSchema.safeParse({ ...input, partial }).success).toBe(false);
  });
  it('permits empty draft values and explicit zero', () => {
    expect(pieceworkDraftSchema.safeParse({ ...input, partial: '', full: '0' }).success).toBe(true);
  });
  it('saves decimal values under the same publish lock and advances revision', async () => {
    await savePieceworkDraft(input, actor);
    expect(mocks.tx.$executeRaw).toHaveBeenCalled();
    expect(mocks.tx.pieceworkPriceRule.upsert).toHaveBeenCalledTimes(3);
    expect(mocks.tx.pieceworkPriceRule.upsert.mock.calls[0][0].update.amount.toString()).toBe('0.0075');
    expect(mocks.tx.pieceworkPriceBook.update.mock.calls[0][0].data.updatedAt.getTime()).toBe(at.getTime() + 1);
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: 'UPDATE_DRAFT' }));
  });
  it('rejects stale edits without touching rules', async () => {
    await expect(savePieceworkDraft({ ...input, updatedAt: new Date(at.getTime() - 1).toISOString() }, actor)).rejects.toThrow('已被修改');
    expect(mocks.tx.pieceworkPriceRule.upsert).not.toHaveBeenCalled();
  });
  it('rejects changes to published books', async () => {
    mocks.tx.pieceworkPriceBook.findUnique.mockResolvedValue({ ...book, status: 'PUBLISHED' });
    await expect(savePieceworkDraft(input, actor)).rejects.toThrow('已被修改');
  });
  it.each([false, true])('rejects inactive/non-admin actors (%s)', async (active) => {
    mocks.tx.user.findUnique.mockResolvedValue({ ...actor, isActive: active, role: active ? Role.WORKER : Role.ADMIN });
    await expect(savePieceworkDraft(input, actor)).rejects.toThrow('活跃管理员');
    expect(mocks.tx.pieceworkPriceRule.upsert).not.toHaveBeenCalled();
  });
  it('reuses an existing draft rather than allocating another version', async () => {
    expect((await createPieceworkDraft(actor)).version).toBe(1);
    expect(mocks.tx.pieceworkPriceBook.create).not.toHaveBeenCalled();
  });
  it('creates the immediate successor with copied rates', async () => {
    mocks.tx.pieceworkPriceBook.findFirst.mockResolvedValue({ ...book, status: 'PUBLISHED' });
    mocks.tx.pieceworkPriceBook.findFirstOrThrow.mockResolvedValue({ ...book, version: 2 });
    await createPieceworkDraft(actor);
    expect(mocks.tx.pieceworkPriceBook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ version: 2 }) });
  });
  it('rejects incomplete publication and leaves the existing book alone', async () => {
    await expect(publishSavedPieceworkDraft({ version: input.version, updatedAt: input.updatedAt }, actor)).rejects.toThrow('补齐');
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('publishes exactly the saved revision with server-side rates', async () => {
    const amounts = ['0.0075', '0.0125', '0.3000'];
    mocks.tx.pieceworkPriceBook.findUnique.mockResolvedValue({ ...book, sourceName: input.sourceName, publishNote: input.publishNote,
      rules: rules.map((rule, index) => ({ ...rule, amount: { toFixed: () => amounts[index] } })) });
    await publishSavedPieceworkDraft({ version: 1, updatedAt: input.updatedAt }, actor);
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ effectiveImmediately: true, expectedDraftUpdatedAt: at,
      manifest: expect.objectContaining({ effectiveFrom: null, rules: expect.arrayContaining([expect.objectContaining({ amount: '0.0075' })]) }) }));
  });
});


it('rejects a stale publication view even when another admin already published', async () => {
  mocks.tx.pieceworkPriceBook.findUnique.mockResolvedValue({ ...book, status: 'PUBLISHED' });
  mocks.tx.businessAuditLog.findFirst.mockResolvedValue({ before: { updatedAt: new Date(at.getTime() + 1).toISOString() } });
  await expect(publishSavedPieceworkDraft({ version: 1, updatedAt: input.updatedAt }, actor)).rejects.toThrow('已被修改');
  expect(mocks.publish).not.toHaveBeenCalled();
});
