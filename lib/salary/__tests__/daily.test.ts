import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    dailyWorkerSalary: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { actualSalary: null } }),
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
  dbMock.dailyWorkerSalary.count.mockReset().mockResolvedValue(0);
  dbMock.dailyWorkerSalary.aggregate.mockReset().mockResolvedValue({ _sum: { actualSalary: null } });
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

describe('salary list pagination', () => {
  it.each([
    [undefined, undefined, 1, 50, 0],
    [['2', '9'], '20', 2, 20, 20],
    ['oops', '-2', 1, 1, 0],
    ['999', '999', 3, 100, 200],
  ])('parses page=%s pageSize=%s and bounds take/skip', async (page, pageSize, expectedPage, take, skip) => {
    dbMock.dailyWorkerSalary.count.mockResolvedValue(205);
    dbMock.dailyWorkerSalary.findMany.mockResolvedValue([]);
    const result = await listDailyWorkerSalaries({ page, pageSize });
    expect(result).toMatchObject({ page: expectedPage, pageSize: take, total: 205 });
    expect(dbMock.dailyWorkerSalary.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take, skip }));
  });
});

it('keeps filtered owner totals independent of the visible page', async () => {
  dbMock.dailyWorkerSalary.count.mockResolvedValue(120);
  dbMock.dailyWorkerSalary.findMany.mockResolvedValue([]);
  dbMock.dailyWorkerSalary.aggregate
    .mockResolvedValueOnce({ _sum: { actualSalary: '1000.01' } })
    .mockResolvedValueOnce({ _sum: { actualSalary: null } });
  const result = await listDailyWorkerSalaries({ workerId: 'w1', isPaid: true, page: '2' });
  expect(result).toMatchObject({ total: 120, totalSalary: '1000.01', unpaidSalary: '0' });
  expect(dbMock.dailyWorkerSalary.aggregate).toHaveBeenNthCalledWith(1, { where: { workerId: 'w1', isPaid: true }, _sum: { actualSalary: true } });
  expect(dbMock.dailyWorkerSalary.aggregate).toHaveBeenNthCalledWith(2, { where: { AND: [{ workerId: 'w1', isPaid: true }, { isPaid: false }] }, _sum: { actualSalary: true } });
});
