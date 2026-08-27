import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderBillingMode,
  MachineType,
  OrderChangeRequestStatus,
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderPackagingMode,
  OrderProductStructure,
  OrderSettlementType,
  OrderStatus,
  Role,
  TaskStatus,
} from '../../../generated/prisma/enums';

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
    orderPackagingGroup: {
      update: vi.fn(),
    },
    orderShipmentLine: {
      upsert: vi.fn(),
      create: vi.fn(),
    },
    orderCustomerCharge: {
      aggregate: vi.fn(),
      update: vi.fn(),
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
    craft: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    material: { findMany: vi.fn() },
    priceTier: { findMany: vi.fn() },
    priceAdjustment: { findMany: vi.fn() },
    customerPriceBook: { findMany: vi.fn() },
    customerPriceRule: { findMany: vi.fn() },
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
const { appendPricingRevisionMock } = vi.hoisted(() => ({
  appendPricingRevisionMock: vi.fn(),
}));
vi.mock('@/lib/order/pricing-revision', () => ({
  appendOrderPricingRevisionInTx: appendPricingRevisionMock,
}));

import {
  createOrderChangeRequest,
  OrderChangeRequestError,
  previewOrderChangeRequestPricing,
  reviewOrderChangeRequest,
} from '../change-request';

const salesActor = { id: 'sales-1', role: Role.SALES };
const adminActor = { id: 'admin-1', role: Role.ADMIN };

const activeExternalPriceBook = {
  id: 'external-book-test',
  code: 'EXTERNAL_TEST',
  name: '外部销售测试价目簿',
  version: 1,
  sourceName: '测试报价表.xlsx',
  sourceSha256: 'b'.repeat(64),
};

function frozenLogisticsPriceBook() {
  const sourceSha256 = 'c'.repeat(64);
  const source = {
    sourceSheet: '中通',
    sourceRange: 'A3:D3',
    sourceName: '物流价目簿.xlsx',
    sourceSha256,
  };
  const packagingRule = (
    code: string,
    minQty: number,
    maxQty: number,
    amount: string,
  ) => ({
    id: `packing-${code}`,
    code,
    amount,
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty,
    maxQty,
    triggerCondition: null,
    ...source,
    sourceSheet: 'Sheet1',
    sourceRange: `A${minQty}:B${maxQty}`,
    blocksAutomaticQuote: true,
    category: { id: 'packing-category', code: 'PACKING_MATERIAL' },
  });
  return {
    id: 'logistics-book-1',
    code: 'EXTERNAL_LOGISTICS_V1',
    name: '外部销售物流价目簿',
    version: 1,
    sourceName: '物流价目簿.xlsx',
    sourceSha256,
    rules: [
      {
        id: 'shipping-guangdong',
        code: 'ZTO_GUANGDONG',
        amount: '2.80',
        includedUnits: '1',
        incrementUnits: '1',
        incrementAmount: '1.50',
        minQty: null,
        maxQty: null,
        triggerCondition: { carrierCode: 'ZTO', provinces: ['广东'] },
        ...source,
        blocksAutomaticQuote: false,
        category: { id: 'shipping-category', code: 'SHIPPING_FEE' },
      },
      packagingRule('CARTON_Q1_500', 1, 500, '1.00'),
      packagingRule('CARTON_Q501_1000', 501, 1_000, '3.00'),
      packagingRule('CARTON_Q1001_2000', 1_001, 2_000, '5.00'),
      packagingRule('CARTON_Q2001_3000', 2_001, 3_000, '7.00'),
      packagingRule('CARTON_Q3001_5000', 3_001, 5_000, '8.00'),
    ],
  };
}

function externalBaseRule({
  id = 'external-base-product-1',
  amount = '1.0000',
  productId = 'product-1',
  minQty = null,
  maxQty = null,
}: {
  id?: string;
  amount?: string;
  productId?: string | null;
  minQty?: number | null;
  maxQty?: number | null;
} = {}) {
  return {
    id,
    code: id,
    name: `基础价 ${id}`,
    kind: 'BASE',
    calculationType: 'PER_PIECE',
    amount,
    minQty,
    maxQty,
    triggerCondition: {
      schemaVersion: 1,
      pricingRoutes: [OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL],
    },
    exclusiveGroup: null,
    priority: 100,
    blocksAutomaticQuote: false,
    sourceSheet: '测试基础价',
    sourceRange: 'A1',
    note: null,
    productId,
    category: { code: 'BASE', name: '基础加工费' },
  };
}

function externalAddOnRule({
  id,
  name,
  amount,
  triggerCondition,
}: {
  id: string;
  name: string;
  amount: string;
  triggerCondition: Record<string, unknown>;
}) {
  return {
    ...externalBaseRule({ id, amount, productId: null }),
    name,
    kind: 'ADD_ON',
    calculationType: 'PER_PIECE',
    triggerCondition: {
      schemaVersion: 1,
      pricingRoutes: [OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL],
      ...triggerCondition,
    },
    priority: 50,
    category: { code: 'ADD_ON', name: '附加加工费' },
  };
}

function externalPackagingRule({
  id = 'packaging-single-style',
  mode = OrderPackagingMode.SINGLE_STYLE,
  amount = '0.1000',
}: {
  id?: string;
  mode?: OrderPackagingMode;
  amount?: string;
} = {}) {
  return {
    ...externalBaseRule({ id, amount, productId: null }),
    name: '单款入袋',
    kind: 'ADD_ON',
    calculationType: 'PER_BAG',
    minQty: null,
    maxQty: null,
    triggerCondition: {
      schemaVersion: 1,
      target: 'PACKAGING_GROUP',
      packagingModes: [mode],
    },
    exclusiveGroup: 'PACKAGING_GROUP_MODE',
    blocksAutomaticQuote: false,
    category: { code: 'PACKING', name: '入袋费' },
  };
}

const updateInput = {
  orderId: 'order-1',
  reason: '客户要求把哑金改成浅金',
  items: [
    {
      operation: 'UPDATE' as const,
      itemId: 'item-1',
      name: '红包 A',
      quantity: 1200,
      specification: '中号',
      foilColors: ['浅金'],
    },
  ],
};

function requestableSourceItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    sequence: 1,
    name: '红包 A',
    productId: 'product-1',
    pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
    productStructure: OrderProductStructure.STANDARD_ENVELOPE,
    quantity: 1_000,
    specification: '中号',
    actualWidthMm: new Decimal(210),
    actualHeightMm: new Decimal(105),
    paperType: '艳红珠光纸',
    frontFoilColors: ['哑金'],
    backFoilColors: [],
    foilColors: ['哑金'],
    foilTechnique: OrderFoilTechnique.FLAT,
    hasLocalFoil: false,
    lamination: OrderLamination.NONE,
    printColors: [],
    isDoubleSided: false,
    tasks: [],
    ...overrides,
  };
}

