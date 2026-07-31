import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
});
