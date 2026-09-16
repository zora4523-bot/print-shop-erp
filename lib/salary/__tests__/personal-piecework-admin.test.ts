import { beforeEach, expect, it, vi } from 'vitest';
const { tx, clock, authorize, audit } = vi.hoisted(() => ({
  clock: vi.fn(), authorize: vi.fn(), audit: vi.fn(),
  tx: { $transaction: vi.fn(), $executeRaw: vi.fn(), user: { findUnique: vi.fn() }, businessAuditLog: { findFirst: vi.fn() },
    pieceworkPriceBook: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    pieceworkPriceRule: { deleteMany: vi.fn(), create: vi.fn() } },
}));
vi.mock('@/lib/db', () => ({ db: tx }));
vi.mock('@/lib/background-jobs/clock', () => ({ databaseClockNow: clock }));
vi.mock('@/lib/audit-log', () => ({ writeAuditLogInTx: audit }));
vi.mock('@/lib/salary/piecework-price-book-admin', async (original) => ({ ...await original<typeof import('@/lib/salary/piecework-price-book-admin')>(), assertActivePieceworkAdmin: authorize }));
import { createPersonalPieceworkDraft, savePersonalPieceworkDraft, publishPersonalPieceworkDraft } from '../personal-piecework-admin';
const now = new Date('2026-09-17T00:00:00Z');
const actor = { id: 'admin', username: 'admin', displayName: '管理员', role: 'ADMIN' as const };
const book = { id: 'book', workerId: 'worker', useUnifiedRates: false, version: 2, status: 'DRAFT', updatedAt: now, effectiveFrom: null, sourceName: '正式依据', publishNote: '个人调价', rules: [{ operationType: 'PARTIAL', unit: 'PER_PASS', amount: { toFixed: () => '0.1000' } }] };
const revision = { workerId: 'worker', version: 2, updatedAt: now.toISOString() };
beforeEach(() => {
  vi.resetAllMocks(); tx.$transaction.mockImplementation((fn) => fn(tx)); authorize.mockResolvedValue(actor); clock.mockResolvedValue(now);
  tx.user.findUnique.mockResolvedValue({ role: 'WORKER', isActive: true, workerType: 'MACHINE', machineType: 'HAND_PRESS' });
  tx.pieceworkPriceBook.findUnique.mockResolvedValue(book); tx.pieceworkPriceBook.update.mockImplementation(({ data }) => Promise.resolve({ ...book, ...data }));
});
it('只保存目标岗位工价并推进修订', async () => {
  await savePersonalPieceworkDraft({ ...revision, useUnifiedRates: false, partial: '0', full: '9', bag: '8', box: '', effectiveFrom: '', sourceName: '依据', publishNote: '调价' }, actor);
  expect(tx.pieceworkPriceRule.create).toHaveBeenCalledTimes(1);
  expect(tx.pieceworkPriceRule.create.mock.calls[0][0].data.amount.toString()).toBe('0');
  expect(tx.pieceworkPriceBook.update.mock.calls[0][0].data.updatedAt.getTime()).toBe(now.getTime() + 1);
});
it('发布个人价不关闭统一工价', async () => {
  await publishPersonalPieceworkDraft(revision, actor);
  expect(tx.pieceworkPriceBook.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { workerId: 'worker', status: 'PUBLISHED', effectiveTo: null } }));
  expect(tx.pieceworkPriceBook.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PUBLISHED', publishedById: 'admin' }) }));
});
it('未来生效按保存时间发布', async () => {
  const date = new Date('2030-01-01T00:00:00Z'); tx.pieceworkPriceBook.findUnique.mockResolvedValue({ ...book, effectiveFrom: date });
  await publishPersonalPieceworkDraft(revision, actor);
  expect(tx.pieceworkPriceBook.update.mock.calls[0][0].data.effectiveFrom).toEqual(date);
});
it.each([{ workerId: 'other' }, { status: 'PUBLISHED' }, { updatedAt: new Date(0) }])('拒绝其他账号/旧草稿 %j', async (change) => {
  tx.pieceworkPriceBook.findUnique.mockResolvedValue({ ...book, ...change });
  await expect(publishPersonalPieceworkDraft(revision, actor)).rejects.toThrow('已被修改');
  expect(tx.pieceworkPriceBook.update).not.toHaveBeenCalled();
});
it.each([{ rules: [] }, { rules: [{ operationType: 'FULL', unit: 'PER_PIECE', amount: '1' }] }, { rules: [{ operationType: 'PARTIAL', unit: 'PER_PASS', amount: null }] }])('个人价不完整/岗位不符不得发布 %j', async (change) => {
  tx.pieceworkPriceBook.findUnique.mockResolvedValue({ ...book, ...change });
  await expect(publishPersonalPieceworkDraft(revision, actor)).rejects.toThrow('个人工价');
});
it('切回统一价发布空规则的模式版本', async () => {
  tx.pieceworkPriceBook.findUnique.mockResolvedValue({ ...book, useUnifiedRates: true, rules: [] });
  await publishPersonalPieceworkDraft(revision, actor);
  expect(audit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'PUBLISH_VERSION' }));
});
it('重试已发布的相同修订不重复发布', async () => {
  tx.pieceworkPriceBook.findUnique.mockResolvedValue({ ...book, status: 'PUBLISHED' });
  tx.businessAuditLog.findFirst.mockResolvedValue({ before: { updatedAt: revision.updatedAt } });
  await publishPersonalPieceworkDraft(revision, actor);
  expect(tx.pieceworkPriceBook.update).not.toHaveBeenCalled();
});
it('账号停用后不能发布', async () => {
  tx.user.findUnique.mockResolvedValue({ role: 'WORKER', isActive: false });
  await expect(publishPersonalPieceworkDraft(revision, actor)).rejects.toThrow('账号');
});
it('发布拒绝过期时间和前序未来版本', async () => {
  tx.pieceworkPriceBook.findUnique.mockResolvedValue({ ...book, effectiveFrom: new Date(0) });
  await expect(publishPersonalPieceworkDraft(revision, actor)).rejects.toThrow('生效时间已过');
  tx.pieceworkPriceBook.findUnique.mockResolvedValue(book);
  tx.pieceworkPriceBook.findFirst.mockResolvedValue({ ...book, version: 1, status: 'PUBLISHED', effectiveFrom: new Date('2030-01-01') });
  await expect(publishPersonalPieceworkDraft(revision, actor)).rejects.toThrow('晚于');
});
it('创建草稿使用全局唯一版本但只复制本人适用岗位', async () => {
  tx.pieceworkPriceBook.findFirst.mockResolvedValueOnce({ ...book, status: 'PUBLISHED' }).mockResolvedValueOnce({ version: 10 });
  tx.pieceworkPriceBook.create.mockResolvedValue({ ...book, version: 11 });
  expect((await createPersonalPieceworkDraft('worker', actor)).version).toBe(11);
  expect(tx.pieceworkPriceBook.create.mock.calls[0][0].data.workerId).toBe('worker');
});
