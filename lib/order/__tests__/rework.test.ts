import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderBillingMode,
  OrderKind,
  OrderSettlementType,
  OrderStatus,
  ReworkCause,
  Role,
  ShipmentStatus,
} from '../../../generated/prisma/enums';

const { dbMock, notifyMock } = vi.hoisted(() => {
  const mock = {
    order: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    craft: { findMany: vi.fn() },
    orderShipment: { create: vi.fn() },
    orderShipmentLine: { createMany: vi.fn() },
    orderLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return {
    dbMock: mock,
    notifyMock: vi.fn<(...args: unknown[]) => Promise<void>>(),
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: notifyMock,
}));

import {
  createReworkOrder,
  ReworkOrderError,
} from '../rework';

const ownerActor = { id: 'owner-1', role: Role.ADMIN };
const sourceOrder = {
  id: 'source-1',
  orderNo: 'GD-260730-001',
  kind: OrderKind.NORMAL,
  status: OrderStatus.SHIPPED,
  customerPartyId: 'customer-1',
  isUrgent: true,
  isSfCollect: true,
  customName: '客户春节红包',
  customerRef: '客户 A',
  receiverName: '张先生',
  receiverPhone: '13800000000',
  receiverAddress: '佛山市主地址',
  expressCode: 'SF',
  packageRequirement: '分箱',
  items: [
    {
      id: 'source-item-1',
      name: '大号红包',
      productId: null,
      specification: '大号',
      paperType: '艳红珠光纸',
      quantity: 1000,
      crafts: ['craft-foil', 'craft-cut'],
      foilColors: ['哑金', '红金'],
      isDoubleSided: false,
      isDoubleColor: true,
      suggestedSubtotal: null,
      remark: '正面文字不能偏',
      designs: [
        {
          fileType: 'IMAGE',
          fileUrl: 'https://oss.example.com/design.png',
          fileName: 'design.png',
          fileSize: BigInt(1024),
          thumbnailUrl: null,
          uploadedBy: 'sales-1',
          uploadedAt: new Date('2026-07-30T08:00:00Z'),
        },
      ],
    },
  ],
  shipments: [
    {
      receiverName: '张先生',
      receiverPhone: '13800000000',
      receiverAddress: '佛山市主地址',
      expressCode: 'SF',
    },
  ],
};

const validInput = {
  sourceOrderId: 'source-1',
  cause: ReworkCause.QUALITY,
  reason: '烫金位置偏移，需要重做',
  items: [
    {
      sourceOrderItemId: 'source-item-1',
      quantity: 120,
      craftIds: ['craft-foil'],
    },
  ],
};

beforeEach(() => {
  for (const model of [
    dbMock.order,
    dbMock.craft,
    dbMock.orderShipment,
    dbMock.orderShipmentLine,
    dbMock.orderLog,
  ]) {
    for (const mockFn of Object.values(model)) mockFn.mockReset();
  }
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation(
    async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock),
  );
  dbMock.order.findFirst.mockResolvedValue(null);
  dbMock.craft.findMany.mockResolvedValue([{ id: 'craft-foil' }]);
  dbMock.order.create.mockResolvedValue({
    id: 'rework-1',
    orderNo: 'GD-260731-001',
    items: [{ id: 'rework-item-1', sequence: 1 }],
  });
  dbMock.orderShipment.create.mockResolvedValue({ id: 'shipment-1' });
  dbMock.orderShipmentLine.createMany.mockResolvedValue({ count: 1 });
  dbMock.orderLog.create.mockResolvedValue({});
  notifyMock.mockReset().mockResolvedValue(undefined);
});

describe('createReworkOrder', () => {
  it('creates a submitted, no-charge child order and preserves source evidence', async () => {
    dbMock.order.findUnique
      .mockResolvedValueOnce(sourceOrder)
      .mockResolvedValueOnce({
        id: 'rework-1',
        orderNo: 'GD-260731-001',
        customerRef: '客户 A',
        totalAmount: '0.00',
        isUrgent: true,
        submitter: { displayName: '管理员' },
      });

    const now = new Date('2026-07-31T09:00:00+08:00');
    const result = await createReworkOrder(validInput, ownerActor, now);

    expect(result).toEqual({
      id: 'rework-1',
      orderNo: 'GD-260731-001',
    });
    const data = dbMock.order.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      status: OrderStatus.SUBMITTED,
      kind: OrderKind.REWORK,
      billingMode: OrderBillingMode.NO_CHARGE,
      settlementType: OrderSettlementType.NO_CHARGE,
      sourceOrderId: 'source-1',
      reworkCause: ReworkCause.QUALITY,
      totalAmount: '0.00',
      submittedAt: now,
    });
    expect(data.items.create[0]).toMatchObject({
      name: '大号红包',
      quantity: 120,
      crafts: ['craft-foil'],
      unitPrice: '0',
      fixedFee: '0',
      subtotal: '0',
      suggestedSubtotal: null,
      priceOverrideReason: '免费重做，不计加工费',
    });
    expect(data.items.create[0].designs.create).toEqual([
      expect.objectContaining({
        fileUrl: 'https://oss.example.com/design.png',
        uploadedBy: 'sales-1',
      }),
    ]);
    expect(dbMock.orderShipment.create.mock.calls[0]![0].data).toMatchObject({
      orderId: 'rework-1',
      status: ShipmentStatus.PLANNED,
      receiverAddress: '佛山市主地址',
    });
    expect(dbMock.orderShipmentLine.createMany).toHaveBeenCalledWith({
      data: [
        {
          shipmentId: 'shipment-1',
          orderItemId: 'rework-item-1',
          quantity: 120,
        },
      ],
    });
    expect(dbMock.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'source-1',
        action: 'CREATE_REWORK',
      }),
    });
    expect(notifyMock).toHaveBeenCalledWith(
      'ORDER_SUBMITTED',
      expect.objectContaining({
        orderId: 'rework-1',
        totalAmount: '0.00',
      }),
      { dedupeKey: 'notification:ORDER_SUBMITTED:rework-1' },
    );
  });

  it('rejects non-admin callers before opening a transaction', async () => {
    await expect(
      createReworkOrder(validInput, {
        id: 'sales-1',
        role: Role.SALES,
      }),
    ).rejects.toThrow(/只有管理员/);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects sources that have not shipped without creating a child order', async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...sourceOrder,
      status: OrderStatus.COMPLETED,
    });
    await expect(
      createReworkOrder(validInput, ownerActor),
    ).rejects.toBeInstanceOf(ReworkOrderError);
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });

  it('rejects nested rework and directs the owner back to the original order', async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...sourceOrder,
      kind: OrderKind.REWORK,
    });

    await expect(
      createReworkOrder(validInput, ownerActor),
    ).rejects.toThrow(/返回原工单/);
    expect(dbMock.craft.findMany).not.toHaveBeenCalled();
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });

  it('rejects quantities above the source quantity and unrelated crafts', async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(sourceOrder);
    await expect(
      createReworkOrder(
        {
          ...validInput,
          items: [{ ...validInput.items[0], quantity: 1001 }],
        },
        ownerActor,
      ),
    ).rejects.toThrow(/不能超过原数量/);

    dbMock.order.findUnique.mockResolvedValueOnce(sourceOrder);
    await expect(
      createReworkOrder(
        {
          ...validInput,
          items: [
            {
              ...validInput.items[0],
              craftIds: ['craft-not-on-source'],
            },
          ],
        },
        ownerActor,
      ),
    ).rejects.toThrow(/不包含所选重做工艺/);
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });
});
