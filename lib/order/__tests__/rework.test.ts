import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderBillingMode,
  OrderCraft,
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderKind,
  OrderLamination,
  OrderPackagingMode,
  OrderProductStructure,
  OrderSettlementType,
  OrderStatus,
  ReworkCause,
  Role,
  ShipmentStatus,
} from '../../../generated/prisma/enums';
import { ORDER_PRICING_STATUS } from '../pricing-status';

const {
  dbMock,
  notifyMock,
  modeMock,
  enqueueNotificationMock,
  activateOperationsMock,
  getSettingMock,
} = vi.hoisted(() => {
  const mock = {
    order: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    craft: { findMany: vi.fn() },
    orderShipment: { create: vi.fn() },
    orderShipmentLine: { createMany: vi.fn() },
    orderPackagingGroup: { create: vi.fn() },
    orderPackagingGroupLine: { createMany: vi.fn() },
    orderPricingRevision: { create: vi.fn() },
    orderLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return {
    dbMock: mock,
    notifyMock: vi.fn<(...args: unknown[]) => Promise<void>>(),
    modeMock: vi.fn<() => 'inline' | 'durable'>(),
    enqueueNotificationMock: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
    activateOperationsMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    getSettingMock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: notifyMock,
}));
vi.mock('@/lib/background-jobs/mode', () => ({
  backgroundJobsMode: modeMock,
}));
vi.mock('@/lib/notification/transactional-outbox', () => ({
  enqueueNotificationInTransaction: enqueueNotificationMock,
}));
vi.mock('@/lib/production/operation-materialization-service', () => ({
  activateProductionOperationsInTx: activateOperationsMock,
  ProductionOperationMaterializationError: class extends Error {},
}));
vi.mock('@/lib/settings', () => ({ getSetting: getSettingMock }));

import {
  createReworkOrder,
  REWORK_PACKAGING_FACT_SOURCES,
  reworkItemRequiresUnitsPerBagInput,
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
      pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
      craft: OrderCraft.PARTIAL,
      productStructure: OrderProductStructure.STANDARD_ENVELOPE,
      artworkVersion: null,
      plateGroupId: null,
      pricingGroup: null,
      manualQuoteReason: null,
      specification: '大号',
      actualWidthMm: null,
      actualHeightMm: null,
      paperType: '艳红珠光纸',
      paperWeightGsm: 160,
      quantity: 1000,
      pack: 100,
      crafts: ['craft-foil', 'craft-cut'],
      frontFoilColors: ['哑金', '红金'],
      backFoilColors: [],
      foilColors: ['哑金', '红金'],
      foilTechnique: OrderFoilTechnique.FLAT,
      hasLocalFoil: true,
      lamination: OrderLamination.NONE,
      printColors: [],
      printColorsKnown: true,
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
      sequence: 1,
      receiverName: '张先生',
      receiverPhone: '13800000000',
      receiverAddress: '佛山市主地址',
      expressCode: 'SF',
    },
  ],
  packagingGroups: [
    {
      id: 'source-group-1',
      sequence: 1,
      name: '原单单款装',
      mode: OrderPackagingMode.SINGLE_STYLE,
      actualBagCount: 10,
      lines: [
        {
          orderItemId: 'source-item-1',
          unitsPerBag: 100,
        },
      ],
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
    dbMock.orderPackagingGroup,
    dbMock.orderPackagingGroupLine,
    dbMock.orderPricingRevision,
    dbMock.orderLog,
  ]) {
    for (const mockFn of Object.values(model)) mockFn.mockReset();
  }
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation(
    async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock),
  );
  dbMock.order.findFirst.mockResolvedValue(null);
  dbMock.craft.findMany.mockResolvedValue([
    { id: 'craft-foil', code: 'FLAT_FOIL_PARTIAL' },
  ]);
  dbMock.order.create.mockResolvedValue({
    id: 'rework-1',
    orderNo: 'GD-260731-001',
    items: [{ id: 'rework-item-1', sequence: 1 }],
  });
  dbMock.orderShipment.create.mockResolvedValue({ id: 'shipment-1' });
  dbMock.orderShipmentLine.createMany.mockResolvedValue({ count: 1 });
  dbMock.orderPackagingGroup.create.mockResolvedValue({ id: 'rework-group-1' });
  dbMock.orderPackagingGroupLine.createMany.mockResolvedValue({ count: 1 });
  dbMock.orderPricingRevision.create.mockResolvedValue({});
  dbMock.orderLog.create.mockResolvedValue({});
  notifyMock.mockReset().mockResolvedValue(undefined);
  modeMock.mockReset().mockReturnValue('inline');
  enqueueNotificationMock.mockReset().mockResolvedValue(true);
  activateOperationsMock.mockReset().mockResolvedValue({
    orderId: 'rework-1',
    orderStatus: OrderStatus.SCHEDULING,
    operationsCreated: 2,
    progressStepsCreated: 1,
  });
  getSettingMock.mockReset().mockResolvedValue({ enabled: true });
});

