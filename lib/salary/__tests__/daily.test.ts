import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    dailyWorkerSalary: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    dailyWorkerSalaryItem: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  getDailyWorkerSalaryDetail,
  getOrderPieceworkSummary,
  listDailyWorkerSalaries,
  listMachineWorkersForSalary,
} from '../daily';

beforeEach(() => {
  dbMock.dailyWorkerSalary.findMany.mockReset().mockResolvedValue([]);
  dbMock.dailyWorkerSalary.findUnique.mockReset().mockResolvedValue(null);
  dbMock.dailyWorkerSalaryItem.findMany.mockReset().mockResolvedValue([]);
  dbMock.user.findMany.mockReset().mockResolvedValue([]);
});

describe('legacy DailyWorkerSalary read adapter', () => {
  it('rejects an invalid calendar date without querying the archive', async () => {
    await expect(
      listDailyWorkerSalaries({ date: '2026-02-31' }),
    ).rejects.toThrow(/日期格式非法/);
    expect(dbMock.dailyWorkerSalary.findMany).not.toHaveBeenCalled();
  });

  it('passes archive filters without exposing a write or recompute path', async () => {
    await listDailyWorkerSalaries({
      date: '2026-05-01',
      workerId: 'worker-1',
      isPaid: false,
    });

    expect(dbMock.dailyWorkerSalary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          date: new Date('2026-05-01T00:00:00.000Z'),
          workerId: 'worker-1',
          isPaid: false,
        },
      }),
    );
  });

  it('keeps historical workers visible even after the account is inactive', async () => {
    await listMachineWorkersForSalary();

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { dailyWorkerSalaries: { some: {} } },
            expect.objectContaining({ isActive: true }),
          ],
        },
      }),
    );
  });

  it('reads detail snapshots and adjustments without recalculation', async () => {
    await getDailyWorkerSalaryDetail('daily-1');

    expect(dbMock.dailyWorkerSalary.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'daily-1' },
        include: expect.objectContaining({
          items: expect.any(Object),
          adjustments: expect.any(Object),
        }),
      }),
    );
  });

  it('totals only legacy salary items for the order drill-down', async () => {
    dbMock.dailyWorkerSalaryItem.findMany.mockResolvedValue([
      { pieceworkAmount: '12.34' },
      { pieceworkAmount: '7.66' },
    ]);

    await expect(getOrderPieceworkSummary('order-1')).resolves.toMatchObject({
      total: '20.00',
    });
    expect(dbMock.dailyWorkerSalaryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 'order-1' } }),
    );
  });
});
