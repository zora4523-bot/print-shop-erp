import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock, getActiveCsTiersMock } = vi.hoisted(() => {
  const mock = {
    order: { findMany: vi.fn() },
    outsourceOrder: { findMany: vi.fn() },
    salaryPeriod: { findMany: vi.fn() },
  };
  return {
    dbMock: mock,
    getActiveCsTiersMock: vi.fn(),
  };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('../../salary/rules', () => ({
  getActiveCsTiers: getActiveCsTiersMock,
}));

import {
  getEndingPeriods,
  getOverdueOutsourcing,
  getPendingShipments,
} from '../owner-watchlist';

beforeEach(() => {
  dbMock.order.findMany.mockReset();
  dbMock.outsourceOrder.findMany.mockReset();
  dbMock.salaryPeriod.findMany.mockReset();
  getActiveCsTiersMock.mockReset();
});

describe('getPendingShipments', () => {
  it('空 → rows: [] / hasMore: false', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    const r = await getPendingShipments();
    expect(r.rows).toEqual([]);
    expect(r.hasMore).toBe(false);
  });

  it('查询 status=COMPLETED + orderBy 急单 desc / 完工时间 asc', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await getPendingShipments();
    const args = dbMock.order.findMany.mock.calls[0][0];
    expect(args.where.status).toBe('COMPLETED');
    expect(args.orderBy).toEqual([
      { isUrgent: 'desc' },
      { completedAt: 'asc' },
    ]);
  });

  it('take 是 limit + 1（hasMore 探针）', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await getPendingShipments(undefined, 10);
    const args = dbMock.order.findMany.mock.calls[0][0];
    expect(args.take).toBe(11);
  });

  it('< limit 行 → hasMore=false，行数原样', async () => {
    const completedAt = new Date('2026-04-25T08:00:00Z');
    dbMock.order.findMany.mockResolvedValue([
      makePendingRow('o1', 'E2E-1', completedAt, false, '小王'),
      makePendingRow('o2', 'E2E-2', completedAt, true, '小李'),
    ]);
    const r = await getPendingShipments(undefined, 10);
    expect(r.rows).toHaveLength(2);
    expect(r.hasMore).toBe(false);
  });

  it('= limit + 1 行 → hasMore=true，rows 截至 limit', async () => {
    const completedAt = new Date('2026-04-25T08:00:00Z');
    const raw = Array.from({ length: 11 }, (_, i) =>
      makePendingRow(`o${i}`, `E2E-${i}`, completedAt, false, '小王'),
    );
    dbMock.order.findMany.mockResolvedValue(raw);
    const r = await getPendingShipments(undefined, 10);
    expect(r.rows).toHaveLength(10);
    expect(r.hasMore).toBe(true);
  });

  it('row 投影：customerRef / submitter.displayName / isUrgent', async () => {
    const completedAt = new Date('2026-04-25T08:00:00Z');
    dbMock.order.findMany.mockResolvedValue([
      makePendingRow('o1', 'E2E-1', completedAt, true, '小王', 'CUST-A'),
    ]);
    const r = await getPendingShipments();
    expect(r.rows[0]).toEqual({
      id: 'o1',
      orderNo: 'E2E-1',
      customerRef: 'CUST-A',
      isUrgent: true,
      completedAt,
      submitterDisplayName: '小王',
    });
  });
});

