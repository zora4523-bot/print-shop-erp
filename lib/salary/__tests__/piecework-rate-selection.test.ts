import { expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { resolveReporterPieceworkRate } from '../piecework-rate-selection';
const at = new Date('2026-09-16T12:00:00Z');
function book(extra: Record<string, unknown> = {}) { return { id: 'global', workerId: null, version: 1, ruleSetSha256: 'a'.repeat(64), rules: [{ operationType: 'PARTIAL', unit: 'PER_PASS', amount: new Prisma.Decimal('0.2') }], ...extra }; }
async function resolve(books: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(books);
  const result = await resolveReporterPieceworkRate({ pieceworkPriceBook: { findMany } } as unknown as Prisma.TransactionClient, 'worker', 'PARTIAL', 'PER_PASS', at);
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ effectiveFrom: { lte: at }, AND: expect.arrayContaining([{ OR: [{ workerId: null }, { workerId: 'worker' }] }]) }) }));
  return result;
}
it('初始账号使用统一价', async () => { expect((await resolve([book()])).source).toBe('UNIFIED'); });
it('个人价按本人选择，即使统一价缺失也不依赖它', async () => {
  expect(await resolve([book({ workerId: 'worker', id: 'personal', useUnifiedRates: false })])).toMatchObject({ source: 'PERSONAL', key: 'personal:personal' });
});
it('显式切回统一价保留账号模式版本', async () => {
  expect(await resolve([book(), book({ id: 'policy', workerId: 'worker', useUnifiedRates: true, rules: [] })])).toMatchObject({ source: 'UNIFIED', key: 'global:policy', policy: { id: 'policy' } });
});
for (const [index, books] of [[], [book(), book()], [book({ workerId: 'worker' }), book({ workerId: 'worker' })], [book({ rules: [] })], [book({ ruleSetSha256: null })], [book({ rules: [{ unit: 'PER_PASS', amount: null }] })], [book({ rules: [{ unit: 'PER_PIECE', amount: '1' }] })]].entries()) {
  it(`缺价/冲突拒绝 ${index}`, async () => { await expect(resolve(books)).rejects.toMatchObject({ code: 'PIECEWORK_RATE_UNAVAILABLE' }); });
}
it('个人模式缺价禁止回退统一价', async () => { await expect(resolve([book(), book({ workerId: 'worker', rules: [] })])).rejects.toThrow('个人工价未配置'); });
it('明确零元是有效工价', async () => { expect((await resolve([book({ rules: [{ operationType: 'PARTIAL', unit: 'PER_PASS', amount: new Prisma.Decimal(0) }] })])).rule.amount?.toString()).toBe('0'); });
