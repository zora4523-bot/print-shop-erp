import Decimal from 'decimal.js';
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

// 内存版聚合：按 Prisma where 的实际语义筛选夹具行，而不是直接 mock
// 聚合结果。旧测试 mock 了聚合值，掩盖了「按当月账期查、而当月账期
// 不可能有账单」的结构性空集（M-8）。只支持本模块用到的算子，遇到
// 未知算子直接抛错，避免静默放行。
type BillRow = {
  id: string;
  period: string;
  status: 'DRAFT' | 'CONFIRMED' | 'PAID';
  totalAmount: string;
  confirmedAt: Date | null;
};
type ReceiptRow = { billId: string; amount: string; receivedAt: Date };

const OPERATORS = new Set(['in', 'gte', 'lt', 'gt', 'lte', 'equals']);

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Date) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((key) => OPERATORS.has(key))
  );
}

function compare(actual: unknown, expected: unknown): number {
  const a = actual instanceof Date ? actual.getTime() : actual;
  const b = expected instanceof Date ? expected.getTime() : expected;
  if (a === null || a === undefined) return Number.NaN;
  return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
}

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const actual = row[key];
    if (isOperatorObject(condition)) {
      return Object.entries(condition).every(([op, expected]) => {
        if (op === 'in') return (expected as unknown[]).includes(actual);
        if (op === 'equals') return actual === expected;
        const order = compare(actual, expected);
        if (Number.isNaN(order)) return false;
        if (op === 'gte') return order >= 0;
        if (op === 'gt') return order > 0;
        if (op === 'lte') return order <= 0;
        return order < 0; // lt
      });
    }
    if (typeof condition === 'object' && condition !== null && !(condition instanceof Date)) {
      if (typeof actual !== 'object' || actual === null) {
        throw new Error(`unsupported where key in fake aggregate: ${key}`);
      }
      return matchesWhere(actual as Record<string, unknown>, condition as Record<string, unknown>);
    }
    if (!(key in row)) throw new Error(`unknown field in fake aggregate: ${key}`);
    return actual === condition;
  });
}

function sumField(rows: Record<string, unknown>[], field: string): string | null {
  if (rows.length === 0) return null;
  return rows
    .reduce((acc, row) => acc.plus(String(row[field])), new Decimal(0))
    .toFixed(2);
}

function useLedger(bills: BillRow[], receipts: ReceiptRow[]) {
  const byId = new Map(bills.map((bill) => [bill.id, bill]));
  dbMock.agentMonthlyBill.aggregate.mockImplementation(
    async (args: { where: Record<string, unknown>; _sum: Record<string, true> }) => {
      const matched = bills.filter((bill) => matchesWhere(bill, args.where));
      expect(args._sum).toEqual({ totalAmount: true });
      return { _sum: { totalAmount: sumField(matched, 'totalAmount') } };
    },
  );
  dbMock.agentMonthlyBillReceipt.aggregate.mockImplementation(
    async (args: { where: Record<string, unknown>; _sum: Record<string, true> }) => {
      const matched = receipts
        .map((receipt) => ({ ...receipt, bill: byId.get(receipt.billId) }))
        .filter((receipt) => matchesWhere(receipt, args.where));
      expect(args._sum).toEqual({ amount: true });
      return { _sum: { amount: sumField(matched, 'amount') } };
    },
  );
}

