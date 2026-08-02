import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    dailyWorkerSalary: { findMany: vi.fn() },
    customerServiceCommission: { findMany: vi.fn() },
    salaryPeriod: { count: vi.fn() },
    hourlyWorkerPayroll: { findMany: vi.fn() },
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import { getSalaryIndexSummary } from '../summary';

beforeEach(() => {
  dbMock.dailyWorkerSalary.findMany.mockReset();
  dbMock.customerServiceCommission.findMany.mockReset();
  dbMock.salaryPeriod.count.mockReset();
  dbMock.hourlyWorkerPayroll.findMany.mockReset().mockResolvedValue([]);
});

describe('getSalaryIndexSummary', () => {
  it('aggregates today + unpaid + CS stats with Decimal precision', async () => {
    // Today = 3 rows: 201, 250, 180 (one paid, two unpaid)
    dbMock.dailyWorkerSalary.findMany
      .mockResolvedValueOnce([
        { actualSalary: '201.00', isPaid: true },
        { actualSalary: '250.00', isPaid: false },
        { actualSalary: '180.00', isPaid: false },
      ])
      // Unpaid all-time: 5 rows totaling 1234.56
      .mockResolvedValueOnce([
        { actualSalary: '200.00' },
        { actualSalary: '300.00' },
        { actualSalary: '150.56' },
        { actualSalary: '400.00' },
        { actualSalary: '184.00' },
      ]);
    // Settled CS periods only: remaining = (base due - base paid) +
    // (commission due - commission paid), rather than the original
    // totalIncome snapshot. IN_PROGRESS future base is not accrued here.
    dbMock.customerServiceCommission.findMany.mockResolvedValue([
      {
        monthlyBaseTotal: '8000.00',
        commissionAmount: '33000.00',
        paidBase: '6000.00',
        paidCommission: '10000.00',
      },
      {
        monthlyBaseTotal: '8000.00',
        commissionAmount: '33000.00',
        paidBase: '8000.00',
        paidCommission: '30000.00',
      },
    ]);
    // Ready: 1 period; active: 3 periods
    dbMock.salaryPeriod.count
      .mockResolvedValueOnce(1) // ready to settle
      .mockResolvedValueOnce(3); // active
    // Hourly current month: 3 rows totaling 6368 (2 unpaid = 4300)
    dbMock.hourlyWorkerPayroll.findMany
      .mockResolvedValueOnce([
        { totalSalary: '2068.00', isPaid: true },
        { totalSalary: '2232.00', isPaid: false },
        { totalSalary: '2068.00', isPaid: false },
      ])
      // All-time unpaid: 4 rows totaling 8400
      .mockResolvedValueOnce([
        { totalSalary: '2100.00' },
        { totalSalary: '2100.00' },
        { totalSalary: '2100.00' },
        { totalSalary: '2100.00' },
      ]);

    const s = await getSalaryIndexSummary();

    expect(s.dailyToday.count).toBe(3);
    expect(s.dailyToday.actualTotal).toBe('631.00');
    // Unpaid = 250 + 180 = 430
    expect(s.dailyToday.unpaidTotal).toBe('430.00');

    expect(s.dailyUnpaidAllTime.count).toBe(5);
    expect(s.dailyUnpaidAllTime.actualTotal).toBe('1234.56');

    expect(s.csUnpaid.count).toBe(2);
    expect(s.csUnpaid.totalIncome).toBe('28000.00');
    expect(dbMock.customerServiceCommission.findMany).toHaveBeenCalledWith({
      where: { isFullyPaid: false },
      select: {
        monthlyBaseTotal: true,
        commissionAmount: true,
        paidBase: true,
        paidCommission: true,
      },
    });
    expect(s.csReadyToSettle).toBe(1);
    expect(s.csActivePeriods).toBe(3);

    // Hourly month total = 2068 + 2232 + 2068 = 6368; unpaid = 4300
    expect(s.hourlyCurrentMonth.count).toBe(3);
    expect(s.hourlyCurrentMonth.totalSalary).toBe('6368.00');
    expect(s.hourlyCurrentMonth.unpaidTotal).toBe('4300.00');
    expect(s.hourlyUnpaidAllTime.count).toBe(4);
    expect(s.hourlyUnpaidAllTime.totalSalary).toBe('8400.00');
    expect(s.currentMonth).toMatch(/^\d{4}-\d{2}$/);
  });

  it('handles empty dataset (zero totals)', async () => {
    dbMock.dailyWorkerSalary.findMany.mockResolvedValue([]);
    dbMock.customerServiceCommission.findMany.mockResolvedValue([]);
    dbMock.salaryPeriod.count.mockResolvedValue(0);

    const s = await getSalaryIndexSummary();
    expect(s.dailyToday.count).toBe(0);
    expect(s.dailyToday.actualTotal).toBe('0.00');
    expect(s.csUnpaid.totalIncome).toBe('0.00');
    expect(s.csReadyToSettle).toBe(0);
  });

  it('uses Asia/Shanghai date for today (UTC midnight date column)', async () => {
    dbMock.dailyWorkerSalary.findMany.mockResolvedValue([]);
    dbMock.customerServiceCommission.findMany.mockResolvedValue([]);
    dbMock.salaryPeriod.count.mockResolvedValue(0);

    await getSalaryIndexSummary();
    // First findMany call (today's rows) uses `date: Date(UTC
    // midnight of today-Shanghai)`. We can't pin the exact value
    // without mocking the clock, but we can pin the shape: it's
    // a Date whose UTC hours are 0.
    const where = dbMock.dailyWorkerSalary.findMany.mock.calls[0][0].where;
    expect(where.date).toBeInstanceOf(Date);
    expect((where.date as Date).getUTCHours()).toBe(0);
    expect((where.date as Date).getUTCMinutes()).toBe(0);
  });

  it('does not mark an inclusive periodEnd due during its final Shanghai day', async () => {
    dbMock.dailyWorkerSalary.findMany.mockResolvedValue([]);
    dbMock.customerServiceCommission.findMany.mockResolvedValue([]);
    dbMock.salaryPeriod.count.mockResolvedValue(0);

    await getSalaryIndexSummary(new Date('2026-04-30T15:59:59.999Z'));

    const dueWhere = dbMock.salaryPeriod.count.mock.calls[0][0].where;
    expect(dueWhere.periodEnd.lt.toISOString()).toBe(
      '2026-04-30T00:00:00.000Z',
    );
  });

  it('sums with Decimal to avoid float drift', async () => {
    // Classic 0.1 + 0.2 edge — make 100 rows of 0.03 each = 3.00
    // exactly, not 2.9999999...
    dbMock.dailyWorkerSalary.findMany
      .mockResolvedValueOnce(
        Array.from({ length: 100 }, () => ({
          actualSalary: '0.03',
          isPaid: false,
        })),
      )
      .mockResolvedValueOnce([]);
    dbMock.customerServiceCommission.findMany.mockResolvedValue([]);
    dbMock.salaryPeriod.count.mockResolvedValue(0);

    const s = await getSalaryIndexSummary();
    expect(s.dailyToday.actualTotal).toBe('3.00');
  });
});
