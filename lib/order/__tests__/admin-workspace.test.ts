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
  resolveAdminPrintFacts,
  resolveAdminWorkspaceResultWhere,
} from '../admin-workspace';
import { parseAdminOrderWorkspaceQuery } from '../admin-workspace-query';
import { OrderChangeRequestError } from '../change-request';
import { MISSING_ORDER_CUSTOMER_FILTER_VALUE } from '../list-query';

const actor = { id: 'admin-1', role: Role.ADMIN };

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
        { status: OrderStatus.ON_HOLD },
      ],
    });
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
    }
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

    dbMock.order.count.mockResolvedValueOnce(0);
    for (let index = 0; index < 13; index += 1) {
      dbMock.order.count.mockResolvedValueOnce(index);
    }
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
    dbMock.order.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
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

    const page = await loadAdminOrderWorkspace(actor, query);
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
    expect(dbMock.order.count.mock.calls[13]?.[0]).toEqual({
      where: {
        AND: [expect.any(Object), adminManualPricingWhere()],
      },
    });
    expect(dbMock.order.count.mock.calls[14]?.[0]).toEqual({
      where: {
        AND: [
          expect.any(Object),
          adminIncompleteCustomerFeeWhere(),
          { NOT: adminManualPricingWhere() },
        ],
      },
    });
    expect(dbMock.order.count.mock.calls[15]?.[0]).toEqual({
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
      statusSummary: null,
      fee: { amount: null, source: 'INCOMPLETE' },
      feeStages: { quoted: '12.34', active: 'INCOMPLETE' },
      capabilities: { confirm: false },
    });
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

  it('disables confirmation when the current-price preview fails', async () => {
    const row = adminOrderRecord();
    dbMock.order.findFirst.mockResolvedValue(row);
    dbMock.order.findUnique.mockResolvedValue({
      revision: row.revision,
      workOrderVersion: row.workOrderVersion,
      priceRevision: row.priceRevision,
      updatedAt: row.updatedAt,
    });
    previewMock.mockRejectedValueOnce(
      new OrderChangeRequestError('当前价不可用'),
    );

    const detail = await getAdminOrderByOrderNo(actor, row.orderNo);

    expect(detail).toMatchObject({
      orderNo: row.orderNo,
      priceComparison: null,
      priceComparisonError: '当前价不可用',
      capabilities: { confirm: false, reject: true },
    });
    expect(dbMock.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    expect(progressMock).toHaveBeenCalledWith([row.id], dbMock);
  });

  it('retries the whole detail snapshot when the price preview crosses a version change', async () => {
    const first = adminOrderRecord();
    const second = adminOrderRecord({
      revision: 2,
      priceRevision: 2,
      updatedAt: new Date('2026-09-02T08:01:00.000Z'),
    });
    dbMock.order.findFirst
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    dbMock.order.findUnique
      .mockResolvedValueOnce({
        revision: second.revision,
        workOrderVersion: second.workOrderVersion,
        priceRevision: second.priceRevision,
        updatedAt: second.updatedAt,
      })
      .mockResolvedValueOnce({
        revision: second.revision,
        workOrderVersion: second.workOrderVersion,
        priceRevision: second.priceRevision,
        updatedAt: second.updatedAt,
      });

    const detail = await getAdminOrderByOrderNo(actor, first.orderNo);

    expect(detail?.revision).toBe(2);
    expect(previewMock).toHaveBeenCalledTimes(2);
    expect(dbMock.$transaction).toHaveBeenCalledTimes(2);
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
