import { beforeEach, expect, it, vi } from 'vitest';
const { tx, authorize, audit } = vi.hoisted(() => ({
  authorize: vi.fn(), audit: vi.fn(), tx: { $transaction: vi.fn(), $executeRaw: vi.fn(), $queryRaw: vi.fn(),
    productionOperation: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    productionReport: { create: vi.fn() }, pieceworkSettlement: { findUnique: vi.fn() }, businessAuditLog: { findFirst: vi.fn() } },
}));
vi.mock('@/lib/db', () => ({ db: tx }));
vi.mock('@/lib/audit-log', () => ({ writeAuditLogInTx: audit }));
vi.mock('@/lib/salary/piecework-price-book-admin', () => ({ assertActivePieceworkAdmin: authorize }));
vi.mock('@/lib/production/operation-reporting', () => ({ operationLockKey: (id: string) => id }));
import { listOrderWages, reviewOrderWages } from '../order-wage-review';
const actor = { id: 'admin', role: 'ADMIN' as const, username: 'admin', displayName: '管理员' };
const report = { id: 'r1', reporterId: 'w', reporter: { displayName: '师傅' }, entryType: 'REPORT', reportedAt: new Date('2026-09-16T04:00:00Z'), amount: '24', reportedCompletedQty: '1000', unit: 'PER_PASS', rate: '.007', priceBookId: 'book', priceBookVersion: 1, ruleSetSha256: 'hash', snapshot: { payroll: { rateSource: 'PERSONAL' } }, settlementItem: null };
const operation = { id: 'op', orderId: 'order', operationType: 'PARTIAL', payrollReviewRequired: true, reports: [report] };
beforeEach(() => {
  vi.resetAllMocks(); tx.$transaction.mockImplementation((fn) => fn(tx)); authorize.mockResolvedValue(actor);
  tx.productionOperation.findUnique.mockResolvedValue({ orderId: 'order' }); tx.productionOperation.findUniqueOrThrow.mockResolvedValue(operation); tx.productionOperation.findMany.mockResolvedValue([operation]);
});
async function input(amount = '19') { return { operationId: 'op', revision: (await listOrderWages('order', actor))[0]!.revision, reason: '两人平分', targets: [{ anchorId: 'r1', amount }] }; }
it('列表按人员和工作日汇总，手工只新增差额，不改报工和产量', async () => {
  const data = await input(); await reviewOrderWages(data, actor);
  expect(tx.productionReport.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entryType: 'ADJUSTMENT', amount: '-5.00', wageSupplement: '-5.00', reportedCompletedQty: 0, adjustedById: 'admin', snapshot: expect.objectContaining({ payroll: { rateSource: 'PERSONAL', manual: true } }) }) });
  expect(tx.productionOperation.update).toHaveBeenCalledWith({ where: { id: 'op' }, data: { payrollReviewRequired: false } });
  expect(audit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'CONFIRM_WAGES' }));
});
it('未改金额也可明确核定', async () => { await reviewOrderWages(await input('24'), actor); expect(tx.productionReport.create).not.toHaveBeenCalled(); expect(audit).toHaveBeenCalled(); });
it('已结算金额不能修改', async () => { const data = await input(); tx.pieceworkSettlement.findUnique.mockResolvedValue({ id: 'settled' }); await expect(reviewOrderWages(data, actor)).rejects.toThrow('已结算'); expect(tx.productionReport.create).not.toHaveBeenCalled(); });
it('旧版本核定拒绝写入', async () => { const data = await input(); await expect(reviewOrderWages({ ...data, revision: '0'.repeat(64) }, actor)).rejects.toThrow('已变化'); });
it('完全相同请求可重试，不重复记账', async () => { const data = await input(); tx.businessAuditLog.findFirst.mockResolvedValue({ after: { reason: data.reason, targets: data.targets } }); await reviewOrderWages(data, actor); expect(tx.productionReport.create).not.toHaveBeenCalled(); });
it('同版本重试不同金额拒绝', async () => { const data = await input(); tx.businessAuditLog.findFirst.mockResolvedValue({ after: { reason: data.reason, targets: [{ anchorId: 'r1', amount: '20' }] } }); await expect(reviewOrderWages(data, actor)).rejects.toThrow('已提交'); });
it('越权不能读取或核定', async () => { const data = await input(); authorize.mockRejectedValue(new Error('Forbidden')); await expect(listOrderWages('order', actor)).rejects.toThrow('Forbidden'); await expect(reviewOrderWages(data, actor)).rejects.toThrow('Forbidden'); expect(tx.productionReport.create).not.toHaveBeenCalled(); });
it.each([{ targets: [] }, { targets: [{ anchorId: 'r1', amount: '-1' }] }])('非法核定输入被拒绝 %j', async (change) => { await expect(reviewOrderWages({ ...await input(), ...change }, actor)).rejects.toThrow(); });
it('不能漏掉或替换核定对象', async () => { const data = await input(); await expect(reviewOrderWages({ ...data, targets: [{ anchorId: 'another', amount: '20' }] }, actor)).rejects.toThrow('对象不符'); await expect(reviewOrderWages({ ...data, targets: [...data.targets, ...data.targets] }, actor)).rejects.toThrow('不完整'); });
it('不存在工序返回业务错误', async () => { const data = await input(); tx.productionOperation.findUnique.mockResolvedValue(null); await expect(reviewOrderWages(data, actor)).rejects.toThrow('工序不存在'); });
it('合并人工差额，结算锁定状态，其他日期各自成行', async () => {
  tx.productionOperation.findMany.mockResolvedValue([{ ...operation, reports: [report, { ...report, id: 'delta', entryType: 'ADJUSTMENT', amount: '-5', reportedCompletedQty: '0', settlementItem: {} }, { ...report, id: 'r2', reportedAt: new Date('2026-09-17T04:00:00Z') }] }]);
  expect((await listOrderWages('order', actor))[0]!.groups).toEqual([expect.objectContaining({ amount: '19.00', quantity: '1000', settled: true }), expect.objectContaining({ date: '2026-09-17', amount: '24.00' })]);
});
it('即使未修改金额，核定后新修订仍允许再次调整', async () => {
  tx.productionOperation.findMany.mockResolvedValue([{ ...operation, updatedAt: new Date('2026-09-17T00:00:00Z') }]);
  const first = (await listOrderWages('order', actor))[0]!.revision;
  tx.productionOperation.findMany.mockResolvedValue([{ ...operation, updatedAt: new Date('2026-09-17T00:00:01Z') }]);
  expect((await listOrderWages('order', actor))[0]!.revision).not.toBe(first);
});

it('跨日只读冲正允许原额核定，禁止改写负数或给可编辑组设负数', async () => {
  const reversed = { ...operation, reports: [report, { ...report, id: 'rev', entryType: 'REVERSAL', amount: '-24', reportedCompletedQty: '-1000', reportedAt: new Date('2026-09-17T04:00:00Z') }] };
  tx.productionOperation.findMany.mockResolvedValue([reversed]);
  tx.productionOperation.findUniqueOrThrow.mockResolvedValue(reversed);
  const data = { ...await input('24'), targets: [{ anchorId: 'r1', amount: '24' }, { anchorId: 'rev', amount: '-24' }] };
  await reviewOrderWages(data, actor);
  expect(tx.productionReport.create).not.toHaveBeenCalled();
  await expect(reviewOrderWages({ ...data, targets: [data.targets[0]!, { anchorId: 'rev', amount: '-23' }] }, actor)).rejects.toThrow('冲正记录');
  await expect(reviewOrderWages({ ...data, targets: [{ anchorId: 'r1', amount: '-1' }, data.targets[1]!] }, actor)).rejects.toThrow('不能小于');
});
