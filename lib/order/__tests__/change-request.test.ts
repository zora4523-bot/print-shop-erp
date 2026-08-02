import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderBillingMode,
  OrderChangeRequestStatus,
  OrderStatus,
  Role,
  TaskStatus,
} from '../../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    orderItem: {
      update: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    orderShipmentLine: {
      upsert: vi.fn(),
      create: vi.fn(),
    },
    productionTask: {
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    outsourceOrder: { update: vi.fn() },
    orderChangeRequest: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    orderLog: { create: vi.fn() },
    csSalesEntry: {
      aggregate: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    salaryPeriod: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation(
    async (callback: (tx: typeof mock) => unknown) => callback(mock),
  );
  return { dbMock: mock };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  createOrderChangeRequest,
  OrderChangeRequestError,
  reviewOrderChangeRequest,
} from '../change-request';

const salesActor = { id: 'sales-1', role: Role.SALES };
const adminActor = { id: 'admin-1', role: Role.ADMIN };

const updateInput = {
  orderId: 'order-1',
  reason: '客户要求把哑金改成浅金',
  items: [
    {
      operation: 'UPDATE' as const,
      itemId: 'item-1',
      name: '红包 A',
      quantity: 1200,
      specification: '大号',
      foilColors: ['浅金'],
    },
  ],
};

function baseReviewRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    orderId: 'order-1',
    requesterId: 'sales-1',
    baseRevision: 2,
    status: OrderChangeRequestStatus.PENDING,
    reason: '客户变更',
    proposedChanges: {
      items: [
        {
          operation: 'UPDATE',
          itemId: 'item-1',
          name: '红包 A（新版）',
          specification: '大号',
          foilColors: ['浅金', '红金'],
        },
      ],
    },
    requester: {
      id: 'sales-1',
      displayName: '销售小王',
      role: Role.SALES,
    },
    order: {
      id: 'order-1',
      submitterId: 'sales-1',
      submitterRole: Role.SALES,
      billingMode: OrderBillingMode.CHARGE,
      revision: 2,
      status: OrderStatus.IN_PRODUCTION,
      totalAmount: '1000.00',
      items: [
        {
          id: 'item-1',
          sequence: 1,
          name: '红包 A',
          quantity: 1000,
          unitPrice: '1.00',
          subtotal: '1000.00',
          productId: null,
          specification: '中号',
          paperType: '艳红珠光纸',
          crafts: ['craft-1'],
          foilColors: ['哑金'],
          isDoubleSided: false,
          isDoubleColor: false,
          suggestedPrice: null,
          remark: null,
          tasks: [
            {
              craftId: 'craft-1',
              workerId: 'worker-1',
              workerType: 'MACHINE',
              machineType: 'WINDMILL',
              status: TaskStatus.PENDING,
            },
          ],
          shipmentLines: [
            {
              quantity: 1000,
              shipment: { id: 'shipment-1', sequence: 1 },
            },
          ],
        },
      ],
      outsourceOrders: [],
      shipments: [{ id: 'shipment-1', sequence: 1 }],
    },
    ...overrides,
  };
}

beforeEach(() => {
  for (const value of Object.values(dbMock)) {
    if (typeof value === 'object' && value !== null) {
      for (const method of Object.values(value)) {
        if (typeof method === 'function' && 'mockReset' in method) {
          (method as ReturnType<typeof vi.fn>).mockReset();
        }
      }
    }
  }
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.csSalesEntry.aggregate.mockResolvedValue({
    _sum: { amount: '1000.00' },
  });
  dbMock.$transaction.mockReset().mockImplementation(
    async (callback: (tx: typeof dbMock) => unknown) => callback(dbMock),
  );
});

describe('createOrderChangeRequest', () => {
  it('snapshots the current revision without mutating the live order', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.IN_PRODUCTION,
      revision: 2,
      items: [
        {
          id: 'item-1',
          sequence: 1,
          name: '红包 A',
          quantity: 1000,
          specification: '中号',
          foilColors: ['哑金'],
        },
      ],
      changeRequests: [],
    });
    dbMock.orderChangeRequest.create.mockResolvedValue({ id: 'request-1' });

    await expect(
      createOrderChangeRequest(updateInput, salesActor),
    ).resolves.toEqual({ id: 'request-1' });

    expect(dbMock.orderChangeRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order-1',
          requesterId: 'sales-1',
          baseRevision: 2,
          proposedChanges: { items: updateInput.items },
        }),
      }),
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('rejects changes to another salesperson’s order', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-2',
      status: OrderStatus.SUBMITTED,
      revision: 1,
      items: [{ id: 'item-1' }],
      changeRequests: [],
    });

    await expect(
      createOrderChangeRequest(updateInput, salesActor),
    ).rejects.toThrow(/只能修改自己提交/);
    expect(dbMock.orderChangeRequest.create).not.toHaveBeenCalled();
  });
});

