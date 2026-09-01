import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderChangeRequestStatus,
  OrderCustomerChargeStatus,
  OrderItemQuoteDisposition,
  OrderPrintJobState,
  OrderQuotedFeeCompleteness,
  OrderStatus,
  Role,
} from '@/generated/prisma/client';

const { dbMock, progressMock } = vi.hoisted(() => {
  const database = {
    order: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      aggregate: vi.fn(),
    },
    orderItem: { aggregate: vi.fn() },
    craft: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return {
    dbMock: database,
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

import {
  adminManualPricingWhere,
  adminQueueWhere,
  adminSignalWhere,
  buildAdminWorkspaceResultWhere,
  loadAdminOrderWorkspace,
  resolveAdminPrintFacts,
  resolveAdminWorkspaceResultWhere,
} from '../admin-workspace';
import { parseAdminOrderWorkspaceQuery } from '../admin-workspace-query';

const actor = { id: 'admin-1', role: Role.ADMIN };

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.$transaction.mockImplementation(
    async (callback: (tx: typeof dbMock) => unknown) => callback(dbMock),
  );
  dbMock.order.findMany.mockResolvedValue([]);
  dbMock.order.findFirst.mockResolvedValue(null);
  dbMock.$queryRaw.mockResolvedValue([]);
  dbMock.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
  dbMock.order.aggregate.mockResolvedValue({
    _sum: { settledFee: null, confirmedFee: null, quotedFee: null },
  });
  dbMock.craft.findMany.mockResolvedValue([]);
});

describe('admin order workspace predicates', () => {
  it('uses persisted manual-pricing facts instead of a zero amount heuristic', () => {
    expect(adminManualPricingWhere()).toEqual({
      status: { in: [OrderStatus.PENDING_FACTORY, OrderStatus.SUBMITTED] },
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
    expect(sql).toContain('NOT EXISTS');
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
      .mockResolvedValueOnce(2);
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
    });
    expect(dbMock.orderItem.aggregate).toHaveBeenCalledWith({
      where: { order: expect.any(Object) },
      _sum: { quantity: true },
    });
    expect(dbMock.order.aggregate).toHaveBeenCalledTimes(3);
  });
});
