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
it.each(['unpaid', 'paid', undefined])('lists every settlement for status %s until the worker picks a date', async (status) => {
  await listWorkerSettlementPage({ id: 'worker', role: Role.WORKER }, { status });
  for (const mock of [tx.pieceworkSettlement.count, tx.pieceworkSettlement.findMany]) expect(mock.mock.calls[0]![0].where).not.toHaveProperty('workDate');
  if (status === 'unpaid') expect(tx.pieceworkSettlement.findMany.mock.calls[0]![0].where).toMatchObject({ reporterId: 'worker', status: { not: 'PAID' } });
});
it('applies a one-sided range without inventing the other bound', async () => {
  await listWorkerSettlementPage({ id: 'worker', role: Role.WORKER }, { from: new Date('2026-08-01'), status: 'unpaid' });
  expect(tx.pieceworkSettlement.findMany.mock.calls[0]![0].where.workDate).toEqual({ gte: new Date('2026-08-01') });
  await listWorkerSettlementPage({ id: 'worker', role: Role.WORKER }, { to: new Date('2026-08-31') });
  expect(tx.pieceworkSettlement.findMany.mock.calls[1]![0].where.workDate).toEqual({ lte: new Date('2026-08-31') });
});
// Totals must include an unpaid settlement from outside the chosen period.
it('keeps lifetime totals and unpaid amount independent of the period filter', async () => {
  await listWorkerSettlementPage({ id: 'worker', role: Role.WORKER }, { from: new Date('2026-09-01'), to: new Date('2026-09-18') });
  expect(tx.pieceworkSettlement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workDate: expect.anything() }) }));
  for (const call of tx.pieceworkSettlement.aggregate.mock.calls) {
    expect(call[0].where).not.toHaveProperty('workDate');
    expect(call[0].where).toMatchObject({ reporterId: 'worker' });
  }
  expect(tx.pieceworkSettlement.aggregate.mock.calls[1]![0].where).toMatchObject({ status: { not: 'PAID' } });
});