function historicalManualSourceItem(overrides: Record<string, unknown> = {}) {
  return requestableSourceItem({
    pricingRoute: OrderItemPricingRoute.MANUAL_QUOTE,
    productId: null,
    paperType: null,
    frontFoilColors: [],
    backFoilColors: [],
    foilColors: [],
    foilTechnique: OrderFoilTechnique.UNSPECIFIED,
    hasLocalFoil: null,
    ...overrides,
  });
}

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
          specification: '中号',
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
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      billingMode: OrderBillingMode.CHARGE,
      revision: 2,
      pricingStatus: 'ADMIN_CONFIRMED',
      priceRevision: 5,
      status: OrderStatus.IN_PRODUCTION,
      isSfCollect: false,
      packagingAmount: '0.00',
      processingAmount: '1000.00',
      totalAmount: '1000.00',
      items: [
        {
          id: 'item-1',
          sequence: 1,
          name: '红包 A',
          quantity: 1000,
          unitPrice: '1.00',
          fixedFee: '0',
          subtotal: '1000.00',
          productId: 'product-1',
          pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
          productStructure: OrderProductStructure.STANDARD_ENVELOPE,
          artworkVersion: null,
          plateGroupId: null,
          pricingGroup: null,
          manualQuoteReason: null,
          specification: '中号',
          actualWidthMm: new Decimal(210),
          actualHeightMm: new Decimal(105),
          paperType: '艳红珠光纸',
          paperWeightGsm: 160,
          crafts: ['craft-1'],
          frontFoilColors: ['哑金'],
          backFoilColors: [],
          foilColors: ['哑金'],
          foilTechnique: OrderFoilTechnique.FLAT,
          hasLocalFoil: false,
          lamination: OrderLamination.NONE,
          printColors: [],
          isDoubleSided: false,
          isDoubleColor: false,
          suggestedSubtotal: null,
          pricingSnapshot: { version: 1, marker: 'original' },
          priceOverrideReason: null,
          remark: null,
          tasks: [
            {
              id: 'task-1',
              craftId: 'craft-1',
              workerId: 'worker-1',
              workerType: 'MACHINE',
              machineType: 'WINDMILL',
              status: TaskStatus.PENDING,
              plannedQty: 1000,
              isSelfClaimable: false,
              selfClaimOpenedAt: null,
              selfClaimedAt: null,
              claimMachineTypes: [],
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
      shipments: [
        {
          id: 'shipment-1',
          sequence: 1,
          destinationProvince: '广东',
          quotedWeightKg: '12.5',
          weightKg: '2',
        },
      ],
      packagingGroups: [],
      customerCharges: [
        {
          id: 'charge-shipping-1',
          shipmentId: 'shipment-1',
          businessKey: 'SHIPMENT:1:SHIPPING_FEE',
          priceBookId: 'logistics-book-1',
          amount: '4.30',
          overrideReason: null,
          category: { code: 'SHIPPING_FEE' },
        },
        {
          id: 'charge-packing-1',
          shipmentId: 'shipment-1',
          businessKey: 'SHIPMENT:1:PACKING_MATERIAL',
          priceBookId: 'logistics-book-1',
          amount: '5.00',
          overrideReason: '创建工单时已确认耗材费',
          category: { code: 'PACKING_MATERIAL' },
        },
      ],
    },
    ...overrides,
  };
}

function orderWithTwoPackagingGroups() {
  const base = baseReviewRequest().order;
  const secondItem = {
    ...base.items[0],
    id: 'item-2',
    sequence: 2,
    name: '红包 B',
    quantity: 500,
    subtotal: '500.00',
    tasks: [],
    shipmentLines: [
      {
        quantity: 500,
        shipment: { id: 'shipment-1', sequence: 1 },
      },
    ],
  };
  const thirdItem = {
    ...base.items[0],
    id: 'item-3',
    sequence: 3,
    name: '红包 C',
    tasks: [],
  };
  return {
    ...base,
    packagingAmount: '30.00',
    processingAmount: '2530.00',
    totalAmount: '2541.30',
    items: [base.items[0], secondItem, thirdItem],
    customerCharges: base.customerCharges.map((charge) =>
      charge.category.code === 'PACKING_MATERIAL'
        ? { ...charge, amount: '7.00' }
        : charge,
    ),
    packagingGroups: [
      {
        id: 'packaging-group-1',
        sequence: 1,
        name: '单款入袋',
        mode: OrderPackagingMode.SINGLE_STYLE,
        actualBagCount: 100,
        unitPrice: new Decimal('0.1000'),
        subtotal: new Decimal('10.00'),
        suggestedSubtotal: new Decimal('10.00'),
        pricingSnapshot: {
          source: 'ORDER_CREATE_AUTO',
          priceBook: { id: 'old-packaging-book' },
          rule: { id: 'old-single-rule' },
        },
        priceOverrideReason: null,
        lines: [{ orderItemId: 'item-1', unitsPerBag: 10 }],
      },
      {
        id: 'packaging-group-2',
        sequence: 2,
        name: '混装入袋',
        mode: OrderPackagingMode.MIXED_STYLE,
        actualBagCount: 100,
        unitPrice: new Decimal('0.2000'),
        subtotal: new Decimal('20.00'),
        suggestedSubtotal: new Decimal('20.00'),
        pricingSnapshot: {
          source: 'ORDER_CREATE_AUTO',
          priceBook: { id: 'old-packaging-book' },
          rule: { id: 'old-mixed-rule' },
        },
        priceOverrideReason: '历史人工确认',
        lines: [
          { orderItemId: 'item-2', unitsPerBag: 5 },
          { orderItemId: 'item-3', unitsPerBag: 10 },
        ],
      },
    ],
  };
}

function orderWithCrossGroupMembership() {
  const order = orderWithTwoPackagingGroups();
  const [firstGroup, secondGroup] = order.packagingGroups;
  if (!firstGroup || !secondGroup) {
    throw new Error('测试包装组夹具不完整');
  }
  return {
    ...order,
    packagingGroups: [
      firstGroup,
      {
        ...secondGroup,
        lines: [
          ...secondGroup.lines,
          { orderItemId: 'item-1', unitsPerBag: 10 },
        ],
      },
    ],
  };
}

function reviewOrderItems(count: number) {
  const template = baseReviewRequest().order.items[0];
  return Array.from({ length: count }, (_, index) => ({
    ...template,
    id: `item-${index + 1}`,
    sequence: index + 1,
    name: `红包 ${index + 1}`,
  }));
}

function mockFlatFoilCraftCode(
  code:
    | 'FLAT_FOIL_SINGLE'
    | 'FLAT_FOIL_DOUBLE'
    | 'FLAT_FOIL_TRIPLE',
) {
  dbMock.craft.findMany.mockImplementation(
    async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id, code, isActive: true })),
  );
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
  dbMock.orderCustomerCharge.aggregate.mockResolvedValue({
    _sum: { amount: null },
  });
  dbMock.product.findMany.mockResolvedValue([
    {
      id: 'product-1',
      code: 'PRODUCT_1',
      category: 'CUSTOM_FLAT_FOIL',
      isActive: true,
      baseUnitPrice: '1.0000',
    },
  ]);
  mockFlatFoilCraftCode('FLAT_FOIL_SINGLE');
  dbMock.material.findMany.mockImplementation(
    async ({ where }: { where: { name: { in: string[] } } }) =>
      where.name.in.map((name) => ({ name })),
  );
  dbMock.priceTier.findMany.mockResolvedValue([]);
  dbMock.priceAdjustment.findMany.mockResolvedValue([]);
  dbMock.customerPriceBook.findMany.mockImplementation(
    async ({ where }: { where: { purpose?: string } }) =>
      where.purpose === 'LOGISTICS'
        ? [frozenLogisticsPriceBook()]
        : [activeExternalPriceBook],
  );
  dbMock.customerPriceRule.findMany.mockResolvedValue([
    externalBaseRule(),
  ]);
  dbMock.$transaction.mockReset().mockImplementation(
    async (callback: (tx: typeof dbMock) => unknown) => callback(dbMock),
  );
  appendPricingRevisionMock.mockReset().mockResolvedValue({
    priceRevision: 6,
    orderRevision: 3,
    snapshot: {},
  });
  dbMock.productionTask.updateMany.mockResolvedValue({ count: 1 });
  dbMock.productionTask.createMany.mockResolvedValue({ count: 1 });
});

