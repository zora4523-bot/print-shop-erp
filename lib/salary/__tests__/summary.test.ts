import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    // findMany stays on the mock on purpose: the summary must never
    // stream ledger rows into Node again, and the tests assert that.
    pieceworkSettlement: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    dailyWorkerSalary: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    customerServiceCommission: { aggregate: vi.fn(), findMany: vi.fn() },
    salaryPeriod: { count: vi.fn() },
    // The historical hourly archive is no longer part of the summary.
    hourlyWorkerPayroll: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import { getSalaryIndexSummary } from '../summary';

beforeEach(() => {
  // Zero defaults everywhere, so each test only spells out the buckets
  // it actually cares about.
  dbMock.pieceworkSettlement.groupBy.mockReset().mockResolvedValue([]);
  dbMock.pieceworkSettlement.aggregate.mockReset().mockResolvedValue({
    _count: { _all: 0 },
    _sum: { payableAmount: null },
  });
  dbMock.pieceworkSettlement.findMany.mockReset();
  dbMock.dailyWorkerSalary.groupBy.mockReset().mockResolvedValue([]);
  dbMock.dailyWorkerSalary.aggregate.mockReset().mockResolvedValue({
    _count: { _all: 0 },
    _sum: { actualSalary: null },
  });
  dbMock.dailyWorkerSalary.findMany.mockReset();
  dbMock.customerServiceCommission.aggregate.mockReset().mockResolvedValue({
    _count: { _all: 0 },
    _sum: {
      monthlyBaseTotal: null,
      commissionAmount: null,
      paidBase: null,
      paidCommission: null,
    },
  });
  dbMock.customerServiceCommission.findMany.mockReset();
  dbMock.salaryPeriod.count.mockReset().mockResolvedValue(0);
  dbMock.hourlyWorkerPayroll.groupBy.mockReset().mockResolvedValue([]);
  dbMock.hourlyWorkerPayroll.aggregate.mockReset().mockResolvedValue({
    _count: { _all: 0 },
    _sum: { totalSalary: null },
  });
  dbMock.hourlyWorkerPayroll.findMany.mockReset();
});

