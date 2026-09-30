import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderChangeRequestStatus,
  OrderCustomerChargeStatus,
  OrderPricingStatus,
  OrderStatus,
  Role,
} from '../../../generated/prisma/client';

const { dbMock, signDesignReadUrlMock } = vi.hoisted(() => ({
  dbMock: {
    order: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      groupBy: vi.fn(),
    },
    orderChangeRequest: { findMany: vi.fn() },
    craft: { findMany: vi.fn() },
  },
  signDesignReadUrlMock: vi.fn((url: string, _env?: unknown, options?: { thumbnail?: boolean }) =>
    options?.thumbnail ? `thumb:${url}` : `signed:${url}`),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/oss/read-url', () => ({
  signDesignReadUrl: signDesignReadUrlMock,
}));

import { parseOrderListQuery } from '../list-query';
import {
  buildSalesOrderWhere,
  getSalesLatestRejectedOrderIds,
  getSalesOrderByOrderNo,
  getSalesOrderListSummary,
  listSalesOrdersPage,
  sanitizeSalesOrderListQuery,
} from '../sales-list-query';

const actor = { id: 'sales-1', role: Role.SALES };

beforeEach(() => {
  dbMock.order.count.mockReset().mockResolvedValue(0);
  dbMock.order.findMany.mockReset().mockResolvedValue([]);
  dbMock.order.findFirst.mockReset().mockResolvedValue(null);
  dbMock.order.groupBy.mockReset().mockResolvedValue([]);
  dbMock.orderChangeRequest.findMany.mockReset().mockResolvedValue([]);
  dbMock.craft.findMany.mockReset().mockResolvedValue([]);
  signDesignReadUrlMock.mockClear();
});