describe('getOverdueOutsourcing', () => {
  it('空 → []', async () => {
    dbMock.outsourceOrder.findMany.mockResolvedValue([]);
    expect(await getOverdueOutsourcing()).toEqual([]);
  });

  it('查询条件：status ∈ [SENT, IN_PROGRESS] + expectedDate < todayStart + NOT null', async () => {
    dbMock.outsourceOrder.findMany.mockResolvedValue([]);
    await getOverdueOutsourcing(new Date('2026-04-26T08:00:00Z'));
    const args = dbMock.outsourceOrder.findMany.mock.calls[0][0];
    expect(args.where.status).toEqual({ in: ['SENT', 'IN_PROGRESS'] });
    // todayStart for Shanghai 2026-04-26 = UTC 2026-04-25T16:00
    expect((args.where.expectedDate.lt as Date).toISOString()).toBe(
      '2026-04-25T16:00:00.000Z',
    );
    expect(args.where.NOT).toEqual({ expectedDate: null });
    expect(args.orderBy).toEqual({ expectedDate: 'asc' });
  });

  it('daysOverdue 计算：3 天前预计 → 3 天超期', async () => {
    // todayStart = UTC 2026-04-25T16:00 = Shanghai 2026-04-26T00:00
    // expectedDate = Shanghai 2026-04-23T00:00 = UTC 2026-04-22T16:00
    dbMock.outsourceOrder.findMany.mockResolvedValue([
      {
        id: 'os1',
        supplierName: '阿福外协',
        expectedDate: new Date('2026-04-22T16:00:00Z'),
        status: 'IN_PROGRESS',
        order: { orderNo: 'O-1' },
      },
    ]);
    const r = await getOverdueOutsourcing(new Date('2026-04-26T08:00:00Z'));
    expect(r).toHaveLength(1);
    expect(r[0]!.daysOverdue).toBe(3);
    expect(r[0]!.orderNo).toBe('O-1');
    expect(r[0]!.status).toBe('IN_PROGRESS');
  });

  it('order: null 时 orderNo: null（无关联工单）', async () => {
    dbMock.outsourceOrder.findMany.mockResolvedValue([
      {
        id: 'os1',
        supplierName: '独立外协',
        expectedDate: new Date('2026-04-22T16:00:00Z'),
        status: 'SENT',
        order: null,
      },
    ]);
    const r = await getOverdueOutsourcing(new Date('2026-04-26T08:00:00Z'));
    expect(r[0]!.orderNo).toBeNull();
  });

  // 边界：expected = today 不应被 PRISMA 过滤掉（lt 半开），所以这里
  // mock 不会返回它；但若 mock 真返回 todayStart，daysOverdue=0，UI 应
  // 该不渲染（业务上"今日预计今日没收"还不算"超期"）。
  it('expected = todayStart → daysOverdue=0（边界）', async () => {
    dbMock.outsourceOrder.findMany.mockResolvedValue([
      {
        id: 'os1',
        supplierName: '阿福外协',
        expectedDate: new Date('2026-04-25T16:00:00Z'), // exactly todayStart
        status: 'SENT',
        order: { orderNo: 'O-1' },
      },
    ]);
    const r = await getOverdueOutsourcing(new Date('2026-04-26T08:00:00Z'));
    expect(r[0]!.daysOverdue).toBe(0);
  });
});