describe('createReworkOrder', () => {
  it('只在该款无结构化归属且无有效 pack 时要求补录', () => {
    expect(reworkItemRequiresUnitsPerBagInput(0, null)).toBe(true);
    expect(reworkItemRequiresUnitsPerBagInput(0, 100)).toBe(false);
    expect(reworkItemRequiresUnitsPerBagInput(1, null)).toBe(false);
    expect(reworkItemRequiresUnitsPerBagInput(2, null)).toBe(false);
  });

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
      pricingStatus: ORDER_PRICING_STATUS.AUTO_CONFIRMED,
      priceRevision: 1,
      pricingConfirmedAt: now,
      pricingConfirmedById: null,
      sourceOrderId: 'source-1',
      reworkCause: ReworkCause.QUALITY,
      totalAmount: '0.00',
      quotedFee: null,
      confirmedFee: '0.00',
      settledFee: null,
      submittedAt: now,
      receiverAddress: '佛山市主地址',
    });
    expect(data.items.create[0]).toMatchObject({
      name: '大号红包',
      quantity: 120,
      crafts: ['craft-foil'],
      pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
      craft: OrderCraft.PARTIAL,
      productStructure: OrderProductStructure.STANDARD_ENVELOPE,
      frontFoilColors: ['哑金', '红金'],
      backFoilColors: [],
      hasLocalFoil: true,
      pack: 100,
      unitPrice: '0',
      fixedFee: '0',
      subtotal: '0',
      suggestedSubtotal: null,
      priceOverrideReason: '免费重做，不计加工费',
      pricingSnapshot: expect.objectContaining({
        packagingFactSource:
          REWORK_PACKAGING_FACT_SOURCES.SOURCE_GROUP,
      }),
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
    expect(dbMock.orderPackagingGroup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'rework-1',
        sequence: 1,
        mode: OrderPackagingMode.SINGLE_STYLE,
        actualBagCount: 2,
        unitPrice: '0',
        subtotal: '0',
        pricingSnapshot: expect.objectContaining({
          packagingFactSource:
            REWORK_PACKAGING_FACT_SOURCES.SOURCE_GROUP,
          sourcePackagingGroupId: 'source-group-1',
        }),
      }),
      select: { id: true },
    });
    expect(dbMock.orderPackagingGroupLine.createMany).toHaveBeenCalledWith({
      data: [
        {
          orderId: 'rework-1',
          packagingGroupId: 'rework-group-1',
          orderItemId: 'rework-item-1',
          unitsPerBag: 100,
        },
      ],
    });
    expect(dbMock.orderPricingRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'rework-1',
        revision: 1,
        status: ORDER_PRICING_STATUS.AUTO_CONFIRMED,
        source: 'REWORK_ORDER_CREATED_NO_CHARGE',
        createdById: 'owner-1',
        createdAt: now,
        snapshot: expect.objectContaining({
          source: 'REWORK_ORDER_CREATED_NO_CHARGE',
          order: expect.objectContaining({
            settlementType: OrderSettlementType.NO_CHARGE,
            pricingStatus: ORDER_PRICING_STATUS.AUTO_CONFIRMED,
            totalAmount: '0.00',
            quotedFee: null,
            confirmedFee: '0.00',
            settledFee: null,
          }),
          items: [
            expect.objectContaining({
              id: 'rework-item-1',
              subtotal: '0',
              requiresAdminConfirmation: false,
            }),
          ],
          packagingGroups: [
            expect.objectContaining({
              sequence: 1,
              mode: OrderPackagingMode.SINGLE_STYLE,
              actualBagCount: 2,
              packagingFactSource:
                REWORK_PACKAGING_FACT_SOURCES.SOURCE_GROUP,
              sourcePackagingGroupId: 'source-group-1',
              subtotal: '0',
              requiresAdminConfirmation: false,
            }),
          ],
          customerCharges: [],
        }),
      }),
    });
    expect(dbMock.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'source-1',
        action: 'CREATE_REWORK',
        changedFields: expect.objectContaining({
          packagingFactSources: {
            before: null,
            after: [
              expect.objectContaining({
                source: REWORK_PACKAGING_FACT_SOURCES.SOURCE_GROUP,
                sourcePackagingGroupId: 'source-group-1',
              }),
            ],
          },
        }),
      }),
    });
    expect(activateOperationsMock).toHaveBeenCalledWith(
      dbMock,
      'rework-1',
      ownerActor,
      now,
    );
    expect(notifyMock).toHaveBeenCalledWith(
      'ORDER_SUBMITTED',
      expect.objectContaining({
        orderId: 'rework-1',
        summary: '重做工单已提交，待工厂确认',
        deepLink: '/orders#wo=GD-260731-001',
      }),
      { dedupeKey: 'notification:ORDER_SUBMITTED:rework-1' },
    );
    expect(notifyMock).toHaveBeenCalledWith(
      'URGENT_ORDER',
      {
        orderId: 'rework-1',
        orderNo: 'GD-260731-001',
        submitterName: '管理员',
        customerRef: '客户 A',
      },
      { dedupeKey: 'notification:URGENT_ORDER:rework-1' },
    );
    expect(notifyMock).toHaveBeenCalledTimes(2);
    for (const [, payload] of notifyMock.mock.calls) {
      expect(payload).not.toHaveProperty('totalAmount');
    }
  });

  it('新单通知关闭时不投递非急单重做通知', async () => {
    getSettingMock.mockResolvedValue({ enabled: false });
    dbMock.order.findUnique
      .mockResolvedValueOnce({ ...sourceOrder, isUrgent: false })
      .mockResolvedValueOnce({
        id: 'rework-1',
        orderNo: 'GD-260731-001',
        customerRef: '客户 A',
        isUrgent: false,
        submitter: { displayName: '管理员' },
      });

    await createReworkOrder(validInput, ownerActor);

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('只重做非计件工艺时不复制原单烫金计件事实', async () => {
    dbMock.craft.findMany.mockResolvedValue([
      { id: 'craft-glue', code: 'GLUING' },
    ]);
    dbMock.order.findUnique
      .mockResolvedValueOnce({
        ...sourceOrder,
        items: [
          {
            ...sourceOrder.items[0],
            craft: OrderCraft.FULL,
            crafts: ['craft-foil', 'craft-glue'],
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'rework-1',
        orderNo: 'GD-260731-001',
        customerRef: '客户 A',
        totalAmount: '0.00',
        isUrgent: true,
        submitter: { displayName: '管理员' },
      });

    await createReworkOrder(
      {
        ...validInput,
        items: [{ ...validInput.items[0], craftIds: ['craft-glue'] }],
      },
      ownerActor,
    );

    expect(dbMock.order.create.mock.calls[0]![0].data.items.create[0]).toMatchObject({
      crafts: ['craft-glue'],
      craft: OrderCraft.PRINT,
      frontFoilColors: [],
      backFoilColors: [],
      foilColors: [],
      foilTechnique: OrderFoilTechnique.NONE,
      hasLocalFoil: false,
    });
    expect(activateOperationsMock).toHaveBeenCalledOnce();
  });

  it.each([
    [
      '工单快照缺失',
      null,
      [{ ...sourceOrder.shipments[0], receiverAddress: '  广州市主票地址  ' }],
      '广州市主票地址',
    ],
    [
      '主票缺失',
      '  佛山市工单快照地址  ',
      [
        {
          ...sourceOrder.shipments[0],
          sequence: 2,
          receiverAddress: '深圳市额外地址',
        },
      ],
      '佛山市工单快照地址',
    ],
  ])(
    '%s时复用唯一可验证地址，并同步写入子工单与主发货记录',
    async (_label, sourceAddress, shipments, expectedAddress) => {
      dbMock.order.findUnique
        .mockResolvedValueOnce({
          ...sourceOrder,
          receiverAddress: sourceAddress,
          shipments,
        })
        .mockResolvedValueOnce({
          id: 'rework-1',
          orderNo: 'GD-260731-001',
          customerRef: '客户 A',
          totalAmount: '0.00',
          isUrgent: true,
          submitter: { displayName: '管理员' },
        });

      await createReworkOrder(validInput, ownerActor);

      expect(dbMock.order.create.mock.calls[0]![0].data.receiverAddress).toBe(
        expectedAddress,
      );
      expect(
        dbMock.orderShipment.create.mock.calls[0]![0].data.receiverAddress,
      ).toBe(expectedAddress);
    },
  );

  it('原工单与主发货记录都没有可用地址时给出可执行修复提示', async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...sourceOrder,
      receiverAddress: '   ',
      shipments: [
        {
          ...sourceOrder.shipments[0],
          receiverAddress: null,
        },
      ],
    });

    await expect(createReworkOrder(validInput, ownerActor)).rejects.toThrow(
      /原工单和主发货记录均缺少收货地址.*先补全.*再创建/,
    );
    expect(dbMock.order.create).not.toHaveBeenCalled();
    expect(dbMock.orderShipment.create).not.toHaveBeenCalled();
  });

  it('does not emit URGENT_ORDER when the source order is not urgent', async () => {
    dbMock.order.findUnique
      .mockResolvedValueOnce({ ...sourceOrder, isUrgent: false })
      .mockResolvedValueOnce({
        id: 'rework-1',
        orderNo: 'GD-260731-001',
        customerRef: '客户 A',
        totalAmount: '0.00',
        isUrgent: false,
        submitter: { displayName: '管理员' },
      });

    await createReworkOrder(validInput, ownerActor);

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
      'ORDER_SUBMITTED',
      expect.objectContaining({ orderId: 'rework-1', urgentMark: '' }),
      { dedupeKey: 'notification:ORDER_SUBMITTED:rework-1' },
    );
  });

  it('atomically enqueues both submitted and urgent events in durable mode', async () => {
    modeMock.mockReturnValue('durable');
    dbMock.order.findUnique.mockResolvedValueOnce(sourceOrder);
    dbMock.order.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'rework-1',
      orderNo: 'GD-260731-001',
      customerRef: '客户 A',
      totalAmount: '0.00',
      isUrgent: true,
      submitter: { displayName: '管理员' },
    });

    await createReworkOrder(validInput, ownerActor);

    expect(enqueueNotificationMock).toHaveBeenNthCalledWith(
      1,
      dbMock,
      'ORDER_SUBMITTED',
      expect.objectContaining({ orderId: 'rework-1', urgentMark: '🚨 急单' }),
      { dedupeKey: 'notification:ORDER_SUBMITTED:rework-1' },
    );
    expect(enqueueNotificationMock).toHaveBeenNthCalledWith(
      2,
      dbMock,
      'URGENT_ORDER',
      expect.objectContaining({ orderId: 'rework-1' }),
      { dedupeKey: 'notification:URGENT_ORDER:rework-1' },
    );
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('propagates an urgent outbox failure so the owning transaction can roll back', async () => {
    modeMock.mockReturnValue('durable');
    dbMock.order.findUnique.mockResolvedValueOnce(sourceOrder);
    dbMock.order.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'rework-1',
      orderNo: 'GD-260731-001',
      customerRef: '客户 A',
      totalAmount: '0.00',
      isUrgent: true,
      submitter: { displayName: '管理员' },
    });
    enqueueNotificationMock
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('outbox unavailable'));

    await expect(createReworkOrder(validInput, ownerActor)).rejects.toThrow(
      'outbox unavailable',
    );
    expect(enqueueNotificationMock).toHaveBeenCalledTimes(2);
    expect(notifyMock).not.toHaveBeenCalled();
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

  it('逐地址发货后已结算的原单可以发起重做，且不改写原单应收', async () => {
    dbMock.order.findUnique
      .mockResolvedValueOnce({
        ...sourceOrder,
        status: OrderStatus.SETTLED,
        settledFee: '1280.00',
        settledAt: new Date('2026-09-20T08:00:00Z'),
      })
      .mockResolvedValueOnce({
        id: 'rework-1',
        orderNo: 'GD-260922-001',
        customerRef: '客户 A',
        totalAmount: '0.00',
        isUrgent: true,
        submitter: { displayName: '管理员' },
      });

    await expect(
      createReworkOrder(validInput, ownerActor, new Date('2026-09-22T09:00:00+08:00')),
    ).resolves.toEqual({ id: 'rework-1', orderNo: 'GD-260731-001' });
    expect(dbMock.order.create.mock.calls[0]![0].data).toMatchObject({
      kind: OrderKind.REWORK,
      sourceOrderId: 'source-1',
      billingMode: OrderBillingMode.NO_CHARGE,
      settlementType: OrderSettlementType.NO_CHARGE,
      totalAmount: '0.00',
      settledFee: null,
    });
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orderId: 'source-1', action: 'CREATE_REWORK' }),
    });
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

  it('无结构化包装组时复用原款式明确的 pack 快照', async () => {
    dbMock.order.findUnique
      .mockResolvedValueOnce({
        ...sourceOrder,
        packagingGroups: [],
      })
      .mockResolvedValueOnce({
        id: 'rework-1',
        orderNo: 'GD-260731-001',
        customerRef: '客户 A',
        totalAmount: '0.00',
        isUrgent: true,
        submitter: { displayName: '管理员' },
      });

    await createReworkOrder(validInput, ownerActor);

    expect(dbMock.orderPackagingGroup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actualBagCount: 2,
        mode: OrderPackagingMode.SINGLE_STYLE,
        pricingSnapshot: expect.objectContaining({
          packagingFactSource:
            REWORK_PACKAGING_FACT_SOURCES.SOURCE_ITEM_PACK,
          sourcePackagingGroupId: null,
        }),
      }),
      select: { id: true },
    });
    expect(dbMock.orderPackagingGroupLine.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ unitsPerBag: 100 })],
    });
  });

  it('原单无包装事实时要求管理员显式填每袋数，并支持仅重新入袋', async () => {
    const legacySource = {
      ...sourceOrder,
      items: [{ ...sourceOrder.items[0], pack: null }],
      packagingGroups: [],
    };
    dbMock.order.findUnique.mockResolvedValueOnce(legacySource);
    await expect(
      createReworkOrder(
        {
          ...validInput,
          cause: ReworkCause.LOGISTICS_DAMAGE,
          items: [{ ...validInput.items[0], craftIds: [] }],
        },
        ownerActor,
      ),
    ).rejects.toThrow(/由管理员显式填写/);
    expect(dbMock.order.create).not.toHaveBeenCalled();

    dbMock.order.findUnique
      .mockResolvedValueOnce(legacySource)
      .mockResolvedValueOnce({
        id: 'rework-1',
        orderNo: 'GD-260731-001',
        customerRef: '客户 A',
        totalAmount: '0.00',
        isUrgent: true,
        submitter: { displayName: '管理员' },
      });
    await createReworkOrder(
      {
        ...validInput,
        cause: ReworkCause.LOGISTICS_DAMAGE,
        items: [
          {
            ...validInput.items[0],
            craftIds: [],
            unitsPerBag: 50,
          },
        ],
      },
      ownerActor,
    );

    expect(dbMock.craft.findMany).not.toHaveBeenCalled();
    expect(dbMock.order.create.mock.calls[0]![0].data.items.create[0]).toMatchObject({
      craft: OrderCraft.PRINT,
      crafts: [],
      pack: 50,
      frontFoilColors: [],
      backFoilColors: [],
      foilColors: [],
      foilTechnique: OrderFoilTechnique.NONE,
      hasLocalFoil: false,
      pricingSnapshot: expect.objectContaining({
        packagingFactSource: REWORK_PACKAGING_FACT_SOURCES.ADMIN_INPUT,
      }),
    });
    expect(dbMock.orderPackagingGroup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actualBagCount: 3,
        mode: OrderPackagingMode.SINGLE_STYLE,
        pricingSnapshot: expect.objectContaining({
          packagingFactSource: REWORK_PACKAGING_FACT_SOURCES.ADMIN_INPUT,
        }),
      }),
      select: { id: true },
    });
    expect(dbMock.orderPackagingGroupLine.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ unitsPerBag: 50 })],
    });
    expect(activateOperationsMock).toHaveBeenCalledOnce();
  });

  it('结构化包装组存在时忽略客户端覆盖值，不改写 canonical 事实', async () => {
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

    await createReworkOrder(
      {
        ...validInput,
        items: [{ ...validInput.items[0], unitsPerBag: 1 }],
      },
      ownerActor,
    );

    expect(dbMock.orderPackagingGroupLine.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ unitsPerBag: 100 })],
    });
    expect(dbMock.orderPackagingGroup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actualBagCount: 2,
        pricingSnapshot: expect.objectContaining({
          packagingFactSource:
            REWORK_PACKAGING_FACT_SOURCES.SOURCE_GROUP,
        }),
      }),
      select: { id: true },
    });
  });

  it('同一张历史单可同时复用 canonical 包装与管理员补录事实', async () => {
    const secondSourceItem = {
      ...sourceOrder.items[0],
      id: 'source-item-2',
      name: '中号红包',
      quantity: 400,
      pack: null,
      crafts: [],
    };
    dbMock.order.findUnique
      .mockResolvedValueOnce({
        ...sourceOrder,
        items: [...sourceOrder.items, secondSourceItem],
      })
      .mockResolvedValueOnce({
        id: 'rework-1',
        orderNo: 'GD-260731-001',
        customerRef: '客户 A',
        totalAmount: '0.00',
        isUrgent: true,
        submitter: { displayName: '管理员' },
      });
    dbMock.order.create.mockResolvedValueOnce({
      id: 'rework-1',
      orderNo: 'GD-260731-001',
      items: [
        { id: 'rework-item-1', sequence: 1 },
        { id: 'rework-item-2', sequence: 2 },
      ],
    });
    dbMock.orderPackagingGroup.create
      .mockResolvedValueOnce({ id: 'rework-group-1' })
      .mockResolvedValueOnce({ id: 'rework-group-2' });

    await createReworkOrder(
      {
        ...validInput,
        items: [
          validInput.items[0],
          {
            sourceOrderItemId: 'source-item-2',
            quantity: 80,
            craftIds: [],
            unitsPerBag: 40,
          },
        ],
      },
      ownerActor,
    );

    expect(dbMock.orderPackagingGroup.create).toHaveBeenCalledTimes(2);
    expect(dbMock.orderPackagingGroup.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          sequence: 1,
          actualBagCount: 2,
          pricingSnapshot: expect.objectContaining({
            packagingFactSource:
              REWORK_PACKAGING_FACT_SOURCES.SOURCE_GROUP,
          }),
        }),
      }),
    );
    expect(dbMock.orderPackagingGroup.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          sequence: 2,
          actualBagCount: 2,
          pricingSnapshot: expect.objectContaining({
            packagingFactSource: REWORK_PACKAGING_FACT_SOURCES.ADMIN_INPUT,
          }),
        }),
      }),
    );
    expect(dbMock.order.create.mock.calls[0]![0].data.items.create[1]).toMatchObject({
      name: '中号红包',
      craft: OrderCraft.PRINT,
      crafts: [],
      pack: 40,
      foilColors: [],
    });
  });

  it('选中款式同时属于多个包装组时仍 fail closed', async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...sourceOrder,
      packagingGroups: [
        ...sourceOrder.packagingGroups,
        {
          ...sourceOrder.packagingGroups[0],
          id: 'source-group-2',
          sequence: 2,
        },
      ],
    });
    await expect(createReworkOrder(validInput, ownerActor)).rejects.toThrow(
      /同时属于 2 个包装组/,
    );
    expect(dbMock.order.create).not.toHaveBeenCalled();
    expect(activateOperationsMock).not.toHaveBeenCalled();
  });

  it('同时选中多个烫金主工艺时 fail closed', async () => {
    dbMock.craft.findMany.mockResolvedValue([
      { id: 'craft-foil', code: 'FLAT_FOIL_PARTIAL' },
      { id: 'craft-full', code: 'FLAT_FOIL_SINGLE' },
    ]);
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...sourceOrder,
      items: [
        {
          ...sourceOrder.items[0],
          crafts: ['craft-foil', 'craft-full'],
        },
      ],
    });

    await expect(
      createReworkOrder(
        {
          ...validInput,
          items: [
            {
              ...validInput.items[0],
              craftIds: ['craft-foil', 'craft-full'],
            },
          ],
        },
        ownerActor,
      ),
    ).rejects.toThrow(/多个烫金主工艺/);
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });
});