describe('createOrderChangeRequest', () => {
  it('snapshots the current revision without mutating the live order', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.IN_PRODUCTION,
      revision: 2,
      items: [requestableSourceItem()],
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
          proposedChanges: {
            items: [
              {
                operation: 'UPDATE',
                itemId: 'item-1',
                name: '红包 A',
                quantity: 1200,
                specification: '中号',
                frontFoilColors: ['浅金'],
                backFoilColors: [],
              },
            ],
          },
        }),
      }),
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('按正反面持久六色烫金申请，不写入已退役的聚合字段', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED,
      revision: 2,
      items: [requestableSourceItem()],
      changeRequests: [],
    });
    dbMock.orderChangeRequest.create.mockResolvedValue({ id: 'request-1' });

    await createOrderChangeRequest(
      {
        orderId: 'order-1',
        reason: '正反面各三色',
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            frontFoilColors: ['哑金', '红金', '银色'],
            backFoilColors: ['蓝金', '浅金', '古铜金'],
          },
        ],
      },
      salesActor,
    );

    const stored =
      dbMock.orderChangeRequest.create.mock.calls[0]?.[0].data.proposedChanges
        .items[0];
    expect(stored).toMatchObject({
      frontFoilColors: ['哑金', '红金', '银色'],
      backFoilColors: ['蓝金', '浅金', '古铜金'],
    });
    expect(stored).not.toHaveProperty('foilColors');
    expect(stored).not.toHaveProperty('isDoubleSided');
    expect(stored).not.toHaveProperty('isDoubleColor');
  });

  it('复用新建工单校验，拒绝把专版烫金改成正反面都无颜色', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED,
      revision: 2,
      items: [requestableSourceItem()],
      changeRequests: [],
    });

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          reason: '清空烫金颜色',
          items: [
            {
              operation: 'UPDATE',
              itemId: 'item-1',
              frontFoilColors: [],
              backFoilColors: [],
            },
          ],
        },
        salesActor,
      ),
    ).rejects.toThrow(/专版烫金必须选择至少 1 种烫金颜色/);

    expect(dbMock.orderChangeRequest.create).not.toHaveBeenCalled();
  });

  it('非烫金修改不在申请快照中填入烫金事实', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED,
      revision: 2,
      items: [
        requestableSourceItem({
          frontFoilColors: [],
          backFoilColors: [],
          foilColors: ['哑金'],
          isDoubleSided: true,
        }),
      ],
      changeRequests: [],
    });
    dbMock.orderChangeRequest.create.mockResolvedValue({ id: 'request-1' });

    await createOrderChangeRequest(
      {
        orderId: 'order-1',
        reason: '只修改名称',
        items: [
          { operation: 'UPDATE', itemId: 'item-1', name: '红包 A 新名称' },
        ],
      },
      salesActor,
    );

    expect(
      dbMock.orderChangeRequest.create.mock.calls[0]?.[0].data.proposedChanges
        .items[0],
    ).toEqual({
      operation: 'UPDATE',
      itemId: 'item-1',
      name: '红包 A 新名称',
    });
  });

  it('历史人工报价款式可以申请仅修改名称', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED,
      revision: 2,
      items: [historicalManualSourceItem()],
      changeRequests: [],
    });
    dbMock.orderChangeRequest.create.mockResolvedValue({ id: 'request-1' });

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          reason: '更新客户款式名',
          items: [
            {
              operation: 'UPDATE',
              itemId: 'item-1',
              name: '历史人工报价款新名称',
            },
          ],
        },
        salesActor,
      ),
    ).resolves.toEqual({ id: 'request-1' });

    expect(dbMock.orderChangeRequest.create).toHaveBeenCalledTimes(1);
  });

  it('历史人工报价款式不能作为新增款式模板', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED,
      revision: 2,
      items: [historicalManualSourceItem()],
      changeRequests: [],
    });

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          reason: '新增人工报价款',
          items: [
            {
              operation: 'ADD',
              templateItemId: 'item-1',
              name: '新款',
              quantity: 1_000,
            },
          ],
        },
        salesActor,
      ),
    ).rejects.toThrow(/历史人工报价路线.*不能作为新增款式模板/);

    expect(dbMock.orderChangeRequest.create).not.toHaveBeenCalled();
  });

  it.each([
    ['数量', { quantity: 1_200 }],
    ['正面烫金颜色', { frontFoilColors: ['金色'] }],
    ['反面烫金颜色', { backFoilColors: ['金色'] }],
  ])('历史人工报价款式拒绝修改%s', async (_label, change) => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED,
      revision: 2,
      items: [historicalManualSourceItem()],
      changeRequests: [],
      packagingGroups: [],
    });

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          reason: '修改历史人工报价事实',
          items: [
            {
              operation: 'UPDATE',
              itemId: 'item-1',
              ...change,
            },
          ],
        },
        salesActor,
      ),
    ).rejects.toThrow(/历史人工报价路线.*只允许更新名称/);

    expect(dbMock.orderChangeRequest.create).not.toHaveBeenCalled();
  });

  it('已有包装组时在创建申请阶段拒绝 ADD，不占用待审槽位', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED,
      revision: 2,
      items: [requestableSourceItem()],
      changeRequests: [],
      packagingGroups: [
        {
          id: 'packaging-group-1',
          sequence: 1,
          lines: [{ orderItemId: 'item-1' }],
        },
      ],
    });

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          reason: '新增一款',
          items: [
            {
              operation: 'ADD',
              templateItemId: 'item-1',
              name: '红包 B',
              quantity: 1_000,
            },
          ],
        },
        salesActor,
      ),
    ).rejects.toThrow(/已有包装组.*新增款式必须同时指定每袋组成/);

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.orderChangeRequest.create).not.toHaveBeenCalled();
  });

  it('创建数量修改申请时拒绝同一款式跨包装组', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED,
      revision: 2,
      items: [requestableSourceItem()],
      changeRequests: [],
      packagingGroups: [
        {
          id: 'packaging-group-1',
          sequence: 1,
          lines: [{ orderItemId: 'item-1' }],
        },
        {
          id: 'packaging-group-2',
          sequence: 2,
          lines: [{ orderItemId: 'item-1' }],
        },
      ],
    });

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          reason: '修改数量',
          items: [
            { operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 },
          ],
        },
        salesActor,
      ),
    ).rejects.toThrow(/同时归属包装组 1 和 2/);

    expect(dbMock.orderChangeRequest.create).not.toHaveBeenCalled();
  });

  it('款式已开工时拒绝提交规格修改', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.IN_PRODUCTION,
      revision: 2,
      items: [
        requestableSourceItem({
          tasks: [{ status: TaskStatus.IN_PROGRESS }],
        }),
      ],
      changeRequests: [],
    });

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          reason: '修改规格',
          items: [
            { operation: 'UPDATE', itemId: 'item-1', specification: '大号' },
          ],
        },
        salesActor,
      ),
    ).rejects.toThrow(/规格与产品 SKU.*不支持单独改规格/);
    expect(dbMock.orderChangeRequest.create).not.toHaveBeenCalled();
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

  it('rejects duplicate UPDATE entries for the same item before persisting', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED,
      revision: 1,
      items: [{ id: 'item-1' }],
      changeRequests: [],
    });

    await expect(
      createOrderChangeRequest(
        {
          ...updateInput,
          items: [
            updateInput.items[0],
            { ...updateInput.items[0], quantity: 1300 },
          ],
        },
        salesActor,
      ),
    ).rejects.toThrow(/同一款式不能重复/);
    expect(dbMock.orderChangeRequest.create).not.toHaveBeenCalled();
  });

  it('rejects an addition that would exceed 50 live items while holding the order lock', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED,
      revision: 2,
      items: reviewOrderItems(50),
      changeRequests: [],
    });

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          reason: '新增一个款式',
          items: [
            {
              operation: 'ADD',
              templateItemId: 'item-1',
              name: '红包 51',
              quantity: 1_000,
              specification: '大号',
              foilColors: ['哑金'],
            },
          ],
        },
        salesActor,
      ),
    ).rejects.toThrow(/单工单款式不超过 50 项.*当前 50 项.*新增 1 项/);

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.order.findUnique.mock.invocationCallOrder[0]!,
    );
    expect(dbMock.orderChangeRequest.create).not.toHaveBeenCalled();
  });
});