describe('getSalaryIndexSummary', () => {
  it('aggregates today + unpaid + CS stats with Decimal precision', async () => {
    dbMock.pieceworkSettlement.groupBy.mockResolvedValue([
      {
        status: 'LOCKED',
        _count: { _all: 2 },
        _sum: { payableAmount: '30.25' },
      },
      {
        status: 'PAID',
        _count: { _all: 1 },
        _sum: { payableAmount: '20.00' },
      },
    ]);
    dbMock.pieceworkSettlement.aggregate.mockResolvedValue({
      _count: { _all: 4 },
      _sum: { payableAmount: '80.50' },
    });
    // Today = 3 rows: 201 paid, 250 + 180 unpaid. PostgreSQL returns
    // them already folded into the two isPaid buckets.
    dbMock.dailyWorkerSalary.groupBy.mockResolvedValue([
      { isPaid: true, _count: { _all: 1 }, _sum: { actualSalary: '201.00' } },
      { isPaid: false, _count: { _all: 2 }, _sum: { actualSalary: '430.00' } },
    ]);
    // Unpaid all-time: 5 rows totaling 1234.56
    dbMock.dailyWorkerSalary.aggregate.mockResolvedValue({
      _count: { _all: 5 },
      _sum: { actualSalary: '1234.56' },
    });
    // Settled CS periods only: remaining = (base due - base paid) +
    // (commission due - commission paid), rather than the original
    // totalIncome snapshot. IN_PROGRESS future base is not accrued here.
    // Two rows' worth of column sums: 16000 - 14000 + 66000 - 40000.
    dbMock.customerServiceCommission.aggregate.mockResolvedValue({
      _count: { _all: 2 },
      _sum: {
        monthlyBaseTotal: '16000.00',
        commissionAmount: '66000.00',
        paidBase: '14000.00',
        paidCommission: '40000.00',
      },
    });
    // Ready: 1 period; active: 3 periods
    dbMock.salaryPeriod.count
      .mockResolvedValueOnce(1) // ready to settle
      .mockResolvedValueOnce(3); // active

    const s = await getSalaryIndexSummary();

    expect(s.pieceworkToday).toEqual({
      count: 3,
      payableTotal: '50.25',
      unpaidTotal: '30.25',
    });
    expect(s.pieceworkUnpaidAllTime).toEqual({
      count: 4,
      payableTotal: '80.50',
    });

    expect(s.dailyToday.count).toBe(3);
    expect(s.dailyToday.actualTotal).toBe('631.00');
    // Unpaid = 250 + 180 = 430
    expect(s.dailyToday.unpaidTotal).toBe('430.00');

    expect(s.dailyUnpaidAllTime.count).toBe(5);
    expect(s.dailyUnpaidAllTime.actualTotal).toBe('1234.56');

    expect(s.csUnpaid.count).toBe(2);
    expect(s.csUnpaid.totalIncome).toBe('28000.00');
    expect(dbMock.customerServiceCommission.aggregate).toHaveBeenCalledWith({
      where: { isFullyPaid: false },
      _count: { _all: true },
      _sum: {
        monthlyBaseTotal: true,
        commissionAmount: true,
        paidBase: true,
        paidCommission: true,
      },
    });
    expect(s.csReadyToSettle).toBe(1);
    expect(s.csActivePeriods).toBe(3);

    expect(s.currentMonth).toMatch(/^\d{4}-\d{2}$/);
  });

  it('never streams ledger rows into Node', async () => {
    await getSalaryIndexSummary();

    // The whole point of the aggregate pushdown: row count on these
    // tables must not drive memory or payload size.
    expect(dbMock.dailyWorkerSalary.findMany).not.toHaveBeenCalled();
    expect(dbMock.pieceworkSettlement.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerServiceCommission.findMany).not.toHaveBeenCalled();
    expect(dbMock.hourlyWorkerPayroll.findMany).not.toHaveBeenCalled();
    expect(dbMock.hourlyWorkerPayroll.groupBy).not.toHaveBeenCalled();
    expect(dbMock.hourlyWorkerPayroll.aggregate).not.toHaveBeenCalled();
    expect(dbMock.dailyWorkerSalary.aggregate).toHaveBeenCalledWith({
      where: { isPaid: false },
      _count: { _all: true },
      _sum: { actualSalary: true },
    });
    expect(dbMock.pieceworkSettlement.aggregate).toHaveBeenCalledWith({
      where: { status: { not: 'PAID' } },
      _count: { _all: true },
      _sum: { payableAmount: true },
    });
    expect(dbMock.dailyWorkerSalary.groupBy.mock.calls[0][0]).toMatchObject({
      by: ['isPaid'],
      _count: { _all: true },
      _sum: { actualSalary: true },
    });
  });

  it('handles empty dataset (zero totals)', async () => {
    // beforeEach already returns empty groups and null sums.
    const s = await getSalaryIndexSummary();
    expect(s.dailyToday.count).toBe(0);
    expect(s.pieceworkToday.payableTotal).toBe('0.00');
    expect(s.pieceworkUnpaidAllTime.payableTotal).toBe('0.00');
    expect(s.dailyToday.actualTotal).toBe('0.00');
    expect(s.dailyUnpaidAllTime.actualTotal).toBe('0.00');
    expect(s.csUnpaid.count).toBe(0);
    expect(s.csUnpaid.totalIncome).toBe('0.00');
    expect(s.csReadyToSettle).toBe(0);
  });

  it('handles a single bucket (all paid / all unpaid)', async () => {
    dbMock.dailyWorkerSalary.groupBy.mockResolvedValue([
      { isPaid: true, _count: { _all: 4 }, _sum: { actualSalary: '800.00' } },
    ]);

    const s = await getSalaryIndexSummary();
    expect(s.dailyToday.count).toBe(4);
    expect(s.dailyToday.actualTotal).toBe('800.00');
    expect(s.dailyToday.unpaidTotal).toBe('0.00');
  });

  it('uses Asia/Shanghai date for today (UTC midnight date column)', async () => {
    await getSalaryIndexSummary();
    // First groupBy call (today's buckets) uses `date: Date(UTC
    // midnight of today-Shanghai)`. We can't pin the exact value
    // without mocking the clock, but we can pin the shape: it's
    // a Date whose UTC hours are 0.
    const where = dbMock.dailyWorkerSalary.groupBy.mock.calls[0][0].where;
    expect(where.date).toBeInstanceOf(Date);
    expect((where.date as Date).getUTCHours()).toBe(0);
    expect((where.date as Date).getUTCMinutes()).toBe(0);
  });

  it('does not mark an inclusive periodEnd due during its final Shanghai day', async () => {
    await getSalaryIndexSummary(new Date('2026-04-30T15:59:59.999Z'));

    const dueWhere = dbMock.salaryPeriod.count.mock.calls[0][0].where;
    expect(dueWhere.periodEnd.lt.toISOString()).toBe(
      '2026-04-30T00:00:00.000Z',
    );
  });

  it('keeps the SQL sum exact instead of routing it through a float', async () => {
    // 9007199254740993.03 is past float64's integer resolution: Number()
    // would silently return 9007199254740992. The Decimal string path
    // must survive intact.
    dbMock.dailyWorkerSalary.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: { actualSalary: '9007199254740993.03' },
    });

    const s = await getSalaryIndexSummary();
    expect(s.dailyUnpaidAllTime.actualTotal).toBe('9007199254740993.03');
  });

  it('combines the four CS column sums without float drift', async () => {
    // 0.1 + 0.2 style residue on every column; the combination must
    // land exactly on 0.10.
    dbMock.customerServiceCommission.aggregate.mockResolvedValue({
      _count: { _all: 7 },
      _sum: {
        monthlyBaseTotal: '0.10',
        commissionAmount: '0.20',
        paidBase: '0.10',
        paidCommission: '0.10',
      },
    });

    const s = await getSalaryIndexSummary();
    expect(s.csUnpaid.count).toBe(7);
    expect(s.csUnpaid.totalIncome).toBe('0.10');
  });

  it('treats a null SQL sum as zero rather than NaN', async () => {
    dbMock.customerServiceCommission.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: {
        monthlyBaseTotal: null,
        commissionAmount: null,
        paidBase: null,
        paidCommission: null,
      },
    });

    const s = await getSalaryIndexSummary();
    expect(s.csUnpaid.totalIncome).toBe('0.00');
  });
});
