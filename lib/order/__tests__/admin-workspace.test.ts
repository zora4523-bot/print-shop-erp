vi.mock('@/lib/order/production-readiness', () => ({ inspectOrderProductionReadinessInTx: vi.fn().mockResolvedValue(null) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderChangeRequestStatus,
  OrderCustomerChargeStatus,
  OrderItemQuoteDisposition,
  OrderPricingStatus,
  OrderPrintJobState,
  OrderQuotedFeeCompleteness,
  OrderStatus,
  Prisma,
  ProductionOperationStatus,
  Role,
} from '@/generated/prisma/client';

const { dbMock, previewMock, progressMock } = vi.hoisted(() => {
  const database = {
    order: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      aggregate: vi.fn(),
    },
    orderItem: { aggregate: vi.fn() },
    craft: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return {
    dbMock: database,
    previewMock: vi.fn(),
    progressMock: vi.fn().mockResolvedValue(new Map()),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/oss/read-url', () => ({
  signDesignReadUrl: (url: string) => `signed:${url}`,
}));
vi.mock('@/lib/production/work-order-progress-query', () => ({
  getWorkOrderProgressByOrderIds: progressMock,
}));
vi.mock('@/lib/order/change-request', () => {
  class TestOrderChangeRequestError extends Error {}
  return {
    OrderChangeRequestError: TestOrderChangeRequestError,
    previewFactoryConfirmationPriceDiff: previewMock,
  };
});

import {
  adminIncompleteCustomerFeeWhere,
  adminManualPricingWhere,
  adminQueueWhere,
  adminSignalWhere,
  buildAdminWorkspaceResultWhere,
  getAdminOrderByOrderNo,
  loadAdminOrderWorkspace,
  resolveAdminOrderCapabilities,
  resolveAdminOrderShipDisabledReason,
  summarizeAdminOrderChange,
  resolveAdminPrintFacts,
  resolveAdminWorkspaceResultWhere,
} from '../admin-workspace';
import {
  ADMIN_ORDER_QUEUES,
  ADMIN_ORDER_SIGNALS,
  parseAdminOrderWorkspaceQuery,
} from '../admin-workspace-query';
import { OrderChangeRequestError } from '../change-request';
import { MISSING_ORDER_CUSTOMER_FILTER_VALUE } from '../list-query';

const actor = { id: 'admin-1', role: Role.ADMIN };

describe('admin change-request summary', () => {
  const items = [{ id: 'item-1', sequence: 2, quantity: 1000, name: '原款式', specification: '中号封' }];

  it('summarizes validated quantity and specification changes without leaking internal fields', () => {
    expect(summarizeAdminOrderChange({ items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 2000, targetProductId: 'product-secret-1' }] }, items))
      .toBe('第 2 款数量 1,000 → 2,000；第 2 款调整规格');
  });

  it('limits long requests and reports additions without depending on current quantities', () => {
    const summary = summarizeAdminOrderChange({ items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 2000, specification: '大号封', name: '新款式' }, { operation: 'ADD', templateItemId: 'item-1', name: '新增款式', quantity: 500 }] }, items);
    expect(summary).toBe('第 2 款数量 1,000 → 2,000；第 2 款调整规格；另 2 项变更');
    expect(summarizeAdminOrderChange({ items: [{ operation: 'ADD', templateItemId: 'item-1', name: '新增款式', quantity: 500 }] }, items)).toBe('新增款式 500 个');
  });

  it('falls back to the request reason for malformed, unknown, or unchanged facts', () => {
    for (const patch of [null, { items: 'unsafe' }, { items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: -1 }] }, { items: [{ operation: 'UPDATE', itemId: 'missing-item', quantity: 2000 }] }, { items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 1000 }] }]) {
      expect(summarizeAdminOrderChange(patch, items)).toBeNull();
    }
  });
});

