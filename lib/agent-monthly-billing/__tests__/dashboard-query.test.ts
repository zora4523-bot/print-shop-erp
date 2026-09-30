import { beforeEach, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { Role } from '@/generated/prisma/enums';
const { groupBy } = vi.hoisted(() => ({ groupBy: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: { $transaction: (callback: (tx: unknown) => unknown) => callback({ agentMonthlyBill: { groupBy } }) } }));
import { dashboardPeriods, getAgentBillDashboard } from '../dashboard-query';
beforeEach(() => groupBy.mockReset());
it('uses twelve Shanghai calendar months across the year boundary', () => {
  const periods = dashboardPeriods(new Date('2026-09-30T16:00:00Z'));
  expect(periods).toHaveLength(12);
  expect(periods[0]).toBe('2025-11');
  expect(periods.at(-1)).toBe('2026-10');
});
it('keeps draft, current receivable and settled amounts separate without duplicating joined items', async () => {
  groupBy.mockResolvedValueOnce([
    { period: '2026-09', status: 'DRAFT', _sum: { totalAmount: new Decimal('0.10') } },
    { period: '2026-09', status: 'CONFIRMED', _sum: { totalAmount: new Decimal('0.20') } },
    { period: '2026-09', status: 'PAID', _sum: { totalAmount: new Decimal('0.00') } },
  ]).mockResolvedValueOnce([{ agentUserId: 'a', _sum: { totalAmount: new Decimal('0.20') }, _count: { _all: 1 } }]);
  const result = await getAgentBillDashboard({ role: Role.ADMIN }, new Date('2026-09-15T00:00:00Z'));
  expect(result.periods.at(-1)).toEqual({ period: '2026-09', draft: '0.10', confirmed: '0.20', paid: '0.00', total: '0.30' });
  expect(result.periods[0].total).toBe('0.00');
  expect(groupBy.mock.calls[1][0]).toMatchObject({ by: ['agentUserId'], where: { status: 'CONFIRMED' }, take: 10 });
});
it.each([Role.SALES, Role.WORKER])('rejects %s before querying global amounts', async (role) => {
  await expect(getAgentBillDashboard({ role })).rejects.toThrow();
  expect(groupBy).not.toHaveBeenCalled();
});
