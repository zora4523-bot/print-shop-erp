import { beforeEach, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: { party: { findMany } } }));
import { listSalesCustomerOptions } from '../sales-customer-scope';
beforeEach(() => findMany.mockReset().mockResolvedValue([]));
it('queries only customers linked to the current salesperson and never selects contact relations', async () => {
  await listSalesCustomerOptions({ id: 'sales-a', role: Role.SALES });
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { customerOrders: { some: { submitterId: 'sales-a' } }, isActive: true, type: { in: ['CUSTOMER', 'BOTH'] } },
    select: { id: true, code: true, name: true, shortName: true },
  }));
});
it('rejects another role before querying', async () => {
  await expect(listSalesCustomerOptions({ id: 'worker', role: Role.WORKER })).rejects.toThrow();
  expect(findMany).not.toHaveBeenCalled();
});
