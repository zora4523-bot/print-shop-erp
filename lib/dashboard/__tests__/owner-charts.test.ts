import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    order: { groupBy: vi.fn() },
    user: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  getCategoryDistribution,
  getProductionTrend,
  getSalesRanking,
} from '../owner-charts';

beforeEach(() => {
  dbMock.order.groupBy.mockReset();
  dbMock.user.findMany.mockReset();
  dbMock.$queryRaw.mockReset();
});

describe('getProductionTrend', () => {
  it('空 raw query → 30 个连续日 + count 全 0', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);
    const r = await getProductionTrend(new Date('2026-04-25T08:00:00Z'));
    expect(r).toHaveLength(30);
    expect(r.every((p) => p.count === 0)).toBe(true);
    // 末日 = today (Shanghai 2026-04-25)
    expect(r[r.length - 1]!.day).toBe('2026-04-25');
    // 首日 = today - 29d
    expect(r[0]!.day).toBe('2026-03-27');
    // 日期连续递增
    for (let i = 1; i < r.length; i++) {
      const prev = new Date(r[i - 1]!.day);
      const curr = new Date(r[i]!.day);
      expect(curr.getTime() - prev.getTime()).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('部分日期有数据 → 中间空白日补 0', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      { day: '2026-04-20', count: BigInt(3) },
      { day: '2026-04-23', count: BigInt(5) },
      { day: '2026-04-25', count: BigInt(1) },
    ]);
    const r = await getProductionTrend(new Date('2026-04-25T08:00:00Z'));
    expect(r).toHaveLength(30);
    const byDay = new Map(r.map((p) => [p.day, p.count]));
    expect(byDay.get('2026-04-20')).toBe(3);
    expect(byDay.get('2026-04-21')).toBe(0); // 中间空白
    expect(byDay.get('2026-04-22')).toBe(0);
    expect(byDay.get('2026-04-23')).toBe(5);
    expect(byDay.get('2026-04-24')).toBe(0);
    expect(byDay.get('2026-04-25')).toBe(1);
  });

  it('raw query 用 status IN [COMPLETED, SHIPPED, FINISHED]', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);
    await getProductionTrend(new Date('2026-04-25T08:00:00Z'));
    // Tagged template — prisma.$queryRaw`...` 即 strings + values
    // 数组。把 strings join 起来检查 SQL fragment。
    const call = dbMock.$queryRaw.mock.calls[0];
    const strings = call[0] as TemplateStringsArray;
    const sql = Array.from(strings).join(' ');
    expect(sql).toContain('AT TIME ZONE');
    expect(sql).toContain("'Asia/Shanghai'");
    expect(sql).toContain("status IN ('COMPLETED', 'SHIPPED', 'FINISHED')");
  });

  it('raw query 走两层 AT TIME ZONE（UTC → Shanghai）防 PG 时区陷阱（round 100 high）', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);
    await getProductionTrend(new Date('2026-04-25T08:00:00Z'));
    const call = dbMock.$queryRaw.mock.calls[0];
    const strings = call[0] as TemplateStringsArray;
    const sql = Array.from(strings).join(' ');
    // 必须先 UTC 后 Shanghai —— 单层 'Asia/Shanghai' 会被 PG 当成
    // "naked timestamp 已经在 Shanghai" 处理，方向反。
    expect(sql).toContain("AT TIME ZONE 'UTC'");
    expect(sql).toContain("AT TIME ZONE 'Asia/Shanghai'");
    expect(sql.indexOf("'UTC'")).toBeLessThan(sql.indexOf("'Asia/Shanghai'"));
  });

  it('count: bigint → number 转换', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      { day: '2026-04-25', count: BigInt(42) },
    ]);
    const r = await getProductionTrend(new Date('2026-04-25T08:00:00Z'));
    const today = r.find((p) => p.day === '2026-04-25');
    expect(today?.count).toBe(42);
    expect(typeof today?.count).toBe('number');
  });
});

