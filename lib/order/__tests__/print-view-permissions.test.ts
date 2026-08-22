import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, Role } from '../../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    order: { findFirst: vi.fn() },
    craft: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { getOrderForPrint } from '../print-view';

beforeEach(() => {
  dbMock.order.findFirst.mockReset().mockResolvedValue(null);
  dbMock.craft.findMany.mockReset().mockResolvedValue([]);
});

describe('getOrderForPrint permissions', () => {
  it('hides a SUBMITTED scheduling draft from the assigned WORKER in print and PDF flows', async () => {
    await expect(
      getOrderForPrint(
        'scheduling-draft',
        { id: 'worker-1', role: Role.WORKER },
        'https://erp.example.com',
      ),
    ).resolves.toBeNull();

    expect(dbMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'scheduling-draft',
          status: { not: OrderStatus.SUBMITTED },
          items: {
            some: {
              tasks: { some: { workerId: 'worker-1' } },
            },
          },
        },
      }),
    );
    expect(dbMock.craft.findMany).not.toHaveBeenCalled();
  });
});