function adminOrderRecord(overrides: Record<string, unknown> = {}) {
  const updatedAt = new Date('2026-09-02T08:00:00.000Z');
  return {
    id: 'order-1',
    orderNo: 'GD-260902-001',
    revision: 1,
    workOrderVersion: 1,
    priceRevision: 1,
    updatedAt,
    customName: null,
    customerRef: null,
    status: OrderStatus.SUBMITTED,
    isUrgent: false,
    totalAmount: new Prisma.Decimal('100.00'),
    quotedFee: null,
    confirmedFee: null,
    settledFee: null,
    quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
    createdAt: new Date('2026-09-02T07:00:00.000Z'),
    submittedAt: new Date('2026-09-02T07:30:00.000Z'),
    scheduledAt: null,
    promisedDate: null,
    pricingStatus: OrderPricingStatus.LEGACY_CONFIRMED,
    trackingNo: null,
    submitter: { id: 'sales-1', displayName: '销售甲' },
    customerParty: null,
    _count: { shipments: 1 },
    stars: [],
    items: [
      {
        id: 'item-1',
        sequence: 1,
        fig: 1,
        name: '款式 A',
        quantity: 100,
        specification: null,
        paperType: null,
        paperWeightGsm: null,
        crafts: [],
        quoteDisposition: OrderItemQuoteDisposition.PRICED,
        tasks: [],
        designs: [],
      },
    ],
    customerCharges: [],
    changeRequests: [],
    printJobs: [],
    agentMonthlyBillItem: null,
    shipments: [],
    workflowDecisions: [],
    productionOperations: [],
    productionProgressSteps: [],
    outsourceOrders: [],
    logs: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.$transaction.mockImplementation(
    async (callback: (tx: typeof dbMock) => unknown) => callback(dbMock),
  );
  dbMock.order.findMany.mockResolvedValue([]);
  dbMock.order.count.mockReset().mockResolvedValue(0);
  dbMock.order.findFirst.mockResolvedValue(null);
  dbMock.order.findUnique.mockResolvedValue(null);
  dbMock.$queryRaw.mockResolvedValue([]);
  dbMock.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
  dbMock.order.aggregate.mockResolvedValue({
    _sum: { settledFee: null, confirmedFee: null, quotedFee: null },
  });
  dbMock.craft.findMany.mockResolvedValue([]);
  previewMock.mockReset().mockResolvedValue({
    quoted: { amount: '100.00', versions: { processing: null, logistics: null } },
    current: { amount: '100.00', versions: { processing: null, logistics: null } },
    quoteToken: `create-order-quote-v2:${'a'.repeat(64)}`,
    hasVersionDiff: false,
  });
});

