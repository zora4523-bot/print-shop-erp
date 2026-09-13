import { beforeEach, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
const { findMany, findFirst } = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: { agentMonthlyBill: { findMany, findFirst } } }));
import { getSalesMonthlyBill, listSalesMonthlyBills } from '../sales-query';
const actor = { id: 'sales-a', role: Role.SALES };
beforeEach(() => { findMany.mockReset().mockResolvedValue([]); findFirst.mockReset().mockResolvedValue(null); });
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
  const text = JSON.stringify(query.select);
  expect(text).toContain('settledFeeSnapshot');
  for (const field of ['pricingSnapshot', 'order', 'reason', 'recordedBy', 'agentUser']) expect(text).not.toContain(`"${field}"`);
});
it('fails closed for non-sales actors', async () => {
  await expect(getSalesMonthlyBill({ id: 'admin', role: Role.ADMIN }, 'id')).rejects.toThrow();
  expect(findFirst).not.toHaveBeenCalled();
});
