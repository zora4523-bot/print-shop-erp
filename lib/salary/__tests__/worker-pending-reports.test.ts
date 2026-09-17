import { beforeEach, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
const { tx } = vi.hoisted(() => ({ tx: { $transaction: vi.fn(), user: { findUnique: vi.fn() }, productionReport: { count: vi.fn(), findMany: vi.fn() } } }));
vi.mock('@/lib/db', () => ({ db: tx }));
import { listWorkerPendingReports } from '../worker-pending-reports';
const actor = { id: 'worker-a', role: 'WORKER' as const, workerType: 'MACHINE' as const };
beforeEach(() => {
  vi.resetAllMocks();
  tx.$transaction.mockImplementation((fn) => fn(tx));
  tx.user.findUnique.mockResolvedValue({ role: 'WORKER', workerType: 'MACHINE', isActive: true });
  tx.productionReport.count.mockResolvedValue(1);
  tx.productionReport.findMany.mockResolvedValue([{ id: 'report', amount: new Decimal('-5'), reportedCompletedQty: new Decimal(0), entryType: 'ADJUSTMENT', operation: { payrollReviewRequired: true } }]);
});
it('只查询本人未结算流水，日期按上海日界处理，保留调整的负数', async () => {
  const result = await listWorkerPendingReports(actor, { from: '2026-09-17', to: '2026-09-17' });
  const where = { reporterId: 'worker-a', settlementItem: null, reportedAt: { gte: new Date('2026-09-16T16:00:00Z'), lt: new Date('2026-09-17T16:00:00Z') } };
  expect(tx.productionReport.count).toHaveBeenCalledWith({ where });
  expect(tx.productionReport.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, take: 20, skip: 0 }));
  expect(result.rows[0]).toMatchObject({ amount: '-5', quantity: '0', entryType: 'ADJUSTMENT', operation: { payrollReviewRequired: true } });
  expect(tx.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
});
it('分页有界，超范围页回到末页', async () => {
  tx.productionReport.count.mockResolvedValue(45);
  const result = await listWorkerPendingReports(actor, { page: '99999' });
  expect(result).toMatchObject({ total: 45, page: 3, pageCount: 3 });
  expect(tx.productionReport.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 40, take: 20 }));
});
it('管理员不能冒充师傅读取', async () => {
  await expect(listWorkerPendingReports({ ...actor, role: 'ADMIN' })).rejects.toThrow('仅师傅');
  expect(tx.productionReport.findMany).not.toHaveBeenCalled();
});
it.each([null, { role: 'WORKER', workerType: 'MACHINE', isActive: false }, { role: 'ADMIN', workerType: 'MACHINE', isActive: true }, { role: 'WORKER', workerType: 'COOK', isActive: true }])('停用、改岗或改角色的旧身份不能继续访问 %j', async (worker) => {
  tx.user.findUnique.mockResolvedValue(worker);
  await expect(listWorkerPendingReports(actor)).rejects.toThrow('未启用计件');
  expect(tx.productionReport.findMany).not.toHaveBeenCalled();
});
it('打包员按本人身份读取，不能由表单选择其他师傅', async () => {
  tx.user.findUnique.mockResolvedValue({ role: 'WORKER', workerType: 'PACKER', isActive: true });
  await listWorkerPendingReports({ ...actor, id: 'packer', workerType: 'PACKER' });
  expect(tx.productionReport.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ reporterId: 'packer' }) }));
});
it('无记录仍返回有效分页，不伪造金额', async () => {
  tx.productionReport.count.mockResolvedValue(0); tx.productionReport.findMany.mockResolvedValue([]);
  expect(await listWorkerPendingReports(actor)).toMatchObject({ rows: [], total: 0, page: 1, pageCount: 1 });
});
