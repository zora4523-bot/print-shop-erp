import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
const { order, users } = vi.hoisted(() => ({ order: vi.fn(), users: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { order: { findUnique: order }, user: { findMany: users } } }));
import { getOrderExternalSalesAssociation } from '../external-sales-association';

const current = { id: 'sales-1', displayName: '渠道张先生', username: 'sales-one' };
beforeEach(() => {
  vi.resetAllMocks();
  order.mockResolvedValue({
    submitterId: current.id, submitter: current, status: 'DRAFT', settlementType: 'EXTERNAL_SALES',
    settledAt: null, settledFee: null, shippedAt: null, finishedAt: null, sourceOrderId: null,
    _count: { billItems: 0, reworkOrders: 0, changeRequests: 0 }, agentMonthlyBillItem: null,
  });
  users.mockResolvedValue([current]);
});

describe('admin external sales account options', () => {
  it.each([Role.SALES, Role.WORKER])('does not query accounts for %s', async (role) => {
    expect(await getOrderExternalSalesAssociation('order-1', { role })).toBeUndefined();
    expect(order).not.toHaveBeenCalled();
    expect(users).not.toHaveBeenCalled();
  });
  it('only requests active SALES accounts with safe display fields', async () => {
    expect(await getOrderExternalSalesAssociation('order-1', { role: Role.ADMIN })).toEqual({
      current, options: [current], blockedReason: null,
    });
    expect(users).toHaveBeenCalledWith({
      where: { role: Role.SALES, isActive: true },
      select: { id: true, displayName: true, username: true },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    });
  });
  it('shows existing attribution without offering reassignment for frozen orders', async () => {
    order.mockResolvedValueOnce({ status: 'CONFIRMED', settlementType: 'EXTERNAL_SALES', submitter: current });
    const result = await getOrderExternalSalesAssociation('order-1', { role: Role.ADMIN });
    expect(result).toEqual({ current, options: [], blockedReason: expect.stringContaining('已确认') });
    expect(users).not.toHaveBeenCalled();
  });
});