describe('getMonthlyBillStats', () => {
  // now = 上海 2026-04-25 16:00。v2 只能为已结束月份出账，所以本月看到的
  // 账单账期都是 3 月及更早。
  const NOW = new Date('2026-04-25T08:00:00Z');

  it('空 DB → 全 "0.00"', async () => {
    useLedger([], []);
    const s = await getMonthlyBillStats(NOW);
    expect(s.month).toBe('2026-04');
    expect(s.total).toBe('0.00');
    expect(s.paid).toBe('0.00');
    expect(s.outstanding).toBe('0.00');
  });

  it('本月已出账按确认时间落在上海本月统计，而不是账期等于本月（M-8）', async () => {
    useLedger(
      [
        // 上月账期、本月确认、待收
        { id: 'a', period: '2026-03', status: 'CONFIRMED', totalAmount: '1000.00', confirmedAt: new Date('2026-04-01T02:00:00Z') },
        // 上月账期、本月确认、本月已收
        { id: 'b', period: '2026-03', status: 'PAID', totalAmount: '2500.50', confirmedAt: new Date('2026-04-03T02:00:00Z') },
        // 上海 4 月 1 日 00:00 确认：属于本月
        { id: 'g', period: '2026-03', status: 'CONFIRMED', totalAmount: '50.00', confirmedAt: new Date('2026-03-31T16:00:00Z') },
        // 上月确认、本月才收款
        { id: 'c', period: '2026-02', status: 'PAID', totalAmount: '800.00', confirmedAt: new Date('2026-03-05T02:00:00Z') },
        // 上月确认、至今未收
        { id: 'd', period: '2026-02', status: 'CONFIRMED', totalAmount: '300.00', confirmedAt: new Date('2026-03-10T02:00:00Z') },
        // 上海 3 月 31 日 23:59 确认并收款：都不属于本月
        { id: 'e', period: '2026-01', status: 'PAID', totalAmount: '400.00', confirmedAt: new Date('2026-03-31T15:59:00Z') },
        // 草稿：既不算出账也不算待收
        { id: 'f', period: '2026-03', status: 'DRAFT', totalAmount: '999.00', confirmedAt: null },
      ],
      [
        { billId: 'b', amount: '2500.50', receivedAt: new Date('2026-04-10T02:00:00Z') },
        { billId: 'c', amount: '800.00', receivedAt: new Date('2026-04-02T02:00:00Z') },
        { billId: 'e', amount: '400.00', receivedAt: new Date('2026-03-31T15:59:00Z') },
      ],
    );

    const s = await getMonthlyBillStats(NOW);

    expect(s.month).toBe('2026-04');
    // a + b + g：确认时间在上海 4 月内
    expect(s.total).toBe('3550.50');
    // b + c：收款时间在上海 4 月内，不论账单何时确认
    expect(s.paid).toBe('3300.50');
    // a + g + d：当前所有已确认未收的账单，不限账期
    expect(s.outstanding).toBe('1350.00');
  });

  it('只有上月确认、上月已收的账单时，本月出账与已收为 0，待收也为 0', async () => {
    useLedger(
      [{ id: 'e', period: '2026-02', status: 'PAID', totalAmount: '400.00', confirmedAt: new Date('2026-03-02T02:00:00Z') }],
      [{ billId: 'e', amount: '400.00', receivedAt: new Date('2026-03-20T02:00:00Z') }],
    );
    const s = await getMonthlyBillStats(NOW);
    expect(s.total).toBe('0.00');
    expect(s.paid).toBe('0.00');
    expect(s.outstanding).toBe('0.00');
  });

  it('Decimal 聚合值不经过 JS Number', async () => {
    useLedger(
      [
        { id: 'x', period: '2026-03', status: 'CONFIRMED', totalAmount: '0.10', confirmedAt: new Date('2026-04-02T02:00:00Z') },
        { id: 'y', period: '2026-03', status: 'CONFIRMED', totalAmount: '0.20', confirmedAt: new Date('2026-04-02T03:00:00Z') },
        { id: 'z', period: '2026-03', status: 'CONFIRMED', totalAmount: '9999999999.99', confirmedAt: new Date('2026-04-02T04:00:00Z') },
      ],
      [],
    );
    const s = await getMonthlyBillStats(NOW);
    expect(s.total).toBe('10000000000.29');
    expect(s.outstanding).toBe('10000000000.29');
  });

  it('跨月边界：上海 5 月 1 日 00:00 起按 5 月窗口统计', async () => {
    const bills: BillRow[] = [
      { id: 'apr', period: '2026-03', status: 'CONFIRMED', totalAmount: '10.00', confirmedAt: new Date('2026-04-30T15:59:00Z') },
      { id: 'may', period: '2026-04', status: 'CONFIRMED', totalAmount: '20.00', confirmedAt: new Date('2026-04-30T16:00:00Z') },
    ];
    useLedger(bills, []);
    const apr = await getMonthlyBillStats(new Date('2026-04-30T15:59:30Z'));
    expect(apr.month).toBe('2026-04');
    expect(apr.total).toBe('10.00');

    const may = await getMonthlyBillStats(new Date('2026-04-30T16:00:30Z'));
    expect(may.month).toBe('2026-05');
    expect(may.total).toBe('20.00');
    // 待收不按月份切：两张都仍是已确认未收
    expect(may.outstanding).toBe('30.00');
  });
});