describe('getSalesRanking', () => {
  it('空 → []', async () => {
    dbMock.order.groupBy.mockResolvedValue([]);
    const r = await getSalesRanking(new Date('2026-04-25T08:00:00Z'));
    expect(r).toEqual([]);
    // 没 user 要查
    expect(dbMock.user.findMany).not.toHaveBeenCalled();
  });

  it('groupBy where 包含本月范围 + status≠CANCELLED + processingAmount>0', async () => {
    dbMock.order.groupBy.mockResolvedValue([]);
    await getSalesRanking(new Date('2026-04-25T08:00:00Z'));
    const args = dbMock.order.groupBy.mock.calls[0][0];
    expect(args.where.status).toEqual({ not: 'CANCELLED' });
    expect(args.where.processingAmount).toEqual({ gt: 0 });
    expect(args.where).not.toHaveProperty('totalAmount');
    // 本月窗口
    expect((args.where.submittedAt.gte as Date).toISOString()).toBe(
      '2026-03-31T16:00:00.000Z',
    );
    expect((args.where.submittedAt.lt as Date).toISOString()).toBe(
      '2026-04-30T16:00:00.000Z',
    );
    expect(args.take).toBe(10);
  });

  it('排序按 _sum.processingAmount desc，快递与包材不抬高销售业绩', async () => {
    dbMock.order.groupBy.mockResolvedValue([]);
    await getSalesRanking(new Date('2026-04-25T08:00:00Z'));
    const args = dbMock.order.groupBy.mock.calls[0][0];
    expect(args._sum).toEqual({ processingAmount: true });
    expect(args.orderBy).toEqual({ _sum: { processingAmount: 'desc' } });
  });

  it('Top 排序保持 + role / displayName 拼回', async () => {
    dbMock.order.groupBy.mockResolvedValue([
      {
        submitterId: 'u-sales',
        _sum: { processingAmount: '5000.00' },
        _count: { _all: 3 },
      },
      {
        submitterId: 'u-cs',
        _sum: { processingAmount: '3000.00' },
        _count: { _all: 2 },
      },
    ]);
    dbMock.user.findMany.mockResolvedValue([
      { id: 'u-sales', displayName: '张销售', role: 'SALES' },
      { id: 'u-cs', displayName: '李客服', role: 'CUSTOMER_SERVICE' },
    ]);
    const r = await getSalesRanking(new Date('2026-04-25T08:00:00Z'));
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({
      userId: 'u-sales',
      displayName: '张销售',
      role: 'SALES',
      totalAmount: '5000.00',
      orderCount: 3,
    });
    expect(r[1]!.role).toBe('CUSTOMER_SERVICE');
  });

  it('user 查不到 → 该行被过滤', async () => {
    dbMock.order.groupBy.mockResolvedValue([
      {
        submitterId: 'u-ghost',
        _sum: { processingAmount: '100.00' },
        _count: { _all: 1 },
      },
      {
        submitterId: 'u-sales',
        _sum: { processingAmount: '5000.00' },
        _count: { _all: 3 },
      },
    ]);
    dbMock.user.findMany.mockResolvedValue([
      { id: 'u-sales', displayName: '张销售', role: 'SALES' },
    ]);
    const r = await getSalesRanking(new Date('2026-04-25T08:00:00Z'));
    expect(r).toHaveLength(1);
    expect(r[0]!.userId).toBe('u-sales');
  });

  it('_sum.processingAmount = null 安全兜底（极端 NULL 行）→ 不上榜', async () => {
    dbMock.order.groupBy.mockResolvedValue([
      {
        submitterId: 'u-edge',
        _sum: { processingAmount: null },
        _count: { _all: 0 },
      },
    ]);
    dbMock.user.findMany.mockResolvedValue([
      { id: 'u-edge', displayName: 'Ghost', role: 'SALES' },
    ]);
    const r = await getSalesRanking(new Date('2026-04-25T08:00:00Z'));
    expect(r).toEqual([]);
  });

  it('跨年 12 月 → 下月窗口 = 次年 1 月', async () => {
    dbMock.order.groupBy.mockResolvedValue([]);
    await getSalesRanking(new Date('2026-12-15T08:00:00Z'));
    const args = dbMock.order.groupBy.mock.calls[0][0];
    expect((args.where.submittedAt.gte as Date).toISOString()).toBe(
      '2026-11-30T16:00:00.000Z', // 12-01 Shanghai
    );
    expect((args.where.submittedAt.lt as Date).toISOString()).toBe(
      '2026-12-31T16:00:00.000Z', // 2027-01-01 Shanghai
    );
  });
});

describe('getCategoryDistribution', () => {
  it('空 → []', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);
    const r = await getCategoryDistribution(new Date('2026-04-25T08:00:00Z'));
    expect(r).toEqual([]);
  });

  it('分桶数据按 order_count desc 透传', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      { category: 'BLANK_STOCK', order_count: BigInt(5) },
      { category: 'CUSTOM_FLAT_FOIL', order_count: BigInt(3) },
      { category: 'UNCATEGORIZED', order_count: BigInt(1) },
    ]);
    const r = await getCategoryDistribution(new Date('2026-04-25T08:00:00Z'));
    expect(r).toEqual([
      { category: 'BLANK_STOCK', orderCount: 5 },
      { category: 'CUSTOM_FLAT_FOIL', orderCount: 3 },
      { category: 'UNCATEGORIZED', orderCount: 1 },
    ]);
  });

  it('SQL 含 COALESCE → UNCATEGORIZED + count distinct orderId + 当月窗口', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);
    await getCategoryDistribution(new Date('2026-04-25T08:00:00Z'));
    const call = dbMock.$queryRaw.mock.calls[0];
    const strings = call[0] as TemplateStringsArray;
    const sql = Array.from(strings).join(' ');
    expect(sql).toContain("COALESCE(p.category::text, 'UNCATEGORIZED')");
    expect(sql).toContain('count(distinct oi."orderId")');
    expect(sql).toContain("o.status != 'CANCELLED'");
    // 月窗口 = monthStart + monthEnd 两个 Date 参数；values[0]/values[1]
    const values = call.slice(1) as Date[];
    expect(values[0]?.toISOString()).toBe('2026-03-31T16:00:00.000Z');
    expect(values[1]?.toISOString()).toBe('2026-04-30T16:00:00.000Z');
  });

  it('ORDER BY count DESC + category ASC（同 count 按 category 字典序，防 pie 抖动）', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);
    await getCategoryDistribution(new Date('2026-04-25T08:00:00Z'));
    const call = dbMock.$queryRaw.mock.calls[0];
    const strings = call[0] as TemplateStringsArray;
    const sql = Array.from(strings).join(' ');
    expect(sql).toContain('ORDER BY order_count DESC, category ASC');
  });

  it('count: bigint → number 转换（递归 sanity check）', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      { category: 'COLOR_PRINT', order_count: BigInt(99) },
    ]);
    const r = await getCategoryDistribution(new Date('2026-04-25T08:00:00Z'));
    expect(r[0]!.orderCount).toBe(99);
    expect(typeof r[0]!.orderCount).toBe('number');
  });
});