describe('sales list query boundary', () => {
  it('returns the owned bill link but never exposes a mismatched account relation', async () => {
    const bill = { id: 'bill-a', period: '2026-08', status: 'CONFIRMED', agentUserId: actor.id };
    dbMock.order.findFirst.mockResolvedValue(orderRecord({ submitterId: actor.id, agentMonthlyBillItem: { bill } }));
    expect((await getSalesOrderByOrderNo(actor, 'GD-260827-001'))?.bill).toEqual({ id: 'bill-a', period: '2026-08', status: 'CONFIRMED' });
    dbMock.order.findFirst.mockResolvedValue(orderRecord({ submitterId: actor.id, agentMonthlyBillItem: { bill: { ...bill, agentUserId: 'other' } } }));
    expect((await getSalesOrderByOrderNo(actor, 'GD-260827-001'))?.bill).toBeNull();
  });
  it('已结算工单纳入销售完结队列，仍限制为本人提交', () => {
    const query = sanitizeSalesOrderListQuery(parseOrderListQuery({ view: 'done' }).query);
    expect(buildSalesOrderWhere(actor, query, [])).toEqual({ AND: [
      { submitterId: actor.id }, { status: { in: [OrderStatus.SETTLED, OrderStatus.FINISHED] } },
    ] });
  });

  it('已发货包含已结算，其他生命周期分类与汇总一致', async () => {
    const statuses = Object.values(OrderStatus);
    dbMock.order.groupBy.mockResolvedValue(statuses.map((status) => ({ status, _count: { _all: 1 } })));
    const summary = await getSalesOrderListSummary(actor);
    expect(summary.all).toBe(statuses.length);
    const classified: OrderStatus[] = [];
    for (const view of ['doing', 'shipped', 'done', 'cancelled', 'draft'] as const) {
      const query = sanitizeSalesOrderListQuery(parseOrderListQuery({ view }).query);
      expect(query.view).toBe(view);
      const where = buildSalesOrderWhere(actor, query) as { AND: [{ submitterId: string }, { status: OrderStatus | { in: OrderStatus[] } }] };
      expect(where.AND[0]).toEqual({ submitterId: actor.id });
      const predicate = where.AND[1].status;
      const matched = typeof predicate === 'string' ? [predicate] : predicate.in;
      if (view !== 'done') classified.push(...matched);
      expect(summary[view]).toBe(matched.length);
      if (view === 'done') expect(matched).toEqual([OrderStatus.SETTLED, OrderStatus.FINISHED]);
      if (view === 'cancelled') expect(matched).toEqual([OrderStatus.CANCELLED]);
    }
    expect(classified.sort()).toEqual(statuses.sort());
  });

  it.each(['MODIFY', 'CANCEL'] as const)('保留待审核 %s 申请类型，单纯等待审核不算需关注', async (type) => {
    dbMock.order.findFirst.mockResolvedValue(orderRecord({
      pricingStatus: OrderPricingStatus.AUTO_CONFIRMED,
      changeRequests: [{ id: 'pending', type, status: OrderChangeRequestStatus.PENDING, reason: '测试申请', createdAt: new Date('2026-09-12T00:00:00Z') }],
    }));
    const order = await getSalesOrderByOrderNo(actor, 'GD-260827-001');
    expect(order?.pendingChangeRequest?.type).toBe(type);
    expect(order?.needsAction).toBe(false);
    expect(dbMock.order.findFirst.mock.calls[0][0].select.changeRequests.select.type).toBe(true);
  });

  it('keeps only sales search, pagination and supported business views', () => {
    const requested = parseOrderListQuery({
      q: '福明',
      view: 'todo',
      amountMin: '100',
      workerId: 'worker-1',
      status: 'IN_PRODUCTION',
      sort: 'totalAmount',
      dir: 'asc',
      page: '3',
    }).query;
    const safe = sanitizeSalesOrderListQuery(requested);

    expect(safe.filters.q).toBe('福明');
    expect(safe.filters.amountMin).toBeUndefined();
    expect(safe.filters.workerId).toBeUndefined();
    expect(safe.filters.statuses).toEqual([]);
    expect(safe.view).toBe('todo');
    expect(safe.page).toBe(3);
    expect(safe.sort).toBe('createdAt');
    expect(safe.dir).toBe('desc');
  });

  it('builds todo and production views inside the sales ownership scope', () => {
    const todo = sanitizeSalesOrderListQuery(
      parseOrderListQuery({ view: 'todo' }).query,
    );
    expect(buildSalesOrderWhere(actor, todo, ['order-rejected'])).toEqual({
      AND: [
        { submitterId: 'sales-1' },
        {
          status: {
            in: [OrderStatus.PENDING_FACTORY, OrderStatus.REJECTED, OrderStatus.CONFIRMED, OrderStatus.ON_HOLD, OrderStatus.RELEASED, OrderStatus.FOILING, OrderStatus.PACKING, OrderStatus.SUBMITTED, OrderStatus.SCHEDULING, OrderStatus.IN_PRODUCTION, OrderStatus.COMPLETED],
          },
          OR: [
            { status: { in: [OrderStatus.REJECTED, OrderStatus.ON_HOLD] } },
            {
              pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
            },
            { id: { in: ['order-rejected'] } },
          ],
        },
      ],
    });

    const doing = sanitizeSalesOrderListQuery(
      parseOrderListQuery({ view: 'doing' }).query,
    );
    expect(buildSalesOrderWhere(actor, doing)).toEqual({
      AND: [
        { submitterId: 'sales-1' },
        {
          status: {
            in: [OrderStatus.PENDING_FACTORY, OrderStatus.REJECTED, OrderStatus.CONFIRMED, OrderStatus.ON_HOLD, OrderStatus.RELEASED, OrderStatus.FOILING, OrderStatus.PACKING, OrderStatus.SUBMITTED, OrderStatus.SCHEDULING, OrderStatus.IN_PRODUCTION, OrderStatus.COMPLETED],
          },
        },
      ],
    });
  });

  it('puts attention rows ahead of normal rows before pagination and returns a sales-safe DTO', async () => {
    dbMock.order.count.mockResolvedValueOnce(1);
    dbMock.order.findMany
      .mockResolvedValueOnce([
        orderRecord({
          id: 'attention',
          orderNo: 'GD-ATTENTION',
          pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
          changeRequests: [
            {
              id: 'change-1',
              type: 'MODIFY',
              status: OrderChangeRequestStatus.REJECTED,
              reason: '客户改数量',
              reviewRemark: '已进入生产，不能删款',
              reviewedAt: new Date('2026-08-27T07:30:00Z'),
              createdAt: new Date('2026-08-27T07:00:00Z'),
            },
          ],
        }),
      ])
      .mockResolvedValueOnce([
        orderRecord({
          id: 'normal',
          orderNo: 'GD-NORMAL',
          pricingStatus: OrderPricingStatus.AUTO_CONFIRMED,
        }),
      ]);
    dbMock.craft.findMany.mockResolvedValue([
      { id: 'craft-foil', name: '局部烫金' },
    ]);
    const query = sanitizeSalesOrderListQuery(parseOrderListQuery({}).query);

    const result = await listSalesOrdersPage(
      actor,
      query,
      Promise.resolve({
        total: 2,
        page: 1,
        pageSize: 20,
        pageCount: 1,
        skip: 0,
        take: 20,
        latestRejectedOrderIds: ['attention'],
      }),
    );

    expect(result.rows.map((row) => row.id)).toEqual(['attention', 'normal']);
    expect(result.rows[0]).toMatchObject({
      orderNo: 'GD-ATTENTION',
      itemCount: 1,
      totalQuantity: 2000,
      craftSummary: '局部烫金 · 触感纸',
      needsAction: true,
      // 列表小图走 160px 缩略图；放大预览用原图（Codex 2026-09-29：预览不能是缩略图）。
      thumbnail: {
        url: 'thumb:https://files.example.test/design.png',
        previewUrl: 'signed:https://files.example.test/design.png',
        fileName: '设计图.png',
      },
      shipment: {
        carrier: '中通',
        trackingNo: '75312884629891',
        additionalCount: 0,
      },
    });
    expect(result.rows[0]!.feeLines).toEqual([
      {
        id: 'processing',
        label: '款式加工费',
        amount: '90.00',
        estimated: true,
      },
      {
        id: 'packaging',
        label: '入袋加工费',
        amount: '10.00',
        estimated: true,
      },
      {
        id: 'charge-shipping',
        label: '快递费',
        amount: '41.30',
        estimated: true,
      },
      {
        id: 'charge-plate',
        label: '制烫金版费',
        amount: null,
        estimated: false,
      },
    ]);

    const select = dbMock.order.findMany.mock.calls[0]![0].select;
    const serializedSelect = JSON.stringify(select);
    for (const forbidden of [
      'tasks',
      'worker',
      'logs',
      'costEntries',
      'outsourceOrders',
      'customerRef',
      'customerParty',
      'customerPartyId',
    ]) {
      expect(serializedSelect).not.toContain(`"${forbidden}"`);
    }
  });

  it('searches only order number, name and pinyin, never the retired customer', () => {
    const parsed = parseOrderListQuery({
      q: '张三商贸',
      customerRef: '张三商贸',
      customerPartyId: 'party-1',
      customerRefExact: '__MISSING_CUSTOMER__',
    });
    const query = sanitizeSalesOrderListQuery(parsed.query);
    const contains = { contains: '张三商贸', mode: 'insensitive' };

    expect(parsed.issues).toEqual([]);
    expect(query).toEqual(
      sanitizeSalesOrderListQuery(parseOrderListQuery({ q: '张三商贸' }).query),
    );
    expect(buildSalesOrderWhere(actor, query)).toEqual({
      AND: [
        { submitterId: actor.id },
        {
          OR: [
            { orderNo: contains },
            { customName: contains },
            { searchPinyin: contains },
            { searchPinyinInitials: contains },
          ],
        },
      ],
    });
  });

  it('only treats the newest change-request result as a current rejection', async () => {
    dbMock.orderChangeRequest.findMany.mockResolvedValue([
      { orderId: 'retry-pending', status: OrderChangeRequestStatus.PENDING },
      { orderId: 'retry-pending', status: OrderChangeRequestStatus.REJECTED },
      { orderId: 'still-rejected', status: OrderChangeRequestStatus.DENIED },
      { orderId: 'later-approved', status: OrderChangeRequestStatus.APPROVED },
      { orderId: 'later-approved', status: OrderChangeRequestStatus.REJECTED },
    ]);

    await expect(getSalesLatestRejectedOrderIds(actor)).resolves.toEqual([
      'still-rejected',
    ]);
    expect(dbMock.orderChangeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          order: {
            is: {
              AND: [
                { submitterId: 'sales-1' },
                {
                  status: {
                    in: [OrderStatus.PENDING_FACTORY, OrderStatus.REJECTED, OrderStatus.CONFIRMED, OrderStatus.ON_HOLD, OrderStatus.RELEASED, OrderStatus.FOILING, OrderStatus.PACKING, OrderStatus.SUBMITTED, OrderStatus.SCHEDULING, OrderStatus.IN_PRODUCTION, OrderStatus.COMPLETED],
                  },
                },
              ],
            },
          },
        },
      }),
    );
  });

  it('loads an off-page hash target through the same owner-scoped safe DTO', async () => {
    dbMock.order.findFirst.mockResolvedValue(orderRecord());
    dbMock.craft.findMany.mockResolvedValue([
      { id: 'craft-foil', name: '局部烫金' },
    ]);

    const result = await getSalesOrderByOrderNo(actor, ' GD-260827-001 ');

    expect(result).toMatchObject({
      orderNo: 'GD-260827-001',
      craftSummary: '局部烫金 · 触感纸',
    });
    expect(result).not.toHaveProperty('manualPricing');
    // The drawer API returns this DTO verbatim; the retired customer never leaves the server.
    expect(result).not.toHaveProperty('customerRef');
    expect(JSON.stringify(result)).not.toContain('张三商贸');
    expect(dbMock.order.findFirst.mock.calls[0]![0].select).not.toHaveProperty('customerRef');
    expect(dbMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { submitterId: 'sales-1' },
            { orderNo: 'GD-260827-001' },
          ],
        },
      }),
    );
  });

  it('summarizes sales views and the current Shanghai shipping month', async () => {
    dbMock.order.groupBy.mockResolvedValue([
      { status: OrderStatus.DRAFT, _count: { _all: 2 } },
      { status: OrderStatus.SUBMITTED, _count: { _all: 3 } },
      { status: OrderStatus.IN_PRODUCTION, _count: { _all: 4 } },
      { status: OrderStatus.SHIPPED, _count: { _all: 5 } },
      { status: OrderStatus.FINISHED, _count: { _all: 6 } },
      { status: OrderStatus.CANCELLED, _count: { _all: 1 } },
    ]);
    dbMock.order.count.mockImplementation(
      (args: { where?: { AND?: Array<Record<string, unknown>> } }) =>
        args.where?.AND?.some((condition) => 'shippedAt' in condition)
          ? Promise.resolve(7)
          : Promise.resolve(2),
    );

    await expect(
      getSalesOrderListSummary(actor, new Date('2026-08-27T08:00:00Z')),
    ).resolves.toEqual({
      all: 21,
      todo: 2,
      doing: 7,
      shipped: 11,
      done: 6,
      cancelled: 1,
      draft: 2,
      shippedThisMonth: 7,
    });
    const shippedCall = dbMock.order.count.mock.calls.find(([args]) =>
      args.where?.AND?.some(
        (condition: Record<string, unknown>) => 'shippedAt' in condition,
      ),
    );
    expect(shippedCall?.[0]).toMatchObject({
      where: {
        AND: [
          { submitterId: 'sales-1' },
          {
            shippedAt: {
              gte: new Date('2026-07-31T16:00:00.000Z'),
              lt: new Date('2026-08-31T16:00:00.000Z'),
            },
          },
        ],
      },
    });
  });
});

function orderRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'order-1',
    orderNo: 'GD-260827-001',
    customName: '端午定制',
    customerRef: '张三商贸',
    status: OrderStatus.SUBMITTED,
    isUrgent: false,
    revision: 2,
    pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
    processingAmount: '100.00',
    packagingAmount: '10.00',
    totalAmount: '141.30',
    promisedDate: new Date('2026-08-30T00:00:00Z'),
    updatedAt: new Date('2026-08-27T08:00:00Z'),
    receiverName: 'Lam',
    receiverPhone: '021-53395199',
    receiverAddress: '上海市黄浦区测试路 88 号',
    items: [
      {
        id: 'item-1',
        sequence: 1,
        name: '端午定制 图1',
        quantity: 2000,
        specification: '大号封 90×165',
        paperType: '触感纸',
        paperWeightGsm: 200,
        crafts: ['craft-foil'],
        designs: [
          {
            fileUrl: 'https://files.example.test/design.png',
            fileName: '设计图.png',
          },
        ],
      },
    ],
    shipments: [
      {
        trackingNo: '75312884629891',
        carrierCode: 'ZTO',
        expressCode: null,
      },
    ],
    customerCharges: [
      {
        id: 'charge-shipping',
        description: '快递费',
        amount: '41.30',
        status: OrderCustomerChargeStatus.ESTIMATED,
      },
      {
        id: 'charge-plate',
        description: '制烫金版费',
        amount: null,
        status: OrderCustomerChargeStatus.PENDING_AMOUNT,
      },
    ],
    changeRequests: [],
    ...overrides,
  };
}