describe('admin order workspace predicates', () => {
  it('separates actionable manual pricing from all-status incomplete-fee facts', () => {
    const incomplete = {
      confirmedFee: null,
      settledFee: null,
      OR: [
        {
          quotedFeeCompleteness:
            OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
        },
        {
          items: {
            some: {
              quoteDisposition:
                OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED,
            },
          },
        },
        {
          customerCharges: {
            some: { status: OrderCustomerChargeStatus.PENDING_AMOUNT },
          },
        },
      ],
    };

    expect(adminIncompleteCustomerFeeWhere()).toEqual(incomplete);
    expect(adminManualPricingWhere()).toEqual({
      status: { in: [OrderStatus.PENDING_FACTORY, OrderStatus.SUBMITTED] },
      ...incomplete,
    });
  });

  it('uses the same canonical + legacy awaiting-confirmation set for dashboard queues', () => {
    const pendingStatuses = {
      in: [OrderStatus.PENDING_FACTORY, OrderStatus.SUBMITTED],
    };
    expect(adminSignalWhere('pending-confirmation')).toEqual({
      status: pendingStatuses,
    });
    expect(adminQueueWhere('todo')).toMatchObject({
      OR: [
        { status: pendingStatuses },
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        { status: OrderStatus.ON_HOLD },
      ],
    });
  });

  it('limits pending release to confirmed work with no unresolved change and includes it in todo', async () => {
    const pendingRelease = {
      status: OrderStatus.CONFIRMED,
      NOT: {
        changeRequests: {
          some: { status: OrderChangeRequestStatus.PENDING },
        },
      },
    };
    expect(adminSignalWhere('pending-release')).toEqual(pendingRelease);
    expect(adminQueueWhere('todo')).toMatchObject({
      OR: expect.arrayContaining([pendingRelease]),
    });

    const query = parseAdminOrderWorkspaceQuery({
      signal: 'pending-release',
      customerPartyId: 'party-1',
      starred: 'yes',
    }).query;
    const now = new Date('2026-09-07T00:00:00.000Z');
    const where = buildAdminWorkspaceResultWhere(actor, query, now);
    expect(where).toMatchObject({
      AND: [
        {
          AND: [
            expect.any(Object),
            { stars: { some: { userId: actor.id } } },
            {},
          ],
        },
        adminQueueWhere('todo'),
        pendingRelease,
      ],
    });
    expect(JSON.stringify(where)).toContain('party-1');
    // Exports must retain the same status, change-request and user filters.
    await expect(resolveAdminWorkspaceResultWhere(actor, query, now)).resolves.toEqual(
      where,
    );
  });

  it('keeps REJECTED out of done and resolves the print queue with a correlated snapshot', () => {
    expect(adminQueueWhere('done')).toEqual({
      status: {
        in: [OrderStatus.SETTLED, OrderStatus.CANCELLED, OrderStatus.FINISHED],
      },
    });
    expect(adminQueueWhere('print')).toEqual({
      status: {
        in: [OrderStatus.RELEASED, OrderStatus.FOILING, OrderStatus.PACKING],
      },
    });
  });

  it('treats missing or old-version print proof as pending and only current PRINTED as complete', () => {
    const base = {
      status: OrderStatus.RELEASED,
      workOrderVersion: 2,
    };
    expect(resolveAdminPrintFacts({ ...base, requests: [] })).toEqual({
      printPending: true,
      pendingPrintJobId: null,
      canCreatePrint: true,
      canMarkPrinted: false,
    });
    expect(
      resolveAdminPrintFacts({
        ...base,
        requests: [
          {
            id: 'v1',
            workOrderVersion: 1,
            resolution: { state: OrderPrintJobState.PRINTED },
          },
        ],
      }),
    ).toMatchObject({ printPending: true, pendingPrintJobId: null });
    expect(
      resolveAdminPrintFacts({
        ...base,
        requests: [{ id: 'v2', workOrderVersion: 2, resolution: null }],
      }),
    ).toEqual({
      printPending: true,
      pendingPrintJobId: 'v2',
      canCreatePrint: false,
      canMarkPrinted: true,
    });
    expect(
      resolveAdminPrintFacts({
        ...base,
        requests: [
          {
            id: 'v2-initial',
            workOrderVersion: 2,
            resolution: { state: OrderPrintJobState.PRINTED },
          },
          {
            id: 'v2-reprint',
            workOrderVersion: 2,
            resolution: null,
          },
        ],
      }),
    ).toEqual({
      printPending: true,
      pendingPrintJobId: 'v2-reprint',
      canCreatePrint: false,
      canMarkPrinted: true,
    });
    expect(
      resolveAdminPrintFacts({
        ...base,
        requests: [
          {
            id: 'v2',
            workOrderVersion: 2,
            resolution: { state: OrderPrintJobState.PRINTED },
          },
        ],
      }),
    ).toEqual({
      printPending: false,
      pendingPrintJobId: null,
      canCreatePrint: true,
      canMarkPrinted: false,
    });
  });

  it('keeps pending changes out of the production queue', () => {
    expect(adminQueueWhere('production')).toEqual(
      expect.objectContaining({
        NOT: {
          changeRequests: {
            some: { status: OrderChangeRequestStatus.PENDING },
          },
        },
      }),
    );
  });

  it('matches ship and settlement capabilities to their server prerequisites', () => {
    const base = {
      hasPendingChange: false,
      manualPricing: false,
      confirmationPreflightOk: true,
      confirmedFeePresent: false,
      pricingPending: false,
      hasShipment: true,
      hasLiveOutsource: false,
      hasIncompleteProduction: false,
      printFacts: {
        printPending: false,
        pendingPrintJobId: null,
        canCreatePrint: false,
        canMarkPrinted: false,
      },
    };

    expect(
      resolveAdminOrderCapabilities({
        ...base,
        status: OrderStatus.COMPLETED,
      }).ship,
    ).toBe(true);
    expect(
      resolveAdminOrderCapabilities({
        ...base,
        status: OrderStatus.PACKING,
      }).ship,
    ).toBe(true);
    for (const blocked of [
      { pricingPending: true },
      { hasShipment: false },
      { hasLiveOutsource: true },
      { hasIncompleteProduction: true },
      { hasPendingChange: true },
    ]) {
      expect(
        resolveAdminOrderCapabilities({
          ...base,
          ...blocked,
          status: OrderStatus.COMPLETED,
        }).ship,
      ).toBe(false);
      expect(resolveAdminOrderShipDisabledReason({ ...base, ...blocked, status: OrderStatus.COMPLETED })).toBeTruthy();
    }
    expect(resolveAdminOrderShipDisabledReason({ ...base, status: OrderStatus.PACKING })).toBeNull();
    expect(resolveAdminOrderShipDisabledReason({ ...base, status: OrderStatus.CONFIRMED })).toBe('当前工单状态不支持发货');
    expect(
      resolveAdminOrderCapabilities({
        ...base,
        status: OrderStatus.SHIPPED,
      }).settle,
    ).toBe(false);
    expect(
      resolveAdminOrderCapabilities({
        ...base,
        status: OrderStatus.SHIPPED,
        confirmedFeePresent: true,
      }).settle,
    ).toBe(true);
  });

  it('closes confirm capability when the current-price preview failed', () => {
    const capabilities = resolveAdminOrderCapabilities({
      status: OrderStatus.SUBMITTED,
      hasPendingChange: false,
      manualPricing: false,
      confirmationPreflightOk: true,
      currentPricePreviewFailed: true,
      confirmedFeePresent: false,
      pricingPending: false,
      hasShipment: true,
      hasLiveOutsource: false,
      hasIncompleteProduction: false,
      printFacts: {
        printPending: false,
        pendingPrintJobId: null,
        canCreatePrint: false,
        canMarkPrinted: false,
      },
    });

    expect(capabilities.confirm).toBe(false);
    expect(capabilities.reject).toBe(true);
  });

  it('keeps shipping disabled for an incomplete progress step when legacy tasks are the fallback', async () => {
    const row = adminOrderRecord({
      status: OrderStatus.COMPLETED,
      confirmedFee: new Prisma.Decimal('100.00'),
      productionOperations: [],
      productionProgressSteps: [
        {
          workOrderVersion: 1,
          status: ProductionOperationStatus.IN_PROGRESS,
        },
      ],
    });
    dbMock.order.findFirst.mockResolvedValue(row);

    const detail = await getAdminOrderByOrderNo(actor, row.orderNo);

    expect(detail?.capabilities.ship).toBe(false);
    expect(detail?.shipDisabledReason).toBe('生产工序尚未完成，请先核对报工');
  });

  it.each([
    OrderStatus.PENDING_FACTORY,
    OrderStatus.REJECTED,
    OrderStatus.CONFIRMED,
    OrderStatus.FOILING,
    OrderStatus.ON_HOLD,
    OrderStatus.SHIPPED,
    OrderStatus.SETTLED,
    OrderStatus.FINISHED,
    OrderStatus.CANCELLED,
  ])('does not describe %s as waiting for shipment', async (status) => {
    const row = adminOrderRecord({ status });
    dbMock.order.findFirst.mockResolvedValue(row);
    dbMock.order.findUnique.mockResolvedValue({
      revision: row.revision,
      workOrderVersion: row.workOrderVersion,
      priceRevision: row.priceRevision,
      updatedAt: row.updatedAt,
    });

    const detail = await getAdminOrderByOrderNo(actor, 'GD-260902-001');

    expect(detail?.capabilities.ship).toBe(false);
    expect(detail?.shipDisabledReason).toBeNull();
  });

  it('keeps missing-delivery guidance actionable in packing', async () => {
    dbMock.order.findFirst.mockResolvedValue(adminOrderRecord({ status: OrderStatus.PACKING, _count: { shipments: 0 } }));

    const detail = await getAdminOrderByOrderNo(actor, 'GD-260902-001');

    expect(detail?.capabilities.ship).toBe(false);
    expect(detail?.shipDisabledReason).toBe('尚未填写配送信息，请先补齐配送');
  });

  it('resolves print-export membership from unresolved current-version requests', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([{ id: 'order-current-print' }]);
    const query = parseAdminOrderWorkspaceQuery({ queue: 'print' }).query;

    const where = await resolveAdminWorkspaceResultWhere(
      actor,
      query,
      new Date('2026-09-02T00:00:00.000Z'),
    );

    expect(where).toEqual({
      AND: [
        expect.any(Object),
        { id: { in: ['order-current-print'] } },
        {},
      ],
    });
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = (dbMock.$queryRaw.mock.calls[0]?.[0] as TemplateStringsArray)
      .join('?');
    expect(sql).toContain('EXISTS');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('resolution."requestJobId" = request."id"');
    expect(sql).toContain('resolution."state" = \'PRINTED\'');
    expect(sql).toContain('request."workOrderVersion" = orders."workOrderVersion"');
  });

  it('uses Shanghai calendar boundaries for overdue and today signals', () => {
    const now = new Date('2026-09-02T16:30:00.000Z');
    expect(adminSignalWhere('overdue', now)).toEqual(
      expect.objectContaining({
        promisedDate: { lt: new Date('2026-09-02T16:00:00.000Z') },
      }),
    );
    expect(adminSignalWhere('due-today', now)).toEqual(
      expect.objectContaining({
        promisedDate: {
          gte: new Date('2026-09-02T16:00:00.000Z'),
          lt: new Date('2026-09-03T16:00:00.000Z'),
        },
      }),
    );
  });

  it('combines star, queue and signal without changing the strict order', async () => {
    const query = parseAdminOrderWorkspaceQuery({
      queue: 'production',
      signal: 'overdue',
      starred: 'yes',
    }).query;
    expect(buildAdminWorkspaceResultWhere(actor, query)).toEqual(
      expect.objectContaining({ AND: expect.any(Array) }),
    );

    await loadAdminOrderWorkspace(actor, query);
    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      }),
    );
    expect(progressMock).toHaveBeenCalledWith([], dbMock);
  });

  it('aggregates the whole filtered set and excludes manual pending quotes', async () => {
    const query = parseAdminOrderWorkspaceQuery({ queue: 'all' }).query;
    const now = new Date('2026-09-07T00:00:00.000Z');
    const queueCounts = {
      todo: 3, print: 1, production: 2, shipped: 1, done: 2, all: 9,
    };
    const signalCounts = {
      'pending-confirmation': 2,
      'pending-pricing': 1,
      'pending-release': 4,
      'pending-change': 3,
      'on-hold': 5,
      overdue: 6,
      'due-today': 7,
    };
    dbMock.order.count.mockResolvedValueOnce(5);
    for (const queue of ADMIN_ORDER_QUEUES) {
      dbMock.order.count.mockResolvedValueOnce(queueCounts[queue]);
    }
    for (const signal of ADMIN_ORDER_SIGNALS) {
      dbMock.order.count.mockResolvedValueOnce(signalCounts[signal]);
    }
    dbMock.order.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4);
    dbMock.orderItem.aggregate.mockResolvedValue({
      _sum: { quantity: 12345 },
    });
    dbMock.order.aggregate
      .mockResolvedValueOnce({ _sum: { settledFee: '10.00' } })
      .mockResolvedValueOnce({ _sum: { confirmedFee: '20.25' } })
      .mockResolvedValueOnce({ _sum: { quotedFee: '3.75' } });

    const page = await loadAdminOrderWorkspace(actor, query, now);
    expect(page.counts).toEqual({ queues: queueCounts, signals: signalCounts });
    const signalCountStart = 1 + ADMIN_ORDER_QUEUES.length;
    for (const [index, signal] of ADMIN_ORDER_SIGNALS.entries()) {
      expect(dbMock.order.count.mock.calls[signalCountStart + index]?.[0]).toEqual({
        where: { AND: [expect.any(Object), adminSignalWhere(signal, now)] },
      });
    }
    expect(page.summary).toEqual({
      orderCount: 5,
      totalQuantity: 12345,
      effectiveFee: '34.00',
      manualPricingCount: 2,
      incompleteFeeExcludedCount: 3,
      legacyFeeExcludedCount: 4,
    });
    expect(dbMock.orderItem.aggregate).toHaveBeenCalledWith({
      where: { order: expect.any(Object) },
      _sum: { quantity: true },
    });
    expect(dbMock.order.aggregate).toHaveBeenCalledTimes(3);
    const summaryCountStart = signalCountStart + ADMIN_ORDER_SIGNALS.length;
    expect(dbMock.order.count.mock.calls[summaryCountStart]?.[0]).toEqual({
      where: {
        AND: [expect.any(Object), adminManualPricingWhere()],
      },
    });
    expect(dbMock.order.count.mock.calls[summaryCountStart + 1]?.[0]).toEqual({
      where: {
        AND: [
          expect.any(Object),
          adminIncompleteCustomerFeeWhere(),
          { NOT: adminManualPricingWhere() },
        ],
      },
    });
    expect(dbMock.order.count.mock.calls[summaryCountStart + 2]?.[0]).toEqual({
      where: {
        AND: [
          expect.any(Object),
          {
            settledFee: null,
            confirmedFee: null,
            quotedFee: null,
            totalAmount: { not: 0 },
          },
          { NOT: adminIncompleteCustomerFeeWhere() },
        ],
      },
    });
    expect(dbMock.order.aggregate.mock.calls[2]?.[0]).toEqual({
      where: {
        AND: [
          expect.any(Object),
          {
            settledFee: null,
            confirmedFee: null,
            quotedFee: { not: null },
          },
          { NOT: adminIncompleteCustomerFeeWhere() },
        ],
      },
      _sum: { quotedFee: true },
    });
  });

  it('does not present a rejected incomplete quote as actionable manual pricing', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      adminOrderRecord({
        status: OrderStatus.REJECTED,
        quotedFee: new Prisma.Decimal('12.34'),
        quotedFeeCompleteness:
          OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
      }),
    );

    const detail = await getAdminOrderByOrderNo(actor, 'GD-260902-001');

    expect(detail).toMatchObject({
      status: OrderStatus.REJECTED,
      statusSummary: '等待销售补正后重新提交',
      fee: { amount: null, source: 'INCOMPLETE' },
      feeStages: { quoted: '12.34', active: 'INCOMPLETE' },
      capabilities: { confirm: false },
    });
  });

  it('aggregates canonical craft types independently of display dictionary names', async () => {
    const record = adminOrderRecord();
    const crafts = ['PRINT', 'PARTIAL', 'FULL', 'PARTIAL', null];
    dbMock.order.findFirst.mockResolvedValue({ ...record, items: crafts.map((craft, index) => ({ ...record.items[0], id: `item-${index}`, craft })) });
    const detail = await getAdminOrderByOrderNo(actor, record.orderNo);
    expect(detail?.craftTags).toEqual(['局部烫金', '专版烫金', '彩印']);
    expect(detail?.craftSummary).toBe('工艺待补');
    expect(dbMock.order.findFirst.mock.calls[0][0].select.items.select.craft).toBe(true);
  });

  it('shows the immutable rejection reason and future Shanghai calendar days', async () => {
    dbMock.order.findFirst.mockResolvedValue(adminOrderRecord({
      status: OrderStatus.REJECTED,
      promisedDate: new Date('2026-09-10T00:00:00.000Z'),
      workflowDecisions: [{ toStatus: OrderStatus.REJECTED, reasonCode: 'DESIGN_ERROR', reasonNote: '第二款需重传设计图' }],
    }));
    const detail = await getAdminOrderByOrderNo(actor, 'GD-260902-001', new Date('2026-09-01T16:00:00.000Z'));
    expect(detail?.statusSummary).toBe('驳回：设计图有误 · 第二款需重传设计图');
    expect(detail?.promisedDaysLeft).toBe(8);
  });

  it('does not use an unrelated workflow reason or keep countdowns on shipped orders', async () => {
    dbMock.order.findFirst.mockResolvedValue(adminOrderRecord({
      status: OrderStatus.REJECTED,
      workflowDecisions: [{ toStatus: OrderStatus.ON_HOLD, reasonCode: 'PAPER_OUT', reasonNote: '以前的暂停原因' }],
    }));
    expect((await getAdminOrderByOrderNo(actor, 'GD-260902-001'))?.statusSummary).toBe('等待销售补正后重新提交');
    dbMock.order.findFirst.mockResolvedValue(adminOrderRecord({ status: OrderStatus.SHIPPED, promisedDate: new Date('2026-09-10T00:00:00.000Z') }));
    expect((await getAdminOrderByOrderNo(actor, 'GD-260902-001'))?.promisedDaysLeft).toBeNull();
  });

  it('keeps an actionable incomplete quote aligned with the pending-pricing signal', async () => {
    const row = adminOrderRecord({
      quotedFee: new Prisma.Decimal('12.34'),
      quotedFeeCompleteness:
        OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
    });
    dbMock.order.findFirst.mockResolvedValue(row);
    dbMock.order.findUnique.mockResolvedValue({
      revision: row.revision,
      workOrderVersion: row.workOrderVersion,
      priceRevision: row.priceRevision,
      updatedAt: row.updatedAt,
    });

    const detail = await getAdminOrderByOrderNo(actor, row.orderNo);

    expect(detail).toMatchObject({
      status: OrderStatus.SUBMITTED,
      statusSummary: '系统无法完整定价，待人工核价',
      fee: { amount: null, source: 'PENDING' },
      capabilities: { confirm: false },
    });
  });

  it('reads the saved price even when the current catalog cannot be quoted', async () => {
    const row = adminOrderRecord();
    dbMock.order.findFirst.mockResolvedValue(row);
    previewMock.mockRejectedValue(new OrderChangeRequestError('当前价不可用'));
    const detail = await getAdminOrderByOrderNo(actor, row.orderNo);
    expect(detail).toMatchObject({ orderNo: row.orderNo, priceComparison: null, priceComparisonError: null });
    expect(previewMock).not.toHaveBeenCalled();
    expect(dbMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    expect(progressMock).toHaveBeenCalledWith([row.id], dbMock);
  });

  it('returns one coherent read snapshot without a second pricing transaction', async () => {
    const row = adminOrderRecord({ revision: 2, priceRevision: 2 });
    dbMock.order.findFirst.mockResolvedValue(row);
    const detail = await getAdminOrderByOrderNo(actor, row.orderNo);
    expect(detail?.revision).toBe(2);
    expect(previewMock).not.toHaveBeenCalled();
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not confuse a real customer named like the empty-state label with the missing sentinel', async () => {
    const realNamedCustomer = adminOrderRecord({
      status: OrderStatus.DRAFT,
      customerParty: {
        id: 'party-1',
        name: '未填客户',
        shortName: null,
      },
    });
    const missingCustomer = adminOrderRecord({
      id: 'order-2',
      orderNo: 'GD-260902-002',
      status: OrderStatus.DRAFT,
    });
    const emptySnapshotCustomer = adminOrderRecord({
      id: 'order-3',
      orderNo: 'GD-260902-003',
      status: OrderStatus.DRAFT,
      customerRef: '',
    });
    dbMock.order.findFirst
      .mockResolvedValueOnce(realNamedCustomer)
      .mockResolvedValueOnce(missingCustomer)
      .mockResolvedValueOnce(emptySnapshotCustomer);

    const real = await getAdminOrderByOrderNo(
      actor,
      realNamedCustomer.orderNo,
    );
    const missing = await getAdminOrderByOrderNo(
      actor,
      missingCustomer.orderNo,
    );
    const emptySnapshot = await getAdminOrderByOrderNo(
      actor,
      emptySnapshotCustomer.orderNo,
    );

    expect(real?.customer).toEqual({
      id: 'party-1',
      name: '未填客户',
      filterValue: '未填客户',
    });
    expect(missing?.customer).toEqual({
      id: null,
      name: '未填客户',
      filterValue: MISSING_ORDER_CUSTOMER_FILTER_VALUE,
    });
    expect(emptySnapshot?.customer).toEqual({
      id: null,
      name: '未填客户',
      filterValue: MISSING_ORDER_CUSTOMER_FILTER_VALUE,
    });
  });
});
