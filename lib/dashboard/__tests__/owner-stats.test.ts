import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    order: { count: vi.fn() },
    agentMonthlyBill: { aggregate: vi.fn() },
    agentMonthlyBillReceipt: { aggregate: vi.fn() },
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import { getMonthlyBillStats, getTodayOrderStats } from '../owner-stats';

beforeEach(() => {
  dbMock.order.count.mockReset();
  dbMock.agentMonthlyBill.aggregate.mockReset();
  dbMock.agentMonthlyBillReceipt.aggregate.mockReset();
  dbMock.agentMonthlyBillReceipt.aggregate.mockResolvedValue({ _sum: { amount: null } });
});

describe('getTodayOrderStats', () => {
  it('空 DB → 全 0', async () => {
    dbMock.order.count.mockResolvedValue(0);
    const s = await getTodayOrderStats(new Date('2026-04-25T08:00:00Z'));
    expect(s.date).toBe('2026-04-25');
    expect(s.submittedToday).toBe(0);
    expect(s.urgentSubmittedToday).toBe(0);
    expect(s.completedToday).toBe(0);
    expect(s.completedYesterday).toBe(0);
    expect(s.shippedToday).toBe(0);
  });

  it('5 个 count 各自独立返回（按调用顺序：submitted / urgent / completed / yesterday / shipped）', async () => {
    dbMock.order.count
      .mockResolvedValueOnce(7) // submittedToday
      .mockResolvedValueOnce(2) // urgentSubmittedToday
      .mockResolvedValueOnce(5) // completedToday
      .mockResolvedValueOnce(3) // completedYesterday
      .mockResolvedValueOnce(4); // shippedToday
    const s = await getTodayOrderStats(new Date('2026-04-25T08:00:00Z'));
    expect(s.submittedToday).toBe(7);
    expect(s.urgentSubmittedToday).toBe(2);
    expect(s.completedToday).toBe(5);
    expect(s.completedYesterday).toBe(3);
    expect(s.shippedToday).toBe(4);
  });

  it('today range 用 Shanghai [前一日 16:00, 当日 16:00) UTC', async () => {
    dbMock.order.count.mockResolvedValue(0);
    // now = UTC 2026-04-25T08:00 → Shanghai 2026-04-25
    await getTodayOrderStats(new Date('2026-04-25T08:00:00Z'));

    // 第 1 个 call 是 submittedAt range（即 today range）
    const firstCall = dbMock.order.count.mock.calls[0][0];
    expect(firstCall.where.submittedAt.gte.toISOString()).toBe(
      '2026-04-24T16:00:00.000Z',
    );
    expect(firstCall.where.submittedAt.lt.toISOString()).toBe(
      '2026-04-25T16:00:00.000Z',
    );
  });

  it('urgentSubmittedToday 需 isUrgent: true 过滤', async () => {
    dbMock.order.count.mockResolvedValue(0);
    await getTodayOrderStats(new Date('2026-04-25T08:00:00Z'));
    const urgentCall = dbMock.order.count.mock.calls[1][0];
    expect(urgentCall.where.isUrgent).toBe(true);
  });

  it('yesterday range 比 today range 早整整 24h', async () => {
    dbMock.order.count.mockResolvedValue(0);
    await getTodayOrderStats(new Date('2026-04-25T08:00:00Z'));

    const todayCall = dbMock.order.count.mock.calls[2][0]; // completedToday
    const yesterdayCall = dbMock.order.count.mock.calls[3][0]; // completedYesterday
    const todayStart = todayCall.where.completedAt.gte as Date;
    const yesterdayStart = yesterdayCall.where.completedAt.gte as Date;
    const yesterdayEnd = yesterdayCall.where.completedAt.lt as Date;

    expect(todayStart.getTime() - yesterdayStart.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
    // yesterday end == today start (半开区间，无重叠)
    expect(yesterdayEnd.getTime()).toBe(todayStart.getTime());
  });

  it('跨日边界：UTC 15:59 (Shanghai 同日 23:59) vs UTC 16:00 (Shanghai 次日 00:00)', async () => {
    dbMock.order.count.mockResolvedValue(0);
    const before = await getTodayOrderStats(
      new Date('2026-04-25T15:59:00Z'),
    );
    expect(before.date).toBe('2026-04-25');

    dbMock.order.count.mockReset();
    dbMock.order.count.mockResolvedValue(0);
    const after = await getTodayOrderStats(new Date('2026-04-25T16:00:00Z'));
    expect(after.date).toBe('2026-04-26');
  });

  it('跨月边界（4 月 30 日 Shanghai 23:59 → 5 月 1 日）', async () => {
    dbMock.order.count.mockResolvedValue(0);
    const apr = await getTodayOrderStats(new Date('2026-04-30T15:59:00Z'));
    expect(apr.date).toBe('2026-04-30');

    dbMock.order.count.mockReset();
    dbMock.order.count.mockResolvedValue(0);
    const may = await getTodayOrderStats(new Date('2026-04-30T16:00:00Z'));
    expect(may.date).toBe('2026-05-01');
  });

  it('跨年边界', async () => {
    dbMock.order.count.mockResolvedValue(0);
    const dec = await getTodayOrderStats(new Date('2026-12-31T15:59:00Z'));
    expect(dec.date).toBe('2026-12-31');

    dbMock.order.count.mockReset();
    dbMock.order.count.mockResolvedValue(0);
    const jan = await getTodayOrderStats(new Date('2026-12-31T16:00:00Z'));
    expect(jan.date).toBe('2027-01-01');
  });
});

describe('getMonthlyBillStats', () => {
  it('空 DB → 全 "0.00"', async () => {
    dbMock.agentMonthlyBill.aggregate.mockResolvedValue({
      _sum: { totalAmount: null },
    });
    const s = await getMonthlyBillStats(new Date('2026-04-25T08:00:00Z'));
    expect(s.month).toBe('2026-04');
    expect(s.total).toBe('0.00');
    expect(s.paid).toBe('0.00');
    expect(s.outstanding).toBe('0.00');
  });

  it('数据库聚合值 + outstanding = total - paid', async () => {
    dbMock.agentMonthlyBill.aggregate.mockResolvedValue({ _sum: { totalAmount: '9500.50' } });
    dbMock.agentMonthlyBillReceipt.aggregate.mockResolvedValue({ _sum: { amount: '5000.00' } });
    const s = await getMonthlyBillStats(new Date('2026-04-25T08:00:00Z'));
    expect(s.total).toBe('9500.50');
    expect(s.paid).toBe('5000.00');
    expect(s.outstanding).toBe('4500.50');
  });

  it('Decimal 聚合值不经过 JS Number', async () => {
    dbMock.agentMonthlyBill.aggregate.mockResolvedValue({ _sum: { totalAmount: '3.00' } });
    dbMock.agentMonthlyBillReceipt.aggregate.mockResolvedValue({ _sum: { amount: '1.00' } });
    const s = await getMonthlyBillStats(new Date('2026-04-25T08:00:00Z'));
    expect(s.total).toBe('3.00');
    expect(s.paid).toBe('1.00');
    expect(s.outstanding).toBe('2.00');
  });

  it('查询 period 用 currentShanghaiMonth(now)', async () => {
    dbMock.agentMonthlyBill.aggregate.mockResolvedValue({
      _sum: { totalAmount: null },
    });
    await getMonthlyBillStats(new Date('2026-04-25T08:00:00Z'));
    const args = dbMock.agentMonthlyBill.aggregate.mock.calls[0][0];
    const where = args.where;
    expect(where.period).toBe('2026-04');
    expect(args._sum).toEqual({ totalAmount: true });
  });

  it('排除 DRAFT 账单（与 /owner/bills 的应收口径一致，Codex round 98 P1）', async () => {
    dbMock.agentMonthlyBill.aggregate.mockResolvedValue({
      _sum: { totalAmount: null },
    });
    await getMonthlyBillStats(new Date('2026-04-25T08:00:00Z'));
    const where = dbMock.agentMonthlyBill.aggregate.mock.calls[0][0].where;
    // 必须有 status 过滤，且不能含 DRAFT
    expect(where.status).toBeDefined();
    const allowed = where.status.in as string[];
    expect(allowed).toContain('CONFIRMED');
    expect(allowed).toContain('PAID');
    expect(allowed).not.toContain('DRAFT');
  });

  it('跨月边界月份 flip', async () => {
    dbMock.agentMonthlyBill.aggregate.mockResolvedValue({
      _sum: { totalAmount: null },
    });
    // Shanghai 2026-04-30 23:59 还是 4 月
    const apr = await getMonthlyBillStats(
      new Date('2026-04-30T15:59:00Z'),
    );
    expect(apr.month).toBe('2026-04');

    dbMock.agentMonthlyBill.aggregate.mockReset();
    dbMock.agentMonthlyBillReceipt.aggregate.mockReset();
    dbMock.agentMonthlyBillReceipt.aggregate.mockResolvedValue({ _sum: { amount: null } });
    dbMock.agentMonthlyBill.aggregate.mockResolvedValue({
      _sum: { totalAmount: null },
    });
    // Shanghai 2026-05-01 00:00 已是 5 月
    const may = await getMonthlyBillStats(
      new Date('2026-04-30T16:00:00Z'),
    );
    expect(may.month).toBe('2026-05');
  });

  it('paid > total（异常但允许）→ outstanding 为负', async () => {
    // 业务上不期望，但模型不约束；不要因数据脏让聚合崩。
    dbMock.agentMonthlyBill.aggregate.mockResolvedValue({ _sum: { totalAmount: '100.00' } });
    dbMock.agentMonthlyBillReceipt.aggregate.mockResolvedValue({ _sum: { amount: '150.00' } });
    const s = await getMonthlyBillStats(new Date('2026-04-25T08:00:00Z'));
    expect(s.outstanding).toBe('-50.00');
  });
});