describe('previewOrderChangeRequestPricing', () => {
  it('shows authoritative old/new totals, delta and each quoted style without writing', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            quantity: 1200,
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({
        id: 'tier-1200',
        amount: '0.8000',
        minQty: 1200,
      }),
    ]);

    const preview = await previewOrderChangeRequestPricing(
      'request-1',
      adminActor,
    );

    expect(preview).toMatchObject({
      requestId: 'request-1',
      orderId: 'order-1',
      baseRevision: 2,
      complete: true,
      requiresReviewRemark: false,
      oldTotal: '1000.00',
      newTotal: '960.00',
      delta: '-40.00',
      items: [
        expect.objectContaining({
          operation: 'UPDATE',
          name: '红包 A',
          quantity: 1200,
          priceImpact: 'QUOTED',
          oldSubtotal: '1000.00',
          newSubtotal: '960.00',
          suggestedUnitPrice: '0.8000',
          suggestedFixedFee: '0.00',
          errors: [],
        }),
      ],
    });
    expect(preview.quotedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderChangeRequest.update).not.toHaveBeenCalled();
  });

  it('withholds the new total and explains every incomplete quote instead of implying a carried price', async () => {
    mockFlatFoilCraftCode('FLAT_FOIL_DOUBLE');
    const request = baseReviewRequest();
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([]);

    const preview = await previewOrderChangeRequestPricing(
      'request-1',
      adminActor,
    );

    expect(preview).toMatchObject({
      complete: false,
      requiresReviewRemark: true,
      oldTotal: '1000.00',
      newTotal: null,
      delta: null,
      items: [
        expect.objectContaining({
          priceImpact: 'INCOMPLETE',
          oldSubtotal: '1000.00',
          newSubtotal: null,
          suggestedUnitPrice: null,
          errors: expect.arrayContaining([
            expect.stringMatching(/报价单未覆盖当前产品/),
          ]),
        }),
      ],
    });
  });

  it('does not trust a preview price when approval observes a newer rule', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            quantity: 1200,
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request)
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([
        externalBaseRule({
          id: 'preview-tier',
          amount: '0.8000',
          minQty: 1200,
        }),
      ])
      .mockResolvedValueOnce([
        externalBaseRule({
          id: 'approval-tier',
          amount: '0.7000',
          minQty: 1200,
        }),
      ]);

    const preview = await previewOrderChangeRequestPricing(
      'request-1',
      adminActor,
    );
    expect(preview.newTotal).toBe('960.00');

    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '840.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });
    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        unitPrice: '0.7000',
        subtotal: '840.00',
        pricingSnapshot: expect.objectContaining({
          base: expect.objectContaining({ sourceId: 'approval-tier' }),
        }),
      }),
    });
  });

  it('预览阶段拒绝历史人工报价款式的数量变更', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          { operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 },
        ],
      },
      order: {
        ...base.order,
        items: [
          {
            ...base.order.items[0],
            productId: null,
            pricingRoute: OrderItemPricingRoute.MANUAL_QUOTE,
            manualQuoteReason: '历史人工报价',
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);

    await expect(
      previewOrderChangeRequestPricing('request-1', adminActor),
    ).rejects.toThrow(/历史人工报价路线.*只允许更新名称/);

    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
  });

  it('预览阶段拒绝同一款式跨包装组重复计费', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          { operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 },
        ],
      },
      order: orderWithCrossGroupMembership(),
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);

    await expect(
      previewOrderChangeRequestPricing('request-1', adminActor),
    ).rejects.toThrow(/同时归属包装组 1 和 2/);

    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
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

  it('rejects a legacy pending addition when the live order already has 50 items', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'ADD',
            templateItemId: 'item-1',
            name: '红包 51',
            quantity: 1_000,
            specification: '大号',
            foilColors: ['哑金'],
          },
        ],
      },
      order: {
        ...base.order,
        items: reviewOrderItems(50),
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
    ).rejects.toThrow(/单工单款式不超过 50 项.*当前 50 项.*新增 1 项/);

    expect(dbMock.product.findMany).not.toHaveBeenCalled();
    expect(dbMock.craft.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceTier.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceAdjustment.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderItem.create).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('批准历史人工报价款式的名称修改时不强制新计价路线', async () => {
    const base = baseReviewRequest();
    const manualItem = {
      ...base.order.items[0],
      productId: null,
      pricingRoute: OrderItemPricingRoute.MANUAL_QUOTE,
      manualQuoteReason: '历史人工报价',
      paperType: null,
      frontFoilColors: [],
      backFoilColors: [],
      foilColors: [],
      foilTechnique: OrderFoilTechnique.UNSPECIFIED,
      hasLocalFoil: null,
    };
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            name: '人工报价款新名称',
          },
        ],
      },
      order: { ...base.order, items: [manualItem] },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1000.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    const updateData = dbMock.orderItem.update.mock.calls[0]?.[0].data;
    expect(updateData.name).toBe('人工报价款新名称');
    expect(updateData).not.toHaveProperty('pricingSnapshot');
    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
  });

  it('审批阶段拒绝历史人工报价款式的烫金事实变更', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            frontFoilColors: ['金色'],
          },
        ],
      },
      order: {
        ...base.order,
        items: [
          {
            ...base.order.items[0],
            productId: null,
            pricingRoute: OrderItemPricingRoute.MANUAL_QUOTE,
            manualQuoteReason: '历史人工报价',
            paperType: null,
            frontFoilColors: [],
            backFoilColors: [],
            foilColors: [],
            foilTechnique: OrderFoilTechnique.UNSPECIFIED,
            hasLocalFoil: null,
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
    ).rejects.toThrow(/历史人工报价路线.*只允许更新名称/);

    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
  });

  it('审核历史待处理申请时仍拒绝复制人工报价款', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'ADD',
            templateItemId: 'item-1',
            name: '新增人工报价款',
            quantity: 1_000,
            specification: null,
          },
        ],
      },
      order: {
        ...base.order,
        items: [
          {
            ...base.order.items[0],
            productId: null,
            pricingRoute: OrderItemPricingRoute.MANUAL_QUOTE,
            manualQuoteReason: '历史人工报价',
            paperType: null,
            frontFoilColors: [],
            backFoilColors: [],
            foilColors: [],
            foilTechnique: OrderFoilTechnique.UNSPECIFIED,
            hasLocalFoil: null,
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
    ).rejects.toThrow(/历史人工报价路线.*不能作为新增款式模板/);

    expect(dbMock.orderItem.create).not.toHaveBeenCalled();
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

  it.each([
    {
      label: '规格',
      status: TaskStatus.IN_PROGRESS,
      change: { specification: '大号' },
      expected: /规格与产品 SKU.*不支持单独改规格/,
    },
    {
      label: '烫金参数',
      status: TaskStatus.COMPLETED,
      change: { frontFoilColors: ['红金'] },
      expected: /已有开工或完工记录.*规格或烫金/,
    },
    {
      label: '历史聚合烫金参数',
      status: TaskStatus.IN_PROGRESS,
      change: { foilColors: ['红金'] },
      expected: /已有开工或完工记录.*规格或烫金/,
    },
  ])(
    '款式已生产时拒绝修改$label',
    async ({ status, change, expected }) => {
      const request = baseReviewRequest({
        proposedChanges: {
          items: [
            {
              operation: 'UPDATE',
              itemId: 'item-1',
              ...change,
            },
          ],
        },
      });
      (
        request.order.items[0].tasks[0] as { status: TaskStatus }
      ).status = status;
      dbMock.orderChangeRequest.findUnique
        .mockResolvedValueOnce({ orderId: 'order-1' })
        .mockResolvedValueOnce(request);

      await expect(
        reviewOrderChangeRequest(
          { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
          adminActor,
        ),
      ).rejects.toThrow(expected);
      expect(dbMock.orderItem.update).not.toHaveBeenCalled();
      expect(dbMock.product.findMany).not.toHaveBeenCalled();
    },
  );

  it('未开工也拒绝用旧 SKU 自动报价新规格', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            specification: '大号',
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
    ).rejects.toThrow(/规格与产品 SKU.*不支持单独改规格/);

    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
  });

  it('正反面各三色可进入版本引擎，未覆盖时由管理员说明后沿用成交价', async () => {
    mockFlatFoilCraftCode('FLAT_FOIL_TRIPLE');
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            frontFoilColors: ['哑金', '红金', '银色'],
            backFoilColors: ['蓝金', '浅金', '古铜金'],
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([]);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1000.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      {
        requestId: 'request-1',
        decision: 'APPROVE',
        reviewRemark: '当前价目未覆盖专版双面，已人工确认',
      },
      adminActor,
    );

    expect(dbMock.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        frontFoilColors: ['哑金', '红金', '银色'],
        backFoilColors: ['蓝金', '浅金', '古铜金'],
        isDoubleSided: true,
        pricingSnapshot: expect.objectContaining({
          source: 'CHANGE_REQUEST_PRICE_CARRY_FORWARD',
        }),
        priceOverrideReason:
          '当前价目未覆盖专版双面，已人工确认',
      }),
    });
  });

  it('按工艺组守恒重分配待处理的拆分任务', async () => {
    const base = baseReviewRequest();
    const templateTask = base.order.items[0].tasks[0];
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          { operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 },
        ],
      },
      order: {
        ...base.order,
        items: [
          {
            ...base.order.items[0],
            tasks: [
              {
                ...templateTask,
                id: 'task-a',
                craftId: 'craft-1',
                plannedQty: 600,
              },
              {
                ...templateTask,
                id: 'task-b',
                craftId: 'craft-1',
                plannedQty: 400,
              },
              {
                ...templateTask,
                id: 'task-c',
                craftId: 'craft-2',
                plannedQty: 500,
              },
              {
                ...templateTask,
                id: 'task-d',
                craftId: 'craft-2',
                plannedQty: 500,
              },
            ],
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '0.8000', minQty: 1_200 }),
    ]);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '960.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    const allocations = new Map<string, number>(
      dbMock.productionTask.updateMany.mock.calls.map(([command]) => [
        command.where.id,
        command.data.plannedQty,
      ]),
    );
    expect(allocations).toEqual(
      new Map([
        ['task-a', 720],
        ['task-b', 480],
        ['task-c', 600],
        ['task-d', 600],
      ]),
    );
    expect(
      (allocations.get('task-a') ?? 0) + (allocations.get('task-b') ?? 0),
    ).toBe(1_200);
    expect(
      (allocations.get('task-c') ?? 0) + (allocations.get('task-d') ?? 0),
    ).toBe(1_200);
    expect(dbMock.productionTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-a',
        orderItemId: 'item-1',
        status: TaskStatus.PENDING,
        plannedQty: 600,
      },
      data: { plannedQty: 720 },
    });
  });

  it('排产任务在事务内发生并发变更时中止批准', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          { operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '0.8000', minQty: 1_200 }),
    ]);
    dbMock.productionTask.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/排产任务已变更.*重新审核/);

    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.$executeRaw).toHaveBeenCalled();
  });

  it('re-quotes an approved foil change and increments the revision', async () => {
    mockFlatFoilCraftCode('FLAT_FOIL_DOUBLE');
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
      data: expect.objectContaining({
        name: '红包 A（新版）',
        quantity: undefined,
        specification: '中号',
        frontFoilColors: ['浅金', '红金'],
        backFoilColors: [],
        foilColors: ['浅金', '红金'],
        isDoubleSided: false,
        isDoubleColor: true,
        subtotal: '1000.00',
        unitPrice: '1.0000',
        fixedFee: '0.00',
        suggestedSubtotal: '1000.00',
        pricingSnapshot: expect.objectContaining({
          source: 'CHANGE_REQUEST_REQUOTE',
          requestId: 'request-1',
          actual: expect.objectContaining({
            quantity: 1000,
            unitPrice: '1.0000',
            fixedFee: '0.00',
            subtotal: '1000.00',
            overrideReason: null,
          }),
        }),
        priceOverrideReason: null,
      }),
    });
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        revision: 3,
        processingAmount: '1000.00',
        totalAmount: '1000.00',
      },
    });
    expect(dbMock.orderLog.create).toHaveBeenCalledTimes(1);
    expect(appendPricingRevisionMock).toHaveBeenCalledWith(
      dbMock,
      expect.objectContaining({
        orderId: 'order-1',
        status: 'PENDING_ADMIN_CONFIRMATION',
        source: 'CHANGE_REQUEST_APPLIED_PENDING',
        expectedPriceRevision: 5,
        incrementOrderRevision: false,
      }),
    );
  });

  it('re-quotes a quantity change across a price tier using one transaction timestamp', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            quantity: 1200,
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({
        id: 'tier-1200',
        amount: '0.8000',
        minQty: 1200,
      }),
    ]);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '960.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledTimes(2);
    expect(dbMock.customerPriceRule.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.priceTier.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceAdjustment.findMany).not.toHaveBeenCalled();
    const bookQuery = dbMock.customerPriceBook.findMany.mock.calls[0]?.[0];
    expect(bookQuery.where.effectiveFrom.lte).toBeInstanceOf(Date);
    expect(bookQuery.where.OR[1].effectiveTo.gt).toBe(
      bookQuery.where.effectiveFrom.lte,
    );
    expect(
      dbMock.customerPriceBook.findMany.mock.calls[1]?.[0].where,
    ).toMatchObject({
      id: 'logistics-book-1',
      purpose: 'LOGISTICS',
    });
    expect(dbMock.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        quantity: 1200,
        unitPrice: '0.8000',
        fixedFee: '0.00',
        subtotal: '960.00',
        suggestedSubtotal: '960.00',
        priceOverrideReason: null,
        pricingSnapshot: expect.objectContaining({
          requestId: 'request-1',
          source: 'CHANGE_REQUEST_REQUOTE',
          base: expect.objectContaining({ sourceId: 'tier-1200' }),
        }),
      }),
    });
  });

  it('数量修改后从每袋组成重算实际袋数，并按当前价目刷新入袋费证据', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            quantity: 1_200,
          },
        ],
      },
      order: {
        ...base.order,
        packagingAmount: '10.00',
        processingAmount: '1010.00',
        totalAmount: '1019.30',
        packagingGroups: [
          {
            id: 'packaging-group-1',
            sequence: 1,
            name: '单款入袋',
            mode: OrderPackagingMode.SINGLE_STYLE,
            actualBagCount: 100,
            unitPrice: new Decimal('0.1000'),
            subtotal: new Decimal('10.00'),
            suggestedSubtotal: new Decimal('10.00'),
            pricingSnapshot: { source: 'ORDER_CREATE_AUTO' },
            priceOverrideReason: null,
            lines: [
              {
                orderItemId: 'item-1',
                unitsPerBag: 10,
              },
            ],
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([
        externalBaseRule({
          id: 'tier-1200',
          amount: '0.8000',
          minQty: 1_200,
        }),
      ])
      .mockResolvedValueOnce([externalPackagingRule()]);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '960.00' }]);
    dbMock.orderCustomerCharge.aggregate.mockResolvedValue({
      _sum: { amount: '9.30' },
    });
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.orderPackagingGroup.update).toHaveBeenCalledWith({
      where: { id: 'packaging-group-1' },
      data: {
        actualBagCount: 120,
        unitPrice: '0.1000',
        subtotal: '12.00',
        suggestedSubtotal: '12.00',
        pricingSnapshot: expect.objectContaining({
          source: 'CHANGE_REQUEST_REQUOTE',
          requestId: 'request-1',
          input: expect.objectContaining({ actualBagCount: 120 }),
          actual: {
            unitPrice: '0.1000',
            subtotal: '12.00',
            overrideReason: null,
          },
        }),
        priceOverrideReason: null,
      },
    });
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        revision: 3,
        packagingAmount: '12.00',
        processingAmount: '972.00',
        totalAmount: '981.30',
      },
    });
  });

  it('外部工单按组内每袋组成重算多包装组，并记录前后证据', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          { operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 },
          { operation: 'UPDATE', itemId: 'item-2', quantity: 600 },
          { operation: 'UPDATE', itemId: 'item-3', quantity: 1_200 },
        ],
      },
      order: orderWithTwoPackagingGroups(),
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([
        externalBaseRule({
          id: 'tier-1200',
          amount: '0.8000',
          minQty: 600,
        }),
      ])
      .mockResolvedValueOnce([
        externalPackagingRule({
          id: 'packaging-single-current',
          mode: OrderPackagingMode.SINGLE_STYLE,
          amount: '0.1000',
        }),
        externalPackagingRule({
          id: 'packaging-mixed-current',
          mode: OrderPackagingMode.MIXED_STYLE,
          amount: '0.2000',
        }),
      ]);
    dbMock.orderItem.findMany.mockResolvedValue([
      { subtotal: '960.00' },
      { subtotal: '480.00' },
      { subtotal: '960.00' },
    ]);
    dbMock.orderCustomerCharge.aggregate.mockResolvedValue({
      _sum: { amount: '11.30' },
    });
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      {
        requestId: 'request-1',
        decision: 'APPROVE',
        reviewRemark: '多款物流金额已人工确认',
      },
      adminActor,
    );

    expect(dbMock.orderPackagingGroup.update).toHaveBeenCalledTimes(2);
    expect(dbMock.orderPackagingGroup.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'packaging-group-1' },
      data: expect.objectContaining({
        actualBagCount: 120,
        unitPrice: '0.1000',
        subtotal: '12.00',
      }),
    });
    expect(dbMock.orderPackagingGroup.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'packaging-group-2' },
      data: expect.objectContaining({
        actualBagCount: 120,
        unitPrice: '0.2000',
        subtotal: '24.00',
      }),
    });
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        revision: 3,
        packagingAmount: '36.00',
        processingAmount: '2436.00',
        totalAmount: '2447.30',
      },
    });
    expect(dbMock.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changedFields: expect.objectContaining({
          packagingAmount: { before: '30.00', after: '36.00' },
          packagingGroups: [
            expect.objectContaining({
              groupId: 'packaging-group-1',
              sequence: 1,
              before: expect.objectContaining({
                actualBagCount: 100,
                unitPrice: '0.1000',
                subtotal: '10.00',
                pricingSource: 'ORDER_CREATE_AUTO',
                priceBookId: 'old-packaging-book',
                ruleId: 'old-single-rule',
              }),
              after: expect.objectContaining({
                actualBagCount: 120,
                subtotal: '12.00',
                pricingSource: 'CHANGE_REQUEST_REQUOTE',
                priceBookId: 'external-book-test',
                ruleId: 'packaging-single-current',
              }),
            }),
            expect.objectContaining({
              groupId: 'packaging-group-2',
              sequence: 2,
              before: expect.objectContaining({
                actualBagCount: 100,
                overrideReason: '历史人工确认',
              }),
              after: expect.objectContaining({
                actualBagCount: 120,
                subtotal: '24.00',
                pricingSource: 'CHANGE_REQUEST_REQUOTE',
                ruleId: 'packaging-mixed-current',
                overrideReason: null,
              }),
            }),
          ],
        }),
      }),
    });
  });

  it('内部工单重算多包装组时保留存量单价并写入不可变审计证据', async () => {
    const order = orderWithTwoPackagingGroups();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          { operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 },
          { operation: 'UPDATE', itemId: 'item-2', quantity: 600 },
          { operation: 'UPDATE', itemId: 'item-3', quantity: 1_200 },
        ],
      },
      order: {
        ...order,
        settlementType: OrderSettlementType.INTERNAL_SALES,
        status: OrderStatus.DRAFT,
        totalAmount: '2530.00',
        customerCharges: [],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.findMany.mockResolvedValue([
      { subtotal: '1200.00' },
      { subtotal: '600.00' },
      { subtotal: '1200.00' },
    ]);
    dbMock.orderCustomerCharge.aggregate.mockResolvedValue({
      _sum: { amount: null },
    });
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderPackagingGroup.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'packaging-group-1' },
      data: expect.objectContaining({
        actualBagCount: 120,
        unitPrice: '0.1000',
        subtotal: '12.00',
        suggestedSubtotal: null,
        pricingSnapshot: expect.objectContaining({
          source: 'CHANGE_REQUEST_STORED_RATE_RECALC',
        }),
      }),
    });
    expect(dbMock.orderPackagingGroup.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'packaging-group-2' },
      data: expect.objectContaining({
        actualBagCount: 120,
        unitPrice: '0.2000',
        subtotal: '24.00',
        priceOverrideReason: '历史人工确认',
      }),
    });
    expect(dbMock.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changedFields: expect.objectContaining({
          packagingAmount: { before: '30.00', after: '36.00' },
          packagingGroups: [
            expect.objectContaining({
              groupId: 'packaging-group-1',
              before: expect.objectContaining({
                pricingSource: 'ORDER_CREATE_AUTO',
                ruleId: 'old-single-rule',
              }),
              after: expect.objectContaining({
                actualBagCount: 120,
                unitPrice: '0.1000',
                subtotal: '12.00',
                pricingSource: 'CHANGE_REQUEST_STORED_RATE_RECALC',
              }),
            }),
            expect.objectContaining({
              groupId: 'packaging-group-2',
              before: expect.objectContaining({
                overrideReason: '历史人工确认',
              }),
              after: expect.objectContaining({
                actualBagCount: 120,
                unitPrice: '0.2000',
                subtotal: '24.00',
                pricingSource: 'CHANGE_REQUEST_STORED_RATE_RECALC',
                overrideReason: '历史人工确认',
              }),
            }),
          ],
        }),
      }),
    });
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        revision: 3,
        packagingAmount: '36.00',
        processingAmount: '3036.00',
        totalAmount: '3036.00',
      },
    });
  });

  it.each([
    ['外部销售', OrderSettlementType.EXTERNAL_SALES, OrderStatus.IN_PRODUCTION],
    ['内部销售', OrderSettlementType.INTERNAL_SALES, OrderStatus.DRAFT],
  ])('%s工单审批时拒绝同一款式跨包装组', async (
    _label,
    settlementType,
    status,
  ) => {
    const order = orderWithCrossGroupMembership();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          { operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 },
        ],
      },
      order: {
        ...order,
        settlementType,
        status,
        ...(settlementType === OrderSettlementType.INTERNAL_SALES
          ? { totalAmount: '2530.00', customerCharges: [] }
          : {}),
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
    ).rejects.toThrow(/同时归属包装组 1 和 2/);

    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.orderPackagingGroup.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('已有包装组时拒绝不带每袋组成的新增款式', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'ADD',
            templateItemId: 'item-1',
            name: '红包 C',
            quantity: 600,
            specification: null,
          },
        ],
      },
      order: orderWithTwoPackagingGroups(),
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/已有包装组.*新增款式必须同时指定每袋组成/);

    expect(dbMock.orderItem.create).not.toHaveBeenCalled();
    expect(dbMock.orderPackagingGroup.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('包装组事实或当前入袋规则不完整时失败关闭，不复用旧 packagingAmount', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            quantity: 1_200,
          },
        ],
      },
      order: {
        ...base.order,
        packagingAmount: '10.00',
        packagingGroups: [
          {
            id: 'packaging-group-1',
            sequence: 1,
            name: '单款入袋',
            mode: OrderPackagingMode.SINGLE_STYLE,
            actualBagCount: 100,
            unitPrice: new Decimal('0.1000'),
            subtotal: new Decimal('10.00'),
            suggestedSubtotal: new Decimal('10.00'),
            pricingSnapshot: { source: 'ORDER_CREATE_AUTO' },
            priceOverrideReason: null,
            lines: [
              {
                orderItemId: 'item-1',
                unitsPerBag: 10,
              },
            ],
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([
        externalBaseRule({
          id: 'tier-1200',
          amount: '0.8000',
          minQty: 1_200,
        }),
      ])
      .mockResolvedValueOnce([]);

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: 'request-1',
          decision: 'APPROVE',
          reviewRemark: '不允许说明绕过结构化入袋规则',
        },
        adminActor,
      ),
    ).rejects.toThrow(/无法按当前规则重算入袋费/);

    expect(dbMock.orderPackagingGroup.update).not.toHaveBeenCalled();
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('requires an audit remark before retaining a confirmed logistics amount that differs after re-tiering', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            quantity: 1200,
          },
        ],
      },
      order: {
        ...base.order,
        customerCharges: base.order.customerCharges.map((charge) =>
          charge.category.code === 'PACKING_MATERIAL'
            ? { ...charge, amount: '3.00', overrideReason: null }
            : charge,
        ),
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({
        id: 'tier-1200',
        amount: '0.8000',
        minQty: 1200,
      }),
    ]);

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/3\.00 元.*5\.00 元.*请填写审核备注/);

    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderChangeRequest.update).not.toHaveBeenCalled();
  });

  it('refreshes every frozen logistics snapshot while preserving actual and unrelated charges', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            quantity: 1200,
          },
        ],
      },
      order: {
        ...base.order,
        totalAmount: '1107.30',
        customerCharges: [
          ...base.order.customerCharges.map((charge) =>
            charge.category.code === 'PACKING_MATERIAL'
              ? { ...charge, amount: '3.00', overrideReason: null }
              : charge,
          ),
          {
            id: 'charge-other-1',
            shipmentId: null,
            businessKey: 'ORDER:OTHER:1',
            priceBookId: null,
            amount: '100.00',
            overrideReason: '管理员确认其他收费',
            category: { code: 'OTHER' },
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({
        id: 'tier-1200',
        amount: '0.8000',
        minQty: 1200,
      }),
    ]);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '960.00' }]);
    dbMock.orderCustomerCharge.aggregate.mockResolvedValue({
      _sum: { amount: '107.30' },
    });
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      {
        requestId: 'request-1',
        decision: 'APPROVE',
        reviewRemark: '耗材数量跨档，保留已与客户确认的收费',
      },
      adminActor,
    );

    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledTimes(2);
    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledWith({
      where: { id: 'charge-shipping-1' },
      data: expect.objectContaining({
        sourceRuleId: 'shipping-guangdong',
        quantity: '2',
        unit: 'kg',
        suggestedAmount: '4.30',
        overrideReason: null,
        pricingSnapshot: expect.objectContaining({
          priceBook: expect.objectContaining({ id: 'logistics-book-1' }),
          actual: expect.objectContaining({
            amount: '4.30',
            overrideReason: null,
          }),
          changeRequestRefresh: expect.objectContaining({
            requestId: 'request-1',
          }),
        }),
      }),
    });
    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledWith({
      where: { id: 'charge-packing-1' },
      data: expect.objectContaining({
        sourceRuleId: 'packing-CARTON_Q1001_2000',
        quantity: '1200',
        unit: '个',
        suggestedAmount: '5.00',
        overrideReason: '耗材数量跨档，保留已与客户确认的收费',
        pricingSnapshot: expect.objectContaining({
          priceBook: expect.objectContaining({ id: 'logistics-book-1' }),
          actual: expect.objectContaining({
            amount: '3.00',
            overrideReason:
              '耗材数量跨档，保留已与客户确认的收费',
          }),
          changeRequestRefresh: expect.objectContaining({
            requestId: 'request-1',
          }),
        }),
      }),
    });
    for (const call of dbMock.orderCustomerCharge.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('amount');
      expect(call[0].data).not.toHaveProperty('status');
    }
    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'charge-other-1' } }),
    );
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        revision: 3,
        processingAmount: '960.00',
        totalAmount: '1067.30',
      },
    });
  });

  it('re-quotes a foil-color change with the per-color multiplier', async () => {
    mockFlatFoilCraftCode('FLAT_FOIL_DOUBLE');
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(baseReviewRequest());
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule(),
      externalAddOnRule({
        id: 'foil-per-color',
        name: '每色烫金费',
        amount: '0.1000',
        triggerCondition: { perFoilColor: true },
      }),
    ]);
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

    expect(dbMock.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        frontFoilColors: ['浅金', '红金'],
        backFoilColors: [],
        foilColors: ['浅金', '红金'],
        isDoubleSided: false,
        isDoubleColor: true,
        unitPrice: '1.2000',
        subtotal: '1200.00',
        pricingSnapshot: expect.objectContaining({
          components: expect.arrayContaining([
            expect.objectContaining({
              sourceId: 'foil-per-color',
              units: '2000',
              amount: '200.00',
            }),
          ]),
        }),
      }),
    });
  });

  it('旧申请的 null 规格按未覆盖处理，新增款式继承模板规格', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'ADD',
            templateItemId: 'item-1',
            name: '红包 B',
            quantity: 1200,
            specification: null,
            foilColors: ['浅金'],
          },
        ],
      },
      order: {
        ...base.order,
        items: reviewOrderItems(49),
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({
        id: 'tier-1200',
        amount: '0.8000',
        minQty: 1200,
      }),
    ]);
    dbMock.orderItem.create.mockResolvedValue({ id: 'item-2' });
    dbMock.orderItem.findMany.mockResolvedValue([
      { subtotal: '1000.00' },
      { subtotal: '960.00' },
    ]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      {
        requestId: 'request-1',
        decision: 'APPROVE',
        reviewRemark: '整单数量超过中通自动报价范围，沿用历史运费待后续确认',
      },
      adminActor,
    );

    expect(dbMock.orderItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        sequence: 50,
        name: '红包 B',
        productId: 'product-1',
        specification: '中号',
        paperType: '艳红珠光纸',
        quantity: 1200,
        crafts: ['craft-1'],
        foilColors: ['浅金'],
        unitPrice: '0.8000',
        fixedFee: '0.00',
        subtotal: '960.00',
        suggestedSubtotal: '960.00',
        priceOverrideReason: null,
        pricingSnapshot: expect.objectContaining({
          requestId: 'request-1',
          source: 'CHANGE_REQUEST_REQUOTE',
          input: expect.objectContaining({ orderItemCount: 50 }),
        }),
      }),
      select: { id: true },
    });
    expect(dbMock.orderShipmentLine.create).toHaveBeenCalledWith({
      data: {
        shipmentId: 'shipment-1',
        orderItemId: 'item-2',
        quantity: 1200,
      },
    });
  });

  it('新增款式复制拆分模板时每个工艺组总量等于新款数量', async () => {
    const base = baseReviewRequest();
    const templateTask = base.order.items[0].tasks[0];
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'ADD',
            templateItemId: 'item-1',
            name: '红包 B',
            quantity: 1_200,
            specification: '中号',
            frontFoilColors: ['浅金'],
            backFoilColors: [],
          },
        ],
      },
      order: {
        ...base.order,
        items: [
          {
            ...base.order.items[0],
            tasks: [
              {
                ...templateTask,
                id: 'task-a',
                craftId: 'craft-1',
                plannedQty: 600,
              },
              {
                ...templateTask,
                id: 'task-b',
                craftId: 'craft-1',
                plannedQty: 400,
              },
              {
                ...templateTask,
                id: 'task-c',
                craftId: 'craft-2',
                plannedQty: 1_000,
              },
              {
                ...templateTask,
                id: 'task-cancelled',
                craftId: 'craft-1',
                plannedQty: 1_000,
                status: TaskStatus.CANCELLED,
              },
            ],
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '0.8000', minQty: 1_200 }),
    ]);
    dbMock.orderItem.create.mockResolvedValue({ id: 'item-2' });
    dbMock.orderItem.findMany.mockResolvedValue([
      { subtotal: '1000.00' },
      { subtotal: '960.00' },
    ]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      {
        requestId: 'request-1',
        decision: 'APPROVE',
        reviewRemark: '整单数量跨耗材档，保留已确认金额',
      },
      adminActor,
    );

    const rows = dbMock.productionTask.createMany.mock.calls[0]![0].data;
    expect(dbMock.orderItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        frontFoilColors: ['浅金'],
        backFoilColors: [],
        foilColors: ['浅金'],
        isDoubleSided: false,
        isDoubleColor: false,
      }),
      select: { id: true },
    });
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ craftId: 'craft-1', plannedQty: 720 }),
        expect.objectContaining({ craftId: 'craft-1', plannedQty: 480 }),
        expect.objectContaining({ craftId: 'craft-2', plannedQty: 1_200 }),
      ]),
    );
    expect(
      rows
        .filter((row: { craftId: string }) => row.craftId === 'craft-1')
        .reduce(
          (sum: number, row: { plannedQty: number }) => sum + row.plannedQty,
          0,
        ),
    ).toBe(1_200);
    expect(rows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ plannedQty: 1_000 }),
      ]),
    );
  });

  it('新增款式复制抢单池任务时保留可抢上下文并重置开放时间', async () => {
    const base = baseReviewRequest();
    const previousOpenedAt = new Date('2026-08-01T00:00:00.000Z');
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'ADD',
            templateItemId: 'item-1',
            name: '红包 B',
            quantity: 1_200,
            specification: '中号',
          },
        ],
      },
      order: {
        ...base.order,
        items: [
          {
            ...base.order.items[0],
            tasks: [
              {
                ...base.order.items[0].tasks[0],
                workerId: null,
                workerType: 'MACHINE',
                machineType: null,
                isSelfClaimable: true,
                selfClaimOpenedAt: previousOpenedAt,
                selfClaimedAt: null,
                claimMachineTypes: [
                  MachineType.WINDMILL,
                  MachineType.HAND_PRESS,
                ],
              },
            ],
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '0.8000', minQty: 1_200 }),
    ]);
    dbMock.orderItem.create.mockResolvedValue({ id: 'item-2' });
    dbMock.orderItem.findMany.mockResolvedValue([
      { subtotal: '1000.00' },
      { subtotal: '960.00' },
    ]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      {
        requestId: 'request-1',
        decision: 'APPROVE',
        reviewRemark: '新增款式导致耗材跨档，保留已确认金额',
      },
      adminActor,
    );

    const row = dbMock.productionTask.createMany.mock.calls[0]?.[0].data[0];
    expect(row).toMatchObject({
      orderItemId: 'item-2',
      craftId: 'craft-1',
      workerId: null,
      workerType: 'MACHINE',
      machineType: null,
      isSelfClaimable: true,
      selfClaimedAt: null,
      claimMachineTypes: [MachineType.WINDMILL, MachineType.HAND_PRESS],
      status: TaskStatus.PENDING,
      plannedQty: 1_200,
    });
    expect(row.selfClaimOpenedAt).toBeInstanceOf(Date);
    expect(row.selfClaimOpenedAt).not.toEqual(previousOpenedAt);
  });

  it('新增款式不会被模板款式已回货的外协单自动继承', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'ADD',
            templateItemId: 'item-1',
            name: '红包 B',
            quantity: 500,
            specification: '中号',
            foilColors: ['哑金'],
          },
        ],
      },
      order: {
        ...base.order,
        outsourceOrders: [
          {
            id: 'outsource-received',
            status: 'RECEIVED',
            orderItemIds: ['item-1'],
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.create.mockResolvedValue({ id: 'item-2' });
    dbMock.orderItem.findMany.mockResolvedValue([
      { subtotal: '1000.00' },
      { subtotal: '500.00' },
    ]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.orderItem.create).toHaveBeenCalled();
    expect(dbMock.outsourceOrder.update).not.toHaveBeenCalled();
  });

  it('quotes all affected updates and additions in one batched rule read', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            frontFoilColors: ['浅金'],
          },
          {
            operation: 'ADD',
            templateItemId: 'item-1',
            name: '红包 B',
            quantity: 500,
            specification: '中号',
            foilColors: ['哑金'],
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.create.mockResolvedValue({ id: 'item-2' });
    dbMock.orderItem.findMany.mockResolvedValue([
      { subtotal: '1000.00' },
      { subtotal: '500.00' },
    ]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.product.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.craft.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledTimes(2);
    expect(dbMock.customerPriceRule.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.priceTier.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceAdjustment.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderItem.update).toHaveBeenCalledTimes(1);
    expect(dbMock.orderItem.create).toHaveBeenCalledTimes(1);
  });

  it('does not re-quote a name-only change or replace its immutable price snapshot', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            name: '只改名称',
          },
        ],
      },
      order: {
        ...base.order,
        items: [
          {
            ...base.order.items[0],
            frontFoilColors: [],
            backFoilColors: [],
            foilColors: ['哑金'],
            isDoubleSided: true,
            isDoubleColor: true,
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1000.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.product.findMany).not.toHaveBeenCalled();
    expect(dbMock.craft.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceTier.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceAdjustment.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    const updateData = dbMock.orderItem.update.mock.calls[0]?.[0].data;
    expect(updateData).toMatchObject({ name: '只改名称' });
    expect(updateData).not.toHaveProperty('unitPrice');
    expect(updateData).not.toHaveProperty('fixedFee');
    expect(updateData).not.toHaveProperty('subtotal');
    expect(updateData).not.toHaveProperty('suggestedSubtotal');
    expect(updateData).not.toHaveProperty('suggestedPrice');
    expect(updateData).not.toHaveProperty('pricingSnapshot');
    expect(updateData).not.toHaveProperty('priceOverrideReason');
    expect(updateData).not.toHaveProperty('frontFoilColors');
    expect(updateData).not.toHaveProperty('backFoilColors');
    expect(updateData).not.toHaveProperty('foilColors');
    expect(updateData).not.toHaveProperty('isDoubleSided');
    expect(updateData).not.toHaveProperty('isDoubleColor');
  });

  it('blocks an incomplete re-quote until the reviewer explicitly explains carrying the old price', async () => {
    mockFlatFoilCraftCode('FLAT_FOIL_DOUBLE');
    const request = baseReviewRequest();
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([]);

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/无法按当前规则报价.*请填写审核备注/);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('carries the old price on an incomplete quote only with the explicit review remark', async () => {
    mockFlatFoilCraftCode('FLAT_FOIL_DOUBLE');
    const request = baseReviewRequest();
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([]);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1000.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      {
        requestId: 'request-1',
        decision: 'APPROVE',
        reviewRemark: '客户已确认沿用原成交价',
      },
      adminActor,
    );

    expect(dbMock.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        unitPrice: '1.00',
        fixedFee: '0',
        subtotal: '1000.00',
        suggestedSubtotal: null,
        priceOverrideReason: '客户已确认沿用原成交价',
        pricingSnapshot: expect.objectContaining({
          requestId: 'request-1',
          source: 'CHANGE_REQUEST_PRICE_CARRY_FORWARD',
          complete: false,
          actual: expect.objectContaining({
            overrideReason: '客户已确认沿用原成交价',
          }),
        }),
      }),
    });
    expect(
      dbMock.orderItem.update.mock.calls[0]![0].data.pricingSnapshot,
    ).not.toHaveProperty('previousSnapshot');
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
        settlementType: OrderSettlementType.INTERNAL_SALES,
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
        settlementType: OrderSettlementType.INTERNAL_SALES,
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
        settlementType: OrderSettlementType.EXTERNAL_SALES,
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
        settlementType: OrderSettlementType.INTERNAL_SALES,
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

  it('rejects a re-quote that would overflow Decimal(12,2)', async () => {
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
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRODUCT_1',
        category: 'CUSTOM_FLAT_FOIL',
        baseUnitPrice: '2000.0000',
      },
    ]);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '2000.0000' }),
    ]);

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/无法按当前规则报价.*建议金额超过系统上限/);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('rejects a combined order total that would overflow Decimal(12,2)', async () => {
    mockFlatFoilCraftCode('FLAT_FOIL_DOUBLE');
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
