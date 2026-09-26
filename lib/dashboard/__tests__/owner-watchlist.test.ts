import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    // getDueOrders 现在同时跑 findMany（前 N 条）和 count（总数）
    order: { findMany: vi.fn(), count: vi.fn() },
    outsourceOrder: { findMany: vi.fn() },
    // 超计划报工看板：OrderLog where action='TASK_OVER_REPORT'
    orderLog: { findMany: vi.fn(), count: vi.fn() },
    // 超期阈值现在从 Setting 读（outsource_overdue_days）
    setting: { findUnique: vi.fn() },
  };
  return {
    dbMock: mock,
  };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  DUE_ORDERS_DEFAULT_LIMIT,
  OVER_REPORT_WINDOW_DAYS,
  getDueOrders,
  getOverdueOutsourcing,
  getPendingShipments,
  getRecentOverReports,
} from '../owner-watchlist';

beforeEach(() => {
  dbMock.order.findMany.mockReset();
  dbMock.order.count.mockReset();
  dbMock.order.count.mockResolvedValue(0);
  dbMock.outsourceOrder.findMany.mockReset();
  dbMock.orderLog.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderLog.count.mockReset().mockResolvedValue(0);
  dbMock.setting.findUnique.mockReset();
  // 默认「没有配置行」→ resolveSetting 退回内置默认 1 天，也就是这些用例
  // 原本断言的行为。需要别的阈值的用例自己覆盖。
  dbMock.setting.findUnique.mockResolvedValue(null);
});

describe('getPendingShipments', () => {
  it('空 → rows: [] / hasMore: false', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    const r = await getPendingShipments();
    expect(r.rows).toEqual([]);
    expect(r.hasMore).toBe(false);
    expect(r).toMatchObject({ total: 0, page: 1, pageSize: 10, pageCount: 1 });
  });

  it('按 completedAt 查 PACKING / legacy COMPLETED，排除未收口与暂停工单', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await getPendingShipments();
    const args = dbMock.order.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      completedAt: { not: null },
      shippedAt: null,
      status: { in: ['PACKING', 'COMPLETED'] },
    });
    expect(args.orderBy).toEqual([
      { isUrgent: 'desc' },
      { completedAt: 'asc' },
      { orderNo: 'asc' },
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

  it('row 投影：工单名称 / 外部销售 / isUrgent，不再读取客户名称/简称', async () => {
    const completedAt = new Date('2026-04-25T08:00:00Z');
    dbMock.order.findMany.mockResolvedValue([
      makePendingRow('o1', 'E2E-1', completedAt, true, '小王', '中秋礼盒'),
    ]);
    const r = await getPendingShipments();
    expect(r.rows[0]).toEqual({
      id: 'o1',
      orderNo: 'E2E-1',
      customName: '中秋礼盒',
      isUrgent: true,
      completedAt,
      promisedDate: null,
      externalSalesName: '小王',
    });
    const select = dbMock.order.findMany.mock.calls[0][0].select;
    expect(select).toMatchObject({
      customName: true,
      settlementType: true,
      submitter: { select: { displayName: true } },
      sourceOrder: { select: { submitter: { select: { displayName: true } } } },
    });
    expect(select).not.toHaveProperty('customerRef');
  });

  it('免费重做的外部销售取原单提交人，而不是发起重做的管理员', async () => {
    dbMock.order.findMany.mockResolvedValue([
      {
        ...makePendingRow('rework-1', 'E2E-R', new Date(), false, '管理员'),
        settlementType: 'NO_CHARGE',
        sourceOrder: { submitter: { displayName: '桂林' } },
      },
      {
        ...makePendingRow('free-1', 'E2E-F', new Date(), false, '管理员'),
        settlementType: 'NO_CHARGE',
        sourceOrder: null,
      },
    ]);
    const r = await getPendingShipments();
    expect(r.rows.map((row) => row.externalSalesName)).toEqual(['桂林', null]);
  });

  it('总数与列表共用状态条件，承诺交期保留数据库日历日', async () => {
    const promisedDate = new Date('2026-04-28T00:00:00Z');
    dbMock.order.findMany.mockResolvedValue([
      { ...makePendingRow('o1', 'E2E-1', new Date(), false, '小王'), promisedDate },
    ]);
    dbMock.order.count.mockResolvedValue(23);
    const result = await getPendingShipments(undefined, 5);
    expect(result.total).toBe(23);
    expect(result.rows[0].promisedDate).toEqual(promisedDate);
    expect(dbMock.order.count.mock.calls[0][0].where).toBe(
      dbMock.order.findMany.mock.calls[0][0].where,
    );
  });

  it('完整队列服务器分页，越界页回到最后一页且保留 hasMore 探针', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    dbMock.order.count.mockResolvedValue(23);
    const result = await getPendingShipments(undefined, 10, 99);
    expect(result).toMatchObject({ total: 23, page: 3, pageSize: 10, pageCount: 3 });
    expect(dbMock.order.findMany.mock.calls[0][0]).toMatchObject({ skip: 20, take: 11 });
  });

  it('总数查询失败不得降级成空队列或发起行查询', async () => {
    dbMock.order.count.mockRejectedValue(new Error('read failed'));
    await expect(getPendingShipments()).rejects.toThrow('read failed');
    expect(dbMock.order.findMany).not.toHaveBeenCalled();
  });
});

