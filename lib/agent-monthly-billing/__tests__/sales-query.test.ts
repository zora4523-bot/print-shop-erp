import { beforeEach, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
const { findMany, findFirst, count, groupBy } = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => { const db = { agentMonthlyBill: { findMany, findFirst, count, groupBy } }; return { db: { ...db, $transaction: (callback: (tx: typeof db) => unknown) => callback(db) } }; });
import { getSalesMonthlyBill, listSalesMonthlyBills } from '../sales-query';
const actor = { id: 'sales-a', role: Role.SALES };
beforeEach(() => { count.mockReset().mockResolvedValue(0); groupBy.mockReset().mockResolvedValue([]); findMany.mockReset().mockResolvedValue([]); findFirst.mockReset().mockResolvedValue(null); });
it('uses monthly bills, constrains ownership and ignores malformed filters', async () => {
  await listSalesMonthlyBills(actor, { period: '2026-99', status: 'ISSUED' });
  expect(findMany.mock.calls[0][0].where).toEqual({ agentUserId: actor.id });
  await listSalesMonthlyBills(actor, { period: '2026-09', status: 'PAID' });
  expect(findMany.mock.calls[1][0].where).toEqual({ agentUserId: actor.id, period: '2026-09', status: 'PAID' });
});
it('never loads another sales bill or current order prices and internal credit reasons', async () => {
  expect(await getSalesMonthlyBill(actor, 'foreign')).toBeNull();
  const query = findFirst.mock.calls[0][0];
  expect(query.where).toEqual({ id: 'foreign', agentUserId: actor.id });
  // 唯一的工单关联是明细“工单名称”标签；金额仍只读成员冻结快照。
  expect(query.select.items.select.order).toEqual({ select: { customName: true } });
  const frozenItem = { ...query.select.items.select };
  delete frozenItem.order;
  const text = JSON.stringify({ ...query.select, items: { ...query.select.items, select: frozenItem } });
  expect(text).toContain('settledFeeSnapshot');
  for (const field of ['pricingSnapshot', 'order', 'reason', 'recordedBy', 'agentUser', 'customerRefSnapshot']) expect(text).not.toContain(`"${field}"`);
});
it('fails closed for non-sales actors', async () => {
  await expect(getSalesMonthlyBill({ id: 'admin', role: Role.ADMIN }, 'id')).rejects.toThrow();
  expect(findFirst).not.toHaveBeenCalled();
});
it('selects only customer-facing receipt facts and frozen item identity/status', async () => {
  await getSalesMonthlyBill(actor, 'bill-a');
  const query = findFirst.mock.calls[0][0];
  expect(query.where).toEqual({ agentUserId: actor.id, id: 'bill-a' });
  expect(query.select.receipt).toEqual({ select: {
    amount: true, receivedAt: true, paymentMethod: true, referenceNo: true,
  } });
  expect(query.select.items.select).toMatchObject({
    id: true, orderId: true, orderNoSnapshot: true, workOrderVersionSnapshot: true,
    orderStatusSnapshot: true, settledFeeSnapshot: true, settledAtSnapshot: true,
    order: { select: { customName: true } },
  });
});

it('bounds pages and summarizes the complete owned result, not just the visible page', async () => {
  count.mockResolvedValue(61);
  groupBy.mockResolvedValue([{ status: 'CONFIRMED', _sum: { totalAmount: { toFixed: () => '100.10' } }, _count: { _all: 61 } }]);
  const result = await listSalesMonthlyBills(actor, { page: '999999', agentUserId: 'foreign' });
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { agentUserId: actor.id }, skip: 60, take: 30 }));
  expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { agentUserId: actor.id }, by: ['status'] }));
  expect(result).toMatchObject({ page: 3, pageCount: 3, total: 61, summary: { CONFIRMED: { amount: '100.10', count: 61 }, PAID: { amount: '0.00', count: 0 } } });
});
it('denies a non-sales list before reading aggregates', async () => {
  await expect(listSalesMonthlyBills({ id: 'admin', role: Role.ADMIN })).rejects.toThrow();
  expect(count).not.toHaveBeenCalled();
});
it('limits linked allocations to the same sales account and omits internal credit reasons', async () => {
  await getSalesMonthlyBill(actor, 'bill-a');
  const credits = findFirst.mock.calls[0][0].select.items.select.credits;
  expect(credits.select.allocations.where).toEqual({ bill: { agentUserId: actor.id } });
  expect(credits.select).not.toHaveProperty('reason');
  expect(credits.select).not.toHaveProperty('createdBy');
});