describe('getEndingPeriods', () => {
  it('空 → []，且不调 getActiveCsTiers', async () => {
    dbMock.salaryPeriod.findMany.mockResolvedValue([]);
    const r = await getEndingPeriods();
    expect(r).toEqual([]);
    expect(getActiveCsTiersMock).not.toHaveBeenCalled();
  });

  it('查询条件：status=IN_PROGRESS + periodEnd ∈ [todayStart, todayStart+7d)', async () => {
    dbMock.salaryPeriod.findMany.mockResolvedValue([]);
    await getEndingPeriods(new Date('2026-04-26T08:00:00Z'));
    const args = dbMock.salaryPeriod.findMany.mock.calls[0][0];
    expect(args.where.status).toBe('IN_PROGRESS');
    // todayStart = UTC 2026-04-25T16:00
    expect((args.where.periodEnd.gte as Date).toISOString()).toBe(
      '2026-04-25T16:00:00.000Z',
    );
    // +7 天
    expect((args.where.periodEnd.lt as Date).toISOString()).toBe(
      '2026-05-02T16:00:00.000Z',
    );
  });

  it('预测提成 = (totalSales + initialSales) × 命中档位 rate', async () => {
    dbMock.salaryPeriod.findMany.mockResolvedValue([
      {
        id: 'p1',
        csUserId: 'u1',
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-04-30T00:00:00Z'),
        durationMonths: 4,
        totalSales: '300000',
        initialSales: '0',
        monthlyBase: '5000',
        csUser: { displayName: 'CS 张' },
      },
    ]);
    getActiveCsTiersMock.mockResolvedValue({
      mode: 'FLAT',
      tiers: [
        { minSales: 100000, rate: 0.01 },
        { minSales: 300000, rate: 0.03 },
      ],
    });

    const r = await getEndingPeriods(new Date('2026-04-26T08:00:00Z'));
    expect(r).toHaveLength(1);
    // 300000 命中第二档 0.03 → 9000 提成
    expect(r[0]!.predictedCommission).toBe('9000.00');
    // 底薪合计 = 5000 × 4 = 20000；总收入 = 20000 + 9000 = 29000
    expect(r[0]!.predictedTotalIncome).toBe('29000.00');
    expect(r[0]!.predictedBelowAllTiers).toBe(false);
  });

  it('initialSales 累加到预测里（业绩归属时间口径）', async () => {
    dbMock.salaryPeriod.findMany.mockResolvedValue([
      {
        id: 'p1',
        csUserId: 'u1',
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-04-30T00:00:00Z'),
        durationMonths: 4,
        totalSales: '50000', // 期内
        initialSales: '60000', // 期初导入
        monthlyBase: '5000',
        csUser: { displayName: 'CS 张' },
      },
    ]);
    getActiveCsTiersMock.mockResolvedValue({
      mode: 'FLAT',
      tiers: [{ minSales: 100000, rate: 0.01 }],
    });
    const r = await getEndingPeriods(new Date('2026-04-26T08:00:00Z'));
    // (50000 + 60000) ≥ 100000 → 命中 0.01 → 1100 提成
    expect(r[0]!.predictedCommission).toBe('1100.00');
    // salesForTier = totalSales + initialSales = 110000.00（UI 列&ldquo;业绩
    // 合计&rdquo;直接用，避免显示数和提成口径分裂；Codex round 99 medium）。
    expect(r[0]!.salesForTier).toBe('110000.00');
    expect(r[0]!.totalSales).toBe('50000.00');
    expect(r[0]!.initialSales).toBe('60000.00');
  });

  it('totalSales 未达档 → predictedBelowAllTiers=true，提成=0.00', async () => {
    dbMock.salaryPeriod.findMany.mockResolvedValue([
      {
        id: 'p1',
        csUserId: 'u1',
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-04-30T00:00:00Z'),
        durationMonths: 4,
        totalSales: '5000',
        initialSales: '0',
        monthlyBase: '5000',
        csUser: { displayName: 'CS 张' },
      },
    ]);
    getActiveCsTiersMock.mockResolvedValue({
      mode: 'FLAT',
      tiers: [{ minSales: 100000, rate: 0.01 }],
    });
    const r = await getEndingPeriods(new Date('2026-04-26T08:00:00Z'));
    expect(r[0]!.predictedBelowAllTiers).toBe(true);
    expect(r[0]!.predictedCommission).toBe('0.00');
    // 总收入 = 底薪 20000 + 0 提成 = 20000
    expect(r[0]!.predictedTotalIncome).toBe('20000.00');
  });

  it('getActiveCsTiers 返 null（无活动规则）→ 预测字段全 null', async () => {
    dbMock.salaryPeriod.findMany.mockResolvedValue([
      {
        id: 'p1',
        csUserId: 'u1',
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-04-30T00:00:00Z'),
        durationMonths: 4,
        totalSales: '300000',
        initialSales: '0',
        monthlyBase: '5000',
        csUser: { displayName: 'CS 张' },
      },
    ]);
    getActiveCsTiersMock.mockResolvedValue(null);
    const r = await getEndingPeriods(new Date('2026-04-26T08:00:00Z'));
    expect(r[0]!.predictedCommission).toBeNull();
    expect(r[0]!.predictedTotalIncome).toBeNull();
    expect(r[0]!.predictedBelowAllTiers).toBeNull();
  });

  it('daysUntilEnd：周期 periodEnd = today+3d → 3', async () => {
    // todayStart = UTC 2026-04-25T16:00
    dbMock.salaryPeriod.findMany.mockResolvedValue([
      {
        id: 'p1',
        csUserId: 'u1',
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-04-28T16:00:00Z'), // todayStart + 3d
        durationMonths: 4,
        totalSales: '0',
        initialSales: '0',
        monthlyBase: '5000',
        csUser: { displayName: 'CS 张' },
      },
    ]);
    getActiveCsTiersMock.mockResolvedValue(null);
    const r = await getEndingPeriods(new Date('2026-04-26T08:00:00Z'));
    expect(r[0]!.daysUntilEnd).toBe(3);
  });
});

// ─── helpers ───

function makePendingRow(
  id: string,
  orderNo: string,
  completedAt: Date,
  isUrgent: boolean,
  submitterName: string,
  customerRef: string | null = null,
) {
  return {
    id,
    orderNo,
    customerRef,
    isUrgent,
    completedAt,
    submitter: { displayName: submitterName },
  };
}