describe('getDueOrders', () => {
  // now = UTC 2026-07-07T04:00 = 上海 2026-07-07 12:00
  const NOW = new Date('2026-07-07T04:00:00Z');

  it('查询条件：未发货状态 + promisedDate < 今日+4 天上海日界 + NOT null', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await getDueOrders(NOW);
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
    // todayStart = UTC 2026-07-06T16:00；horizon = +4 天 = 07-10T16:00
    expect((args.where.promisedDate.lt as Date).toISOString()).toBe(
      '2026-07-10T16:00:00.000Z',
    );
    expect(args.where.NOT).toEqual({ promisedDate: null });
  });

  it('daysLeft：逾期为负、今天 0、3 天内为正（上海日历日口径）', async () => {
    const row = (id: string, ymd: string) => ({
      id,
      orderNo: `O-${id}`,
      customName: null,
      status: 'IN_PRODUCTION',
      isUrgent: false,
      promisedDate: new Date(`${ymd}T00:00:00Z`),
    });
    dbMock.order.findMany.mockResolvedValue([
      row('a', '2026-07-05'),
      row('b', '2026-07-07'),
      row('c', '2026-07-10'),
    ]);
    dbMock.order.count.mockResolvedValue(3);
    const r = await getDueOrders(NOW);
    expect(r.rows.map((x) => x.daysLeft)).toEqual([-2, 0, 3]);
    expect(r.total).toBe(3);
  });

  it('交期行按工单名称指认并带外部销售（免费重做取原单），不再读取客户名称/简称', async () => {
    dbMock.order.findMany.mockResolvedValue([
      {
        id: 'a',
        orderNo: 'O-a',
        customName: '中秋礼盒',
        status: 'IN_PRODUCTION',
        isUrgent: false,
        promisedDate: new Date('2026-07-07T00:00:00Z'),
        settlementType: 'EXTERNAL_SALES',
        submitter: { displayName: '桂林' },
        sourceOrder: null,
      },
      {
        id: 'b',
        orderNo: 'O-b',
        customName: null,
        status: 'IN_PRODUCTION',
        isUrgent: false,
        promisedDate: new Date('2026-07-08T00:00:00Z'),
        settlementType: 'NO_CHARGE',
        submitter: { displayName: '管理员' },
        sourceOrder: { submitter: { displayName: '桂林' } },
      },
    ]);
    const r = await getDueOrders(NOW);
    expect(r.rows.map(({ orderNo, customName, externalSalesName }) => ({ orderNo, customName, externalSalesName }))).toEqual([
      { orderNo: 'O-a', customName: '中秋礼盒', externalSalesName: '桂林' },
      { orderNo: 'O-b', customName: null, externalSalesName: '桂林' },
    ]);
    const select = dbMock.order.findMany.mock.calls[0][0].select;
    expect(select).toMatchObject({ customName: true, settlementType: true });
    expect(select).not.toHaveProperty('customerRef');
  });

  it('首屏查询有界：默认 take = DUE_ORDERS_DEFAULT_LIMIT，传 limit 时跟随', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await getDueOrders(NOW);
    expect(dbMock.order.findMany.mock.calls[0][0].take).toBe(
      DUE_ORDERS_DEFAULT_LIMIT,
    );
    expect(DUE_ORDERS_DEFAULT_LIMIT).toBe(10);

    dbMock.order.findMany.mockClear();
    await getDueOrders(NOW, 3);
    expect(dbMock.order.findMany.mock.calls[0][0].take).toBe(3);
  });

  it('count 与 findMany 用的是同一个 where（footer 的数不会和列表漂移）', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await getDueOrders(NOW);
    expect(dbMock.order.count.mock.calls[0][0].where).toEqual(
      dbMock.order.findMany.mock.calls[0][0].where,
    );
  });

  it('total 来自 count，不受 limit 截断影响', async () => {
    const row = (id: string, ymd: string) => ({
      id,
      orderNo: `O-${id}`,
      customName: null,
      status: 'IN_PRODUCTION',
      isUrgent: false,
      promisedDate: new Date(`${ymd}T00:00:00Z`),
    });
    dbMock.order.findMany.mockResolvedValue([
      row('a', '2026-07-05'),
      row('b', '2026-07-06'),
    ]);
    dbMock.order.count.mockResolvedValue(143);
    const r = await getDueOrders(NOW, 2);
    expect(r.rows).toHaveLength(2);
    expect(r.total).toBe(143);
  });

  it('promisedThroughYmd = 今日 + DUE_SOON_DAYS 的上海日历日', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    expect((await getDueOrders(NOW)).promisedThroughYmd).toBe('2026-07-10');

    // UTC 2026-07-07T16:30 = 上海 2026-07-08 00:30 → 今天是 07-08
    dbMock.order.findMany.mockResolvedValue([]);
    expect(
      (await getDueOrders(new Date('2026-07-07T16:30:00Z')))
        .promisedThroughYmd,
    ).toBe('2026-07-11');
  });

  it('orderBy 带 orderNo 兜底（截断在两次渲染之间稳定）', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await getDueOrders(NOW);
    expect(dbMock.order.findMany.mock.calls[0][0].orderBy).toEqual([
      { promisedDate: 'asc' },
      { isUrgent: 'desc' },
      { orderNo: 'asc' },
    ]);
  });

  it('完整列表分页复用交期筛选，越界页按总数收口', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    dbMock.order.count.mockResolvedValue(41);
    const result = await getDueOrders(NOW, 20, 99);
    expect(result).toMatchObject({ total: 41, page: 3, pageSize: 20, pageCount: 3 });
    expect(dbMock.order.findMany.mock.calls[0][0]).toMatchObject({ skip: 40, take: 20 });
    expect(result.promisedThroughYmd).toBe('2026-07-10');
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
    // 完整关注页会分页，同一预计交付日用 id 固定次排序。
    expect(args.orderBy).toEqual([{ expectedDate: 'asc' }, { id: 'asc' }]);
  });

  it('阈值来自 Setting：配 3 天时截止点往前挪 2 天', async () => {
    // 这条是「Setting 表只写不读」的回归门禁：之前这里写死
    // expectedDate < todayStart，seed 里那行 outsource_overdue_days
    // 改成什么都没有效果。
    dbMock.setting.findUnique.mockResolvedValue({ value: { days: 3 } });
    dbMock.outsourceOrder.findMany.mockResolvedValue([]);
    await getOverdueOutsourcing(new Date('2026-04-26T08:00:00Z'));

    const args = dbMock.outsourceOrder.findMany.mock.calls[0][0];
    // 阈值 1 天时是 2026-04-25T16:00Z；3 天则再往前两天
    expect((args.where.expectedDate.lt as Date).toISOString()).toBe(
      '2026-04-23T16:00:00.000Z',
    );
  });

  it('阈值非法时退回 1 天而不是把看板打挂', async () => {
    dbMock.setting.findUnique.mockResolvedValue({ value: { days: 0 } });
    dbMock.outsourceOrder.findMany.mockResolvedValue([]);
    await getOverdueOutsourcing(new Date('2026-04-26T08:00:00Z'));

    const args = dbMock.outsourceOrder.findMany.mock.calls[0][0];
    expect((args.where.expectedDate.lt as Date).toISOString()).toBe(
      '2026-04-25T16:00:00.000Z',
    );
  });

  it('daysOverdue 计算：3 天前预计 → 3 天超期', async () => {
    // 上海今天 2026-04-26。expectedDate 用**生产真实入库形状**：
    // createOutsourceSchema → optionalDateField → parseStrictYmd 存的是
    // 「该日历日的 UTC 零点」（lib/auth/schemas.ts:2213），不是上海零点。
    // 这里原本写 2026-04-22T16:00:00Z（上海零点表示法），是一种写入路径
    // 永远不会产生的形态，所以 daysOverdue 少算 1 天的缺陷一直测不出来。
    dbMock.outsourceOrder.findMany.mockResolvedValue([
      {
        id: 'os1',
        supplierName: '阿福外协',
        expectedDate: new Date('2026-04-23T00:00:00Z'),
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
        expectedDate: new Date('2026-04-23T00:00:00Z'),
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
  it('expected = 今天 → daysOverdue=0（边界）', async () => {
    dbMock.outsourceOrder.findMany.mockResolvedValue([
      {
        id: 'os1',
        supplierName: '阿福外协',
        // 上海今天 2026-04-26 的入库形状
        expectedDate: new Date('2026-04-26T00:00:00Z'),
        status: 'SENT',
        order: { orderNo: 'O-1' },
      },
    ]);
    const r = await getOverdueOutsourcing(new Date('2026-04-26T08:00:00Z'));
    expect(r[0]!.daysOverdue).toBe(0);
  });

  it('逾期天数按日历日算，不受上海日界与 UTC 零点的 8 小时错位影响', async () => {
    // 回归门禁：daysOverdue 曾经用 todayStart（上海日界 = UTC 零点 −8h）
    // 直接减 expectedDate（UTC 零点），Math.floor 后恒少 1 天——逾期 1 天
    // 的单在看板上显示成「超期 0 天」，OUTSOURCE_OVERDUE 推送也发 0。
    dbMock.outsourceOrder.findMany.mockResolvedValue(
      ['2026-04-25', '2026-04-24', '2026-04-23', '2026-04-22'].map((ymd, i) => ({
        id: `os${i}`,
        supplierName: '阿福外协',
        expectedDate: new Date(`${ymd}T00:00:00Z`),
        status: 'SENT',
        order: null,
      })),
    );
    const r = await getOverdueOutsourcing(new Date('2026-04-26T08:00:00Z'));
    // 上海今天 2026-04-26，所以依次是逾期 1/2/3/4 天
    expect(r.map((x) => x.daysOverdue)).toEqual([1, 2, 3, 4]);
  });
});

// ─── helpers ───

function makePendingRow(
  id: string,
  orderNo: string,
  completedAt: Date,
  isUrgent: boolean,
  submitterName: string,
  customName: string | null = null,
) {
  return {
    id,
    orderNo,
    customName,
    isUrgent,
    completedAt,
    promisedDate: null,
    settlementType: 'EXTERNAL_SALES',
    submitter: { displayName: submitterName },
    sourceOrder: null,
  };
}

describe('getRecentOverReports', () => {
  const NOW = new Date('2026-08-21T02:00:00.000Z'); // 上海 2026-08-21 10:00

  it('空 → rows: [] / total: 0，并给出窗口左界', async () => {
    const r = await getRecentOverReports(NOW);
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(0);
    // 7 天窗口含今日 → 左界是今日 - 6 天
    expect(r.sinceYmd).toBe('2026-08-15');
  });

  it("只查 action='TASK_OVER_REPORT' 且落在窗口内的日志，最新的排最前", async () => {
    await getRecentOverReports(NOW);
    const args = dbMock.orderLog.findMany.mock.calls[0][0];
    expect(args.where.action).toBe('TASK_OVER_REPORT');
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    // 窗口左界 = 上海 2026-08-15 00:00 = UTC 2026-08-14T16:00Z
    expect((args.where.createdAt.gte as Date).toISOString()).toBe(
      '2026-08-14T16:00:00.000Z',
    );
    expect(OVER_REPORT_WINDOW_DAYS).toBe(7);
  });

  it('count 与 findMany 用同一个 where —— footer 的总数不能和列表漂移', async () => {
    await getRecentOverReports(NOW);
    const listWhere = dbMock.orderLog.findMany.mock.calls[0][0].where;
    const countWhere = dbMock.orderLog.count.mock.calls[0][0].where;
    expect(countWhere).toBe(listWhere);
  });

  it('展平 order.orderNo / operator.displayName，remark 原样带出', async () => {
    dbMock.orderLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        orderId: 'order-1',
        remark: '款式 A (#1)：[超计划报工] 2026-08-21 计划 5000 / 合计 6200',
        createdAt: new Date('2026-08-21T01:00:00.000Z'),
        changedFields: null,
        order: { orderNo: 'GD-260821-001' },
        operator: { displayName: '张师傅' },
      },
    ]);
    dbMock.orderLog.count.mockResolvedValue(3);

    const r = await getRecentOverReports(NOW);
    expect(r.rows).toEqual([
      {
        id: 'log-1',
        orderId: 'order-1',
        orderNo: 'GD-260821-001',
        operatorDisplayName: '张师傅',
        quantities: null,
        remark: '款式 A (#1)：[超计划报工] 2026-08-21 计划 5000 / 合计 6200',
        createdAt: new Date('2026-08-21T01:00:00.000Z'),
      },
    ]);
    // 截断后 total 仍是窗口内的真实条数，看板据此说「共 N 条」。
    expect(r.total).toBe(3);
  });

  it('limit 只截断列表，不截断 total', async () => {
    await getRecentOverReports(NOW, 5);
    expect(dbMock.orderLog.findMany.mock.calls[0][0].take).toBe(5);
    // count 不带 take
    expect(dbMock.orderLog.count.mock.calls[0][0].take).toBeUndefined();
  });

  it('完整审计列表按实际总数分页，越界回到末页', async () => {
    dbMock.orderLog.count.mockResolvedValue(27);
    const result = await getRecentOverReports(NOW, 10, 99);
    expect(result).toMatchObject({ total: 27, page: 3, pageSize: 10, pageCount: 3 });
    expect(dbMock.orderLog.findMany.mock.calls[0][0]).toMatchObject({ skip: 20, take: 10 });
  });

  it('实际数量只来自完整 changedFields.after 审计快照，允许不良和返工为零', async () => {
    dbMock.orderLog.findMany.mockResolvedValue([
      makeOverReportLog({
        completedQty: { before: 0, after: 6200 },
        defectQty: { before: 0, after: 0 },
        reworkQty: { before: 0, after: 0 },
      }),
    ]);
    const result = await getRecentOverReports(NOW);
    expect(result.rows[0].quantities).toEqual({
      completedQty: 6200, defectQty: 0, reworkQty: 0, totalQty: 6200,
    });
    expect(dbMock.orderLog.findMany.mock.calls[0][0].select.changedFields).toBe(true);
  });

  it.each([
    null,
    '计划 5000 / 合计 6200',
    [],
    {},
    { completedQty: { after: 6200 }, defectQty: { after: 0 } },
    { completedQty: { after: '6200' }, defectQty: { after: 0 }, reworkQty: { after: 0 } },
    { completedQty: { after: -1 }, defectQty: { after: 0 }, reworkQty: { after: 0 } },
    { completedQty: { after: 1.5 }, defectQty: { after: 0 }, reworkQty: { after: 0 } },
    { completedQty: { after: Number.POSITIVE_INFINITY }, defectQty: { after: 0 }, reworkQty: { after: 0 } },
    { completedQty: { after: Number.MAX_SAFE_INTEGER + 1 }, defectQty: { after: 0 }, reworkQty: { after: 0 } },
    { completedQty: { after: Number.MAX_SAFE_INTEGER }, defectQty: { after: 1 }, reworkQty: { after: 0 } },
    { completedQty: [6200], defectQty: { after: 0 }, reworkQty: { after: 0 } },
  ])('缺失或非法审计数量返回 null，不从 remark 猜测：%j', async (changedFields) => {
    dbMock.orderLog.findMany.mockResolvedValue([makeOverReportLog(changedFields)]);
    const result = await getRecentOverReports(NOW);
    expect(result.rows[0].quantities).toBeNull();
    expect(result.rows[0].remark).toContain('计划 5000 / 合计 6200');
  });
});

function makeOverReportLog(changedFields: unknown) {
  return {
    id: 'log-1',
    orderId: 'order-1',
    remark: '款式 A (#1)：[超计划报工] 2026-08-21 计划 5000 / 合计 6200',
    changedFields,
    createdAt: new Date('2026-08-21T01:00:00.000Z'),
    order: { orderNo: 'GD-260821-001' },
    operator: { displayName: '张师傅' },
  };
}
