import { beforeEach, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
const { tx } = vi.hoisted(() => ({ tx: { user: { findFirst: vi.fn() }, pieceworkSettlement: { count: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() }, $transaction: vi.fn() } }));
vi.mock('@/lib/db', () => ({ db: tx }));
import { listWorkerSettlementPage } from '../worker-settlement-page';
beforeEach(() => { vi.resetAllMocks(); tx.user.findFirst.mockResolvedValue({ id: 'worker' }); tx.$transaction.mockImplementation((fn) => fn(tx)); tx.pieceworkSettlement.count.mockResolvedValue(45); tx.pieceworkSettlement.findMany.mockResolvedValue([]); tx.pieceworkSettlement.aggregate.mockResolvedValue({ _sum: { payableAmount: '123.45' } }); });
it('keeps period totals independent of pagination and scopes every query to self', async () => {
  const result = await listWorkerSettlementPage({ id: 'worker', role: Role.WORKER }, { page: '2', status: 'paid' });
  expect(result.totalAmount).toBe('123.45');
  expect(tx.pieceworkSettlement.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20, where: expect.objectContaining({ reporterId: 'worker', status: 'PAID' }) }));
  expect(tx.pieceworkSettlement.aggregate).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ reporterId: 'worker' }) }));
  expect(tx.pieceworkSettlement.aggregate.mock.calls[0]![0].where).not.toHaveProperty('status');
});
