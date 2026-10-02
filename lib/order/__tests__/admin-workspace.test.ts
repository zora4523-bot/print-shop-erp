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
      groupBy: vi.fn(),
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
  buildAdminWorkspaceBaseWhere,
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
  parseAdminOrderWorkspaceQuery,
} from '../admin-workspace-query';
import { OrderChangeRequestError } from '../change-request';

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
  dbMock.order.groupBy.mockReset().mockResolvedValue([]);
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
      submitterId: 'sales-1',
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
    expect(JSON.stringify(where)).toContain('"submitterId":"sales-1"');
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

  it.each([
    OrderStatus.CANCELLED,
    OrderStatus.SHIPPED,
    OrderStatus.SETTLED,
    OrderStatus.CONFIRMED,
  ])('%s 工单即使留有当前版待打印任务也不再提供确认已打印', (status) => {
    expect(
      resolveAdminPrintFacts({
        status,
        workOrderVersion: 2,
        requests: [{ id: 'v2', workOrderVersion: 2, resolution: null }],
      }),
    ).toMatchObject({ printPending: false, canCreatePrint: false, canMarkPrinted: false });
  });

  it('暂停期间批准改单生成的补打任务仍可确认已打印', () => {
    expect(
      resolveAdminPrintFacts({
        status: OrderStatus.ON_HOLD,
        workOrderVersion: 3,
        requests: [{ id: 'v3-reprint', workOrderVersion: 3, resolution: null }],
      }),
    ).toMatchObject({ pendingPrintJobId: 'v3-reprint', canMarkPrinted: true });
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

  it('offers batch production completion and shipping for released single-owner orders only when nothing needs approval or assignment', () => {
    const facts = {
      hasPendingChange: false, manualPricing: false, confirmationPreflightOk: true, confirmedFeePresent: false,
      pricingPending: false, hasShipment: true, hasLiveOutsource: false, hasIncompleteProduction: true,
      printFacts: { printPending: false, pendingPrintJobId: null, canCreatePrint: false, canMarkPrinted: false },
      status: OrderStatus.RELEASED,
      plannedCompletion: { pendingJobs: 2, requestedJobs: 0, unassignedUnits: 0 },
    };
    expect(resolveAdminOrderCapabilities(facts)).toMatchObject({ completeProduction: true, ship: true });
    expect(resolveAdminOrderCapabilities({ ...facts, plannedCompletion: { pendingJobs: 2, requestedJobs: 1, unassignedUnits: 0 } })).toMatchObject({ completeProduction: false, ship: false });
    expect(resolveAdminOrderShipDisabledReason({ ...facts, plannedCompletion: { pendingJobs: 2, requestedJobs: 1, unassignedUnits: 0 } })).toBe('有生产数量待审批，请先在生产安排中审批');
    expect(resolveAdminOrderCapabilities({ ...facts, plannedCompletion: { pendingJobs: 1, requestedJobs: 0, unassignedUnits: 1 } })).toMatchObject({ completeProduction: false, ship: false });
    expect(resolveAdminOrderShipDisabledReason({ ...facts, plannedCompletion: { pendingJobs: 1, requestedJobs: 0, unassignedUnits: 1 } })).toBe('仍有未安排师傅的生产，请先排单');
    expect(resolveAdminOrderCapabilities({ ...facts, hasPendingChange: true }).completeProduction).toBe(false);
    expect(resolveAdminOrderCapabilities({ ...facts, status: OrderStatus.ON_HOLD })).toMatchObject({ completeProduction: false, ship: false });
    // Scan-flow orders (no single-owner facts) keep the old rule: finish production first.
    const { plannedCompletion: _omit, ...scanFlow } = facts;
    void _omit;
    expect(resolveAdminOrderCapabilities(scanFlow)).toMatchObject({ completeProduction: false, ship: false });
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
    expect(resolveAdminOrderShipDisabledReason({ ...base, status: OrderStatus.PACKING, hasOutsourceGap: true })).toBe('外协单缺失或数量未覆盖工单，请先补齐外协');
    expect(resolveAdminOrderShipDisabledReason({ ...base, status: OrderStatus.CONFIRMED })).toBe('下发并完成生产后才可发货');
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

  // 审计 L-13：只有当前代次还有待开工/进行中的工序或进度步骤时，“下发后无人扫码”才算停滞。
  it.each([
    ['open current operation', {}, true],
    ['sample shipment without operations', { purpose: 'SAMPLE_SHIPMENT', productionOperations: [] }, false],
    ['new generation fully carried over', { workOrderVersion: 2, productionOperations: [
      { workOrderVersion: 1, status: ProductionOperationStatus.IN_PROGRESS },
      { workOrderVersion: 2, status: ProductionOperationStatus.COMPLETED },
    ] }, false],
    ['open current progress step only', { productionOperations: [
      { workOrderVersion: 1, status: ProductionOperationStatus.COMPLETED },
    ], productionProgressSteps: [{ workOrderVersion: 1, status: ProductionOperationStatus.PENDING }] }, true],
  ])('flags production stagnation only when the current generation is claimable: %s', async (_name, overrides, expected) => {
    const row = adminOrderRecord({
      status: OrderStatus.PACKING,
      scheduledAt: new Date('2026-09-01T00:00:00.000Z'),
      confirmedFee: new Prisma.Decimal('100.00'),
      productionOperations: [{ workOrderVersion: 1, status: ProductionOperationStatus.PENDING }],
      ...overrides,
    });
    dbMock.order.findFirst.mockResolvedValue(row);
    const detail = await getAdminOrderByOrderNo(actor, row.orderNo, new Date('2026-09-10T00:00:00.000Z'), 2);
    expect(detail?.progress.stagnant).toBe(expected);
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

  it('已有地址发货时待审取消 / 改款式申请标记为只能驳回，只改交期仍可批准', async () => {
    const shipments = [
      { trackingNo: null, status: 'PLANNED' },
      { trackingNo: 'SF100', status: 'SHIPPED' },
    ];
    const pending = (type: 'CANCEL' | 'MODIFY', proposedChanges: unknown) => adminOrderRecord({
      status: OrderStatus.PACKING,
      shipments,
      changeRequests: [{ id: 'change-1', type, reason: '客户要求', proposedChanges, createdAt: new Date('2026-09-01T00:00:00.000Z') }],
    });

    dbMock.order.findFirst.mockResolvedValue(pending('CANCEL', { items: [] }));
    let detail = await getAdminOrderByOrderNo(actor, 'GD-260902-001');
    expect(detail?.pendingChangeRequest?.approvalBlockedReason).toBe('工单已有地址发货，不能批准取消，请驳回该申请');
    expect(detail?.trackingNo).toBe('SF100');

    dbMock.order.findFirst.mockResolvedValue(pending('MODIFY', { items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 2000 }] }));
    detail = await getAdminOrderByOrderNo(actor, 'GD-260902-001');
    expect(detail?.pendingChangeRequest?.approvalBlockedReason).toBe('工单已有地址发货，不能批准款式或数量修改，请驳回该申请');

    dbMock.order.findFirst.mockResolvedValue(pending('MODIFY', { items: [], promisedDate: '2026-09-30' }));
    detail = await getAdminOrderByOrderNo(actor, 'GD-260902-001');
    expect(detail?.pendingChangeRequest?.approvalBlockedReason).toBeNull();

    dbMock.order.findFirst.mockResolvedValue(adminOrderRecord({
      status: OrderStatus.PACKING,
      shipments: [{ trackingNo: null, status: 'PLANNED' }],
      changeRequests: [{ id: 'change-2', type: 'CANCEL', reason: '客户要求', proposedChanges: { items: [] }, createdAt: new Date('2026-09-01T00:00:00.000Z') }],
    }));
    detail = await getAdminOrderByOrderNo(actor, 'GD-260902-001');
    expect(detail?.pendingChangeRequest?.approvalBlockedReason).toBeNull();
  });

  it('keeps missing-delivery guidance actionable in packing', async () => {
    dbMock.order.findFirst.mockResolvedValue(adminOrderRecord({ status: OrderStatus.PACKING, _count: { shipments: 0 } }));

    const detail = await getAdminOrderByOrderNo(actor, 'GD-260902-001');

    expect(detail?.capabilities.ship).toBe(false);
    expect(detail?.shipDisabledReason).toBe('缺少发货地址，无法发货');
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
    const groups = (counts: Partial<Record<OrderStatus, number>>) =>
      Object.entries(counts).map(([status, count]) => ({ status, _count: { _all: count } }));
    dbMock.order.groupBy
      .mockResolvedValueOnce(groups({ PENDING_FACTORY: 2, SUBMITTED: 1, CONFIRMED: 4, ON_HOLD: 2, RELEASED: 3, FOILING: 2, PACKING: 1, SHIPPED: 2, SETTLED: 2, CANCELLED: 1, FINISHED: 1, REJECTED: 1, DRAFT: 1 }))
      .mockResolvedValueOnce(groups({ PENDING_FACTORY: 1, CONFIRMED: 1, RELEASED: 1, SHIPPED: 1, SETTLED: 1, REJECTED: 1 }));
    const queueCounts = { todo: 13, print: 1, production: 8, shipped: 2, done: 4, all: 23 };
    const signalCounts = {
      'pending-quantity': 0, 'pending-confirmation': 3, 'pending-pricing': 1, 'pending-release': 3,
      'pending-change': 6, 'on-hold': 2, overdue: 6, 'due-today': 7,
    };
    dbMock.order.count
      .mockResolvedValueOnce(1).mockResolvedValueOnce(1)
      .mockResolvedValueOnce(6).mockResolvedValueOnce(7).mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2).mockResolvedValueOnce(3).mockResolvedValueOnce(4);
    dbMock.orderItem.aggregate.mockResolvedValue({
      _sum: { quantity: 12345 },
    });
    dbMock.order.aggregate
      .mockResolvedValueOnce({ _sum: { settledFee: '10.00' } })
      .mockResolvedValueOnce({ _sum: { confirmedFee: '20.25' } })
      .mockResolvedValueOnce({ _sum: { quotedFee: '3.75' } });

    const page = await loadAdminOrderWorkspace(actor, query, now);
    expect(page.counts).toEqual({ queues: queueCounts, signals: signalCounts });
    expect(dbMock.order.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['status'], where: buildAdminWorkspaceBaseWhere(actor, query), _count: { _all: true },
    });
    expect(dbMock.order.groupBy).toHaveBeenNthCalledWith(2, {
      by: ['status'], where: { AND: [buildAdminWorkspaceBaseWhere(actor, query), adminSignalWhere('pending-change', now)] }, _count: { _all: true },
    });
    for (const [index, signal] of (['pending-pricing', 'overdue', 'due-today', 'pending-quantity'] as const).entries()) {
      expect(dbMock.order.count.mock.calls[index + 1]?.[0]).toEqual({
        where: { AND: [buildAdminWorkspaceBaseWhere(actor, query), adminSignalWhere(signal, now)] },
      });
    }
    expect(dbMock.order.count).toHaveBeenCalledTimes(8);
    expect(dbMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000,
    });
    expect(page.summary).toEqual({
      orderCount: 23,
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
    const summaryCountStart = 5;
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

  it.each([
    // status, todo, production, shipped, done, pending confirmation, release, hold
    [OrderStatus.DRAFT, 0, 0, 0, 0, 0, 0, 0],
    [OrderStatus.PENDING_FACTORY, 1, 0, 0, 0, 1, 0, 0],
    [OrderStatus.SUBMITTED, 1, 0, 0, 0, 1, 0, 0],
    [OrderStatus.REJECTED, 0, 0, 0, 0, 0, 0, 0],
    [OrderStatus.CONFIRMED, 1, 1, 0, 0, 0, 1, 0],
    [OrderStatus.ON_HOLD, 1, 0, 0, 0, 0, 0, 1],
    [OrderStatus.RELEASED, 0, 1, 0, 0, 0, 0, 0],
    [OrderStatus.FOILING, 0, 1, 0, 0, 0, 0, 0],
    [OrderStatus.PACKING, 0, 1, 0, 0, 0, 0, 0],
    [OrderStatus.SCHEDULING, 0, 1, 0, 0, 0, 0, 0],
    [OrderStatus.IN_PRODUCTION, 0, 1, 0, 0, 0, 0, 0],
    [OrderStatus.COMPLETED, 0, 1, 0, 0, 0, 0, 0],
    [OrderStatus.SHIPPED, 0, 0, 1, 0, 0, 0, 0],
    [OrderStatus.SETTLED, 0, 0, 0, 1, 0, 0, 0],
    [OrderStatus.FINISHED, 0, 0, 0, 1, 0, 0, 0],
    [OrderStatus.CANCELLED, 0, 0, 0, 1, 0, 0, 0],
  ] as const)('keeps %s queue memberships with and without a pending change', async (status, todo, production, shipped, done, pendingConfirmation, pendingRelease, onHold) => {
    for (const hasPendingChange of [false, true]) {
      dbMock.order.groupBy.mockReset()
        .mockResolvedValueOnce([{ status, _count: { _all: 1 } }])
        .mockResolvedValueOnce(hasPendingChange ? [{ status, _count: { _all: 1 } }] : []);
      const page = await loadAdminOrderWorkspace(actor, parseAdminOrderWorkspaceQuery({ queue: 'all' }).query);
      expect(page.total).toBe(1);
      expect(page.counts).toEqual({
        queues: { todo: hasPendingChange ? 1 : todo, print: 0, production: hasPendingChange ? 0 : production, shipped, done, all: 1 },
        signals: {
          'pending-quantity': 0, 'pending-confirmation': pendingConfirmation, 'pending-pricing': 0,
          'pending-release': hasPendingChange ? 0 : pendingRelease,
          'pending-change': hasPendingChange ? 1 : 0,
          'on-hold': onHold, overdue: 0, 'due-today': 0,
        },
      });
    }
  });

  it('preserves all base filters and counts an added signal within its selected queue', async () => {
    const now = new Date('2026-09-10T00:00:00Z');
    const query = parseAdminOrderWorkspaceQuery({ queue: 'production', signal: 'overdue', q: '客户搜索', starred: 'yes', page: '3' }).query;
    dbMock.order.groupBy.mockResolvedValueOnce([{ status: OrderStatus.RELEASED, _count: { _all: 3 } }]).mockResolvedValueOnce([]);
    dbMock.order.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(2).mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const page = await loadAdminOrderWorkspace(actor, query, now);
    expect(page.counts.queues.production).toBe(3);
    expect(page.counts.signals.overdue).toBe(2);
    expect(page.total).toBe(1);
    expect(page.page).toBe(1);
    expect(dbMock.order.groupBy).toHaveBeenNthCalledWith(1, { by: ['status'], where: buildAdminWorkspaceBaseWhere(actor, query), _count: { _all: true } });
    expect(dbMock.order.count).toHaveBeenNthCalledWith(6, { where: buildAdminWorkspaceResultWhere(actor, query, now) });
    expect(dbMock.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: buildAdminWorkspaceResultWhere(actor, query, now), skip: 0 }));
  });

  it('uses exact current print membership for both queue count and the selected page', async () => {
    const query = parseAdminOrderWorkspaceQuery({ queue: 'print' }).query;
    dbMock.$queryRaw.mockResolvedValueOnce([{ id: 'current-print-1' }]);
    dbMock.order.groupBy.mockResolvedValueOnce([{ status: OrderStatus.RELEASED, _count: { _all: 3 } }]).mockResolvedValueOnce([]);
    dbMock.order.count.mockResolvedValueOnce(1);
    const page = await loadAdminOrderWorkspace(actor, query);
    expect(page.total).toBe(1);
    expect(page.counts.queues.print).toBe(1);
    expect(dbMock.order.count).toHaveBeenNthCalledWith(1, { where: { AND: [buildAdminWorkspaceBaseWhere(actor, query), { id: { in: ['current-print-1'] } }] } });
    expect(dbMock.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [buildAdminWorkspaceBaseWhere(actor, query), { id: { in: ['current-print-1'] } }, {}] } }));
  });

  it('fails the coherent read instead of returning misleading zero statistics', async () => {
    const failure = new Error('database unavailable');
    dbMock.order.groupBy.mockRejectedValueOnce(failure);
    await expect(loadAdminOrderWorkspace(actor, parseAdminOrderWorkspaceQuery({}).query)).rejects.toBe(failure);
    expect(dbMock.order.findMany).not.toHaveBeenCalled();
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

  it('does not display a new unquoted draft as a historical zero-price order', async () => {
    dbMock.order.findFirst.mockResolvedValue(adminOrderRecord({ status: OrderStatus.DRAFT, totalAmount: new Prisma.Decimal(0), priceRevision: 0 }));
    expect((await getAdminOrderByOrderNo(actor, 'GD-260902-001'))?.fee).toMatchObject({ amount: null, source: 'PENDING' });
  });

  it.each([
    { name: 'confirmed fee with estimated shipping', confirmedFee: '130.00', settledFee: null, hasEstimate: true, source: 'CONFIRMED', amount: '130.00', estimated: true },
    { name: 'confirmed zero with an estimated charge', confirmedFee: '0.00', settledFee: null, hasEstimate: true, source: 'CONFIRMED', amount: '0.00', estimated: true },
    { name: 'confirmed fee without estimates', confirmedFee: '130.00', settledFee: null, hasEstimate: false, source: 'CONFIRMED', amount: '130.00', estimated: false },
    { name: 'settled fee despite a retained estimated charge', confirmedFee: '130.00', settledFee: '140.00', hasEstimate: true, source: 'SETTLED', amount: '140.00', estimated: false },
    { name: 'quoted fee without estimated charge rows', confirmedFee: null, settledFee: null, hasEstimate: false, source: 'QUOTED', amount: '120.00', estimated: true },
  ])('projects $name without changing its persisted snapshot', async (scenario) => {
    const row = adminOrderRecord({
      status: scenario.settledFee === null ? OrderStatus.RELEASED : OrderStatus.SETTLED,
      pricingStatus: OrderPricingStatus.ADMIN_CONFIRMED,
      quotedFee: new Prisma.Decimal('120.00'),
      confirmedFee: scenario.confirmedFee === null ? null : new Prisma.Decimal(scenario.confirmedFee),
      settledFee: scenario.settledFee === null ? null : new Prisma.Decimal(scenario.settledFee),
      customerCharges: scenario.hasEstimate ? [{ id: 'shipping-estimate', status: OrderCustomerChargeStatus.ESTIMATED }] : [],
    });
    dbMock.order.findFirst.mockResolvedValue(row);
    const detail = await getAdminOrderByOrderNo(actor, row.orderNo);
    expect(detail?.fee).toEqual({ amount: scenario.amount, source: scenario.source, estimated: scenario.estimated });
    expect(detail?.feeStages).toEqual({ quoted: '120.00', confirmed: scenario.confirmedFee, settled: scenario.settledFee, active: scenario.source });
    expect(dbMock.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ customerCharges: {
        where: { status: { in: [OrderCustomerChargeStatus.PENDING_AMOUNT, OrderCustomerChargeStatus.ESTIMATED] } },
        select: { id: true, status: true },
      } }),
    }));
  });

  it.each([OrderStatus.SUBMITTED, OrderStatus.REJECTED])('distinguishes estimated charges from genuinely missing charges on %s orders', async (status) => {
    const row = adminOrderRecord({
      status,
      quotedFee: new Prisma.Decimal('120.00'),
      customerCharges: [{ id: 'shipping-estimate', status: OrderCustomerChargeStatus.ESTIMATED }],
    });
    dbMock.order.findFirst.mockResolvedValue(row);
    const estimated = await getAdminOrderByOrderNo(actor, row.orderNo);
    expect(estimated?.fee).toEqual({ amount: '120.00', source: 'QUOTED', estimated: true });
    expect(estimated?.statusSummary).not.toBe('系统无法完整定价，待人工核价');

    dbMock.order.findFirst.mockResolvedValue({
      ...row,
      customerCharges: [...row.customerCharges, { id: 'missing-charge', status: OrderCustomerChargeStatus.PENDING_AMOUNT }],
    });
    const pending = await getAdminOrderByOrderNo(actor, row.orderNo);
    expect(pending?.fee).toEqual({ amount: null, source: status === OrderStatus.SUBMITTED ? 'PENDING' : 'INCOMPLETE', estimated: false });
    expect(pending?.capabilities.confirm).toBe(false);
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

  it('never selects or exposes the retired order customer', async () => {
    const row = adminOrderRecord({ status: OrderStatus.DRAFT });
    dbMock.order.findFirst.mockResolvedValue(row);

    const detail = await getAdminOrderByOrderNo(actor, row.orderNo);

    const select = dbMock.order.findFirst.mock.calls[0]![0].select;
    expect(select).not.toHaveProperty('customerRef');
    expect(select).not.toHaveProperty('customerParty');
    expect(select).not.toHaveProperty('customerPartyId');
    expect(detail).not.toBeNull();
    expect(detail).not.toHaveProperty('customer');
    expect(JSON.stringify(detail)).not.toContain('未填客户');
  });
});

it.each([50, 100])('uses the same outsource quantity coverage as the ship gate (%s)', async quantity => {
  const base = adminOrderRecord();
  const row = adminOrderRecord({ status: OrderStatus.PACKING, requiresOutsource: true, confirmedFee: new Prisma.Decimal('100'),
    items: base.items.map(item => ({ ...item, crafts: ['outsource-craft'] })),
    outsourceOrders: [{ status: 'RECEIVED', itemSnapshots: [{ orderItemId: 'item-1', quantity }] }] });
  dbMock.craft.findMany.mockResolvedValue([{ id: 'outsource-craft', name: '外协工艺', isOutsource: true }]);
  dbMock.order.findFirst.mockResolvedValue(row);
  const result = await getAdminOrderByOrderNo(actor, row.orderNo);
  expect(result?.capabilities.ship).toBe(quantity === 100);
});
