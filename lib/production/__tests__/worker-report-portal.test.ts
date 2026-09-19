import { beforeEach, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
const { tx } = vi.hoisted(() => ({ tx: { user: { findFirst: vi.fn() }, productionReport: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() }, $transaction: vi.fn() } }));
vi.mock('@/lib/db', () => ({ db: tx }));
import { getWorkerReport, listWorkerReports } from '../worker-report-portal';
const actor = { id: 'worker', role: Role.WORKER };
beforeEach(() => { vi.resetAllMocks(); tx.user.findFirst.mockResolvedValue({ id: actor.id }); tx.$transaction.mockImplementation((fn) => fn(tx)); tx.productionReport.count.mockResolvedValue(41); tx.productionReport.findMany.mockResolvedValue([]); });
it('reads a report only by signed-in reporter, regardless of supplied report id', async () => {
  tx.productionReport.findFirst.mockResolvedValue(null);
  expect(await getWorkerReport('other-report', actor)).toBeNull();
  expect(tx.productionReport.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'other-report', reporterId: 'worker' } }));
});
it('scopes search and operation filter to self, clamps page and bounds database read', async () => {
  const result = await listWorkerReports(actor, { page: '999', q: 'GD-123', operationId: 'other-op' });
  expect(result.page).toBe(3);
  expect(tx.productionReport.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 40, take: 20, where: expect.objectContaining({ reporterId: 'worker', operationId: 'other-op' }) }));
});
it('denies disabled accounts and admin access before reading wage data', async () => {
  tx.user.findFirst.mockResolvedValue(null);
  await expect(getWorkerReport('report', actor)).rejects.toThrow('已启用');
  await expect(listWorkerReports({ id: 'admin', role: Role.ADMIN })).rejects.toThrow('师傅账号');
  expect(tx.productionReport.findFirst).not.toHaveBeenCalled();
  expect(tx.productionReport.findMany).not.toHaveBeenCalled();
});