describe('reviewOrderChangeRequest', () => {
  it('marks a request stale when the live order revision has changed', async () => {
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(
        baseReviewRequest({
          order: {
            ...baseReviewRequest().order,
            revision: 3,
          },
        }),
      );
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.STALE,
    });

    const result = await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(result.status).toBe(OrderChangeRequestStatus.STALE);
    expect(dbMock.orderChangeRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: expect.objectContaining({
        status: OrderChangeRequestStatus.STALE,
        reviewedById: 'admin-1',
      }),
    });
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
  });

  it('blocks quantity changes after that style has started production', async () => {
    const request = baseReviewRequest();
    request.proposedChanges = { items: updateInput.items };
    (
      request.order.items[0].tasks[0] as { status: TaskStatus }
    ).status = TaskStatus.IN_PROGRESS;
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toBeInstanceOf(OrderChangeRequestError);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
  });

  it('applies an approved non-quantity change and increments the revision', async () => {
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(baseReviewRequest());
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1000.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    const result = await reviewOrderChangeRequest(
      {
        requestId: 'request-1',
        decision: 'APPROVE',
        reviewRemark: '已与车间确认',
      },
      adminActor,
    );

    expect(result.status).toBe(OrderChangeRequestStatus.APPROVED);
    expect(dbMock.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: {
        name: '红包 A（新版）',
        quantity: undefined,
        specification: '大号',
        foilColors: ['浅金', '红金'],
        subtotal: '1000.00',
      },
    });
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { revision: 3, totalAmount: '1000.00' },
    });
    expect(dbMock.orderLog.create).toHaveBeenCalledTimes(1);
  });

  it('attributes an approved amount change to the order submitter snapshot even if the requester role changed', async () => {
    const request = baseReviewRequest({
      requester: {
        id: 'cs-original',
        displayName: '原客服',
        role: Role.SALES,
      },
      order: {
        ...baseReviewRequest().order,
        submitterId: 'cs-original',
        submitterRole: Role.CUSTOMER_SERVICE,
        billingMode: OrderBillingMode.CHARGE,
      },
      proposedChanges: { items: updateInput.items },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1200.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });
    dbMock.csSalesEntry.findUnique.mockResolvedValue(null);
    dbMock.salaryPeriod.findFirst.mockResolvedValue({
      id: 'period-1',
      totalSales: '1000.00',
      initialSales: '0.00',
    });
    dbMock.csSalesEntry.create.mockResolvedValue({ id: 'sales-entry-1' });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.csSalesEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        csUserId: 'cs-original',
        amount: '200.00',
        type: 'ORDER_CHANGED',
      }),
      select: { id: true },
    });
  });

  it('blocks a legacy CS order change when order-level sales history cannot be reconciled', async () => {
    const request = baseReviewRequest({
      order: {
        ...baseReviewRequest().order,
        submitterId: 'cs-original',
        submitterRole: Role.CUSTOMER_SERVICE,
        billingMode: OrderBillingMode.CHARGE,
      },
      proposedChanges: { items: updateInput.items },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1200.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });
    dbMock.csSalesEntry.aggregate.mockResolvedValue({
      _sum: { amount: null },
    });

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/未与当前金额对平.*历史财务校准/);
    expect(dbMock.csSalesEntry.create).not.toHaveBeenCalled();
  });

  it('does not credit a sales-owned order when its requester later becomes customer service', async () => {
    const request = baseReviewRequest({
      requester: {
        id: 'sales-1',
        displayName: '原销售',
        role: Role.CUSTOMER_SERVICE,
      },
      order: {
        ...baseReviewRequest().order,
        submitterId: 'sales-1',
        submitterRole: Role.SALES,
        billingMode: OrderBillingMode.CHARGE,
      },
      proposedChanges: { items: updateInput.items },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1200.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.csSalesEntry.create).not.toHaveBeenCalled();
    expect(dbMock.salaryPeriod.update).not.toHaveBeenCalled();
  });

  it('does not credit a draft change before the order submission records the full sale', async () => {
    const request = baseReviewRequest({
      requester: {
        id: 'cs-1',
        displayName: '客服',
        role: Role.CUSTOMER_SERVICE,
      },
      order: {
        ...baseReviewRequest().order,
        status: OrderStatus.DRAFT,
        submitterId: 'cs-1',
        submitterRole: Role.CUSTOMER_SERVICE,
        billingMode: OrderBillingMode.CHARGE,
      },
      proposedChanges: { items: updateInput.items },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1200.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.csSalesEntry.create).not.toHaveBeenCalled();
    expect(dbMock.salaryPeriod.update).not.toHaveBeenCalled();
  });

  it('rejects an item subtotal that would overflow Decimal(12,2)', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            ...updateInput.items[0],
            quantity: 9_999_999,
          },
        ],
      },
      order: {
        ...baseReviewRequest().order,
        items: [
          {
            ...baseReviewRequest().order.items[0],
            unitPrice: '2000.00',
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/款式.*金额超过可保存上限/);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('rejects a combined order total that would overflow Decimal(12,2)', async () => {
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(baseReviewRequest());
    dbMock.orderItem.findMany.mockResolvedValue([
      { subtotal: '6000000000.00' },
      { subtotal: '6000000000.00' },
    ]);

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/工单总额超过可保存上限/);
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });
});
