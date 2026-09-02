import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { order: { findMany: vi.fn() } },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  ORDER_OVERDUE_NOTIFY_CAP,
  scanOverdueOrders,
} from '../overdue-scan';

// now = UTC 2026-07-07T04:00 = 上海 2026-07-07 12:00
const NOW = new Date('2026-07-07T04:00:00Z');

// promisedDate 存日历日的 UTC 零点（parseStrictYmd 口径）
const row = (id: string, ymd: string) => ({
  id,
  orderNo: `O-${id}`,
  customerRef: null,
  status: 'IN_PRODUCTION',
  promisedDate: new Date(`${ymd}T00:00:00Z`),
});

beforeEach(() => {
  dbMock.order.findMany.mockReset();
  dbMock.order.findMany.mockResolvedValue([]);
});

describe('scanOverdueOrders', () => {
  it('逾期条件在 SQL 层：未发货状态 + promisedDate < 今日上海日界 + NOT null', async () => {
    await scanOverdueOrders(NOW);
    const args = dbMock.order.findMany.mock.calls[0][0];
    expect(args.where.status).toEqual({
      in: [
        'DRAFT',
        'PENDING_FACTORY',
        'REJECTED',
        'CONFIRMED',
        'ON_HOLD',
        'RELEASED',
        'FOILING',
        'PACKING',
        'SUBMITTED',
        'SCHEDULING',
        'IN_PRODUCTION',
        'COMPLETED',
      ],
    });
    // 今日（上海 07-07）的日界 = UTC 07-06T16:00 —— 今天到期（due-soon）
    // 的行在 SQL 层就进不来，不需要再在 JS 里 filter。
    expect((args.where.promisedDate.lt as Date).toISOString()).toBe(
      '2026-07-06T16:00:00.000Z',
    );
    expect(args.where.NOT).toEqual({ promisedDate: null });
  });

  it('take = cap + 1（截断探针）；显式传 cap 时跟随', async () => {
    await scanOverdueOrders(NOW);
    expect(dbMock.order.findMany.mock.calls[0][0].take).toBe(
      ORDER_OVERDUE_NOTIFY_CAP + 1,
    );

    dbMock.order.findMany.mockClear();
    await scanOverdueOrders(NOW, 5);
    expect(dbMock.order.findMany.mock.calls[0][0].take).toBe(6);
  });

  it('cap + 1 行 → truncated=true，探针那条不进 rows（不会被推送）', async () => {
    const cap = 3;
    dbMock.order.findMany.mockResolvedValue(
      Array.from({ length: cap + 1 }, (_, i) => row(`o${i}`, '2026-07-05')),
    );
    const r = await scanOverdueOrders(NOW, cap);
    expect(r.rows).toHaveLength(cap);
    expect(r.truncated).toBe(true);
    expect(r.rows.map((x) => x.id)).toEqual(['o0', 'o1', 'o2']);
  });

  it('恰好 cap 行 → truncated=false', async () => {
    const cap = 3;
    dbMock.order.findMany.mockResolvedValue(
      Array.from({ length: cap }, (_, i) => row(`o${i}`, '2026-07-05')),
    );
    const r = await scanOverdueOrders(NOW, cap);
    expect(r.rows).toHaveLength(cap);
    expect(r.truncated).toBe(false);
  });

  it('daysOverdue 是正整数，与 promisedDaysLeft 取反一致', async () => {
    dbMock.order.findMany.mockResolvedValue([
      row('a', '2026-07-05'),
      row('b', '2026-07-06'),
    ]);
    const r = await scanOverdueOrders(NOW);
    expect(r.rows.map((x) => x.daysOverdue)).toEqual([2, 1]);
    // -0 会让模板显示成「逾期 0 天」；SQL 边界排除了今天到期的行，
    // 这里锁死取反不会漏出 -0。
    expect(Object.is(r.rows[1].daysOverdue, 1)).toBe(true);
  });

  it('orderBy 逾期最久在前，orderNo 兜底保证截断稳定', async () => {
    await scanOverdueOrders(NOW);
    expect(dbMock.order.findMany.mock.calls[0][0].orderBy).toEqual([
      { promisedDate: 'asc' },
      { isUrgent: 'desc' },
      { orderNo: 'asc' },
    ]);
  });

  it('select 只取推送模板用得到的字段，不把整行工单搬进内存', async () => {
    await scanOverdueOrders(NOW);
    expect(dbMock.order.findMany.mock.calls[0][0].select).toEqual({
      id: true,
      orderNo: true,
      customerRef: true,
      status: true,
      promisedDate: true,
    });
  });
});
