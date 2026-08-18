import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OrderCostCategory,
  OrderSettlementType,
  OrderStatus,
  Role,
  TaskStatus,
} from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
  const mock: {
    order: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    craft: { findMany: ReturnType<typeof vi.fn> };
    product: { findMany: ReturnType<typeof vi.fn> };
    priceTier: { findMany: ReturnType<typeof vi.fn> };
    priceAdjustment: { findMany: ReturnType<typeof vi.fn> };
    customerPriceBook: { findMany: ReturnType<typeof vi.fn> };
    customerPriceRule: { findMany: ReturnType<typeof vi.fn> };
    productionTask: {
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    outsourceOrder: { findMany: ReturnType<typeof vi.fn> };
    orderShipment: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    orderShipmentLine: { createMany: ReturnType<typeof vi.fn> };
    orderCustomerCharge: {
      createMany: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    orderLog: { create: ReturnType<typeof vi.fn> };
    orderCostEntry: { aggregate: ReturnType<typeof vi.fn> };
    dailyWorkerSalaryItem: { groupBy: ReturnType<typeof vi.fn> };
    $executeRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  } = {
    order: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    craft: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    priceTier: { findMany: vi.fn() },
    priceAdjustment: { findMany: vi.fn() },
    customerPriceBook: { findMany: vi.fn() },
    customerPriceRule: { findMany: vi.fn() },
    productionTask: { findMany: vi.fn(), update: vi.fn() },
    outsourceOrder: { findMany: vi.fn() },
    orderShipment: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    orderShipmentLine: { createMany: vi.fn() },
    orderCustomerCharge: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    orderLog: { create: vi.fn() },
    orderCostEntry: { aggregate: vi.fn() },
    dailyWorkerSalaryItem: { groupBy: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(mock);
      return fn;
    }),
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

// Slice C：spy dispatchNotification() 验证 wire 点 fire 正确事件 +
// payload。模块整体替换成 spy；formatMoney 不 mock（lib/dashboard/
// format 是纯函数，测试要看真实输出）。typed as accepting any args
// so vi.fn 推断的 `[][]` 不阻 mock.calls[0]![1] 这类下标访问。
//
// dispatchNotification 是 Slice C wire 用的实际入口（封装 Next 16
// `after()` + 单测降级 void）；spy 这里 = spy 整条 dispatch chain。
const { notifyMock } = vi.hoisted(() => ({
  notifyMock: vi.fn<(...args: unknown[]) => void>(() => undefined),
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: notifyMock,
}));
const {
  assertCsOrderSalesLedgerReconciledMock,
  recordCsSalesEntryMock,
  MockCsSalesLedgerError,
} = vi.hoisted(() => ({
  assertCsOrderSalesLedgerReconciledMock: vi.fn<
    (...args: unknown[]) => Promise<void>
  >(),
  recordCsSalesEntryMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  MockCsSalesLedgerError: class extends Error {},
}));
vi.mock('@/lib/salary/cs-sales', () => ({
  assertCsOrderSalesLedgerReconciledInTx:
    assertCsOrderSalesLedgerReconciledMock,
  recordCsSalesEntryInTx: recordCsSalesEntryMock,
  CsSalesLedgerError: MockCsSalesLedgerError,
}));

import {
  createOrder as createOrderDomain,
  submitOrder,
  cancelOrder,
  shipOrder,
  finishOrder,
  listOrders,
  getOrderDetail,
  updateOrderFields,
  setOrderUrgent,
  setOrderSfCollect,
  OrderInvariantError,
} from '../order';
import { InvalidOrderTransitionError } from '../order/status-machine';

const salesActor = { id: 'sales-1', role: Role.SALES };
const workerActor = { id: 'worker-1', role: Role.WORKER };
const ownerActor = { id: 'owner-1', role: Role.ADMIN };

const testLogisticsSource = {
  sourceName: '测试物流报价表.xlsx',
  sourceSha256: 'c'.repeat(64),
  sourceSheet: '测试',
};

const testLogisticsRules = [
  {
    id: 'zto-guangdong',
    code: 'ZTO_GUANGDONG',
    amount: '2.80',
    includedUnits: '1',
    incrementUnits: '1',
    incrementAmount: '1.50',
    minQty: null,
    maxQty: null,
    triggerCondition: { carrierCode: 'ZTO', provinces: ['广东'] },
    sourceRange: 'A3:D3',
    blocksAutomaticQuote: false,
    category: { id: 'shipping-category', code: 'SHIPPING_FEE' },
    ...testLogisticsSource,
  },
  {
    id: 'packing-test',
    code: 'PACKING_TEST',
    amount: '0.00',
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty: 1,
    maxQty: 9_999_999,
    triggerCondition: null,
    sourceRange: 'A2:B6',
    blocksAutomaticQuote: true,
    category: { id: 'packing-category', code: 'PACKING_MATERIAL' },
    ...testLogisticsSource,
  },
];

async function createOrder(
  input: Parameters<typeof createOrderDomain>[0],
  actor: Parameters<typeof createOrderDomain>[1],
  now?: Date,
) {
  return createOrderDomain(
    {
      destinationProvince: '广东',
      quotedWeightKg: '1',
      shippingFee: '0.00',
      packingMaterialFee: '0.00',
      customerChargeOverrideReason: '测试用例仅验证加工费语义',
      ...input,
      additionalShipments: input.additionalShipments?.map((shipment) => ({
        destinationProvince: '广东',
        quotedWeightKg: '1',
        shippingFee: '0.00',
        packingMaterialFee: '0.00',
        customerChargeOverrideReason: '测试用例仅验证加工费语义',
        ...shipment,
      })),
    },
    actor,
    now,
  );
}

const activeExternalPriceBook = {
  id: 'external-book-test',
  code: 'EXTERNAL_TEST',
  name: '外部销售测试价目簿',
  version: 1,
  sourceName: '测试报价表.xlsx',
  sourceSha256: 'a'.repeat(64),
};

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
    triggerCondition: null,
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
  calculationType,
  amount,
  triggerCondition,
}: {
  id: string;
  name: string;
  calculationType: 'PER_PIECE' | 'FIXED_AMOUNT';
  amount: string;
  triggerCondition: Record<string, unknown>;
}) {
  return {
    ...externalBaseRule({ id, amount, productId: null }),
    name,
    kind: 'ADD_ON',
    calculationType,
    triggerCondition,
    priority: 50,
    category: { code: 'ADD_ON', name: '附加加工费' },
  };
}

function externalBlockingReference({
  id,
  name,
  productId = 'product-1',
  minQty = null,
  maxQty = null,
}: {
  id: string;
  name: string;
  productId?: string | null;
  minQty?: number | null;
  maxQty?: number | null;
}) {
  return {
    ...externalBaseRule({ id, productId, minQty, maxQty }),
    name,
    kind: 'REFERENCE',
    calculationType: null,
    amount: null,
    blocksAutomaticQuote: true,
    category: { code: 'REFERENCE', name: '人工报价提示' },
  };
}

function baseItem(over: Partial<Record<string, unknown>> = {}) {
  return {
    name: '烫金款 A',
    productId: null,
    specification: null,
    paperType: null,
    quantity: 1000,
    crafts: ['craft-1'],
    foilColors: [],
    isDoubleSided: false,
    isDoubleColor: false,
    unitPrice: '0.5000',
    fixedFee: '0',
    suggestedSubtotal: null,
    priceOverrideReason: '历史人工报价',
    remark: null,
    ...over,
  };
}

beforeEach(() => {
  for (const fn of Object.values(dbMock.order)) fn.mockReset();
  dbMock.craft.findMany.mockReset();
  dbMock.product.findMany.mockReset();
  dbMock.priceTier.findMany.mockReset().mockResolvedValue([]);
  dbMock.priceAdjustment.findMany.mockReset().mockResolvedValue([]);
  dbMock.customerPriceBook.findMany
    .mockReset()
    .mockImplementation(async (args: { where?: { purpose?: string } }) =>
      args.where?.purpose === 'LOGISTICS'
        ? [
            {
              id: 'logistics-book-test',
              code: 'LOGISTICS_TEST',
              name: '外部销售物流测试价目簿',
              version: 1,
              sourceName: testLogisticsSource.sourceName,
              sourceSha256: testLogisticsSource.sourceSha256,
              rules: testLogisticsRules,
            },
          ]
        : [activeExternalPriceBook],
    );
  dbMock.customerPriceRule.findMany
    .mockReset()
    .mockResolvedValue([externalBaseRule()]);
  // Default: order has no production tasks (cancelOrder cascade reads []).
  dbMock.productionTask.findMany.mockReset().mockResolvedValue([]);
  dbMock.productionTask.update.mockReset().mockResolvedValue({});
  // Default: order has no in-flight outsource orders.
  dbMock.outsourceOrder.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderShipment.create
    .mockReset()
    .mockResolvedValue({ id: 'shipment-1' });
  dbMock.orderShipment.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderShipment.update.mockReset().mockResolvedValue({ id: 'shipment-1' });
  dbMock.orderShipment.updateMany.mockReset().mockResolvedValue({ count: 1 });
  dbMock.orderShipmentLine.createMany
    .mockReset()
    .mockResolvedValue({ count: 1 });
  dbMock.orderCustomerCharge.createMany
    .mockReset()
    .mockResolvedValue({ count: 2 });
  dbMock.orderCustomerCharge.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderCustomerCharge.update.mockReset().mockResolvedValue({});
  dbMock.orderLog.create.mockReset().mockResolvedValue({});
  dbMock.orderCostEntry.aggregate.mockReset().mockResolvedValue({
    _sum: { amount: null },
  });
  dbMock.order.count.mockReset().mockResolvedValue(0);
  dbMock.dailyWorkerSalaryItem.groupBy.mockReset().mockResolvedValue([]);
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
    if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
    return fn;
  });
  notifyMock.mockReset().mockResolvedValue(undefined);
  assertCsOrderSalesLedgerReconciledMock
    .mockReset()
    .mockResolvedValue(undefined);
  recordCsSalesEntryMock.mockReset().mockResolvedValue(null);

  // Default: no existing orders for today (fresh serial), every craft
  // exists + is active, no productId references.
  dbMock.order.findFirst.mockResolvedValue(null);
  dbMock.craft.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => ({ id, code: `CRAFT_${id}`, isActive: true })),
  );
  dbMock.order.create.mockImplementation(
    async ({
      data,
    }: {
      data: { orderNo: string; items: { create: Array<unknown> } };
    }) => ({
      id: 'order-created',
      orderNo: data.orderNo,
      items: data.items.create.map((_, index) => ({
        id: `item-${index + 1}`,
        sequence: index + 1,
      })),
    }),
  );
});

describe('createOrder', () => {
  it('opens a transaction and acquires the per-day advisory lock', async () => {
    await createOrder(
      {
        customerRef: '苹果福',
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [baseItem()],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    const queryRawCalls = dbMock.$executeRaw.mock.calls;
    expect(queryRawCalls.length).toBeGreaterThan(0);
    const firstSql = (queryRawCalls[0][0] as TemplateStringsArray).join('?');
    expect(firstSql).toMatch(/pg_advisory_xact_lock/);
  });

  it('acquires the shared price-rule lock exactly once before every product read', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        isActive: true,
        baseUnitPrice: '0.5000',
        minOrderQty: null,
      },
    ]);

    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [baseItem({ productId: 'product-1' })],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );

    const sharedLockCallIndexes = dbMock.$executeRaw.mock.calls.flatMap(
      (call, index) => {
        const sql = (call[0] as TemplateStringsArray).join('?');
        return sql.includes('pg_advisory_xact_lock_shared') ? [index] : [];
      },
    );
    expect(sharedLockCallIndexes).toHaveLength(1);
    expect(dbMock.product.findMany).toHaveBeenCalledTimes(2);

    const sharedLockCallOrder =
      dbMock.$executeRaw.mock.invocationCallOrder[
        sharedLockCallIndexes[0]!
      ]!;
    expect(
      dbMock.product.findMany.mock.invocationCallOrder.every(
        (callOrder) => callOrder > sharedLockCallOrder,
      ),
    ).toBe(true);
    expect(dbMock.product.findMany.mock.calls[1]![0]).toEqual({
      where: { id: { in: ['product-1'] } },
      select: { id: true, isActive: true },
    });
  });

  it('assigns GD-YYMMDD-001 when the day has no existing orders', async () => {
    const result = await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [baseItem()],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );
    expect(result.orderNo).toBe('GD-260423-001');
  });

  it('stores status=DRAFT and writes an initial CREATE log entry', async () => {
    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [baseItem()],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );
    const createArg = dbMock.order.create.mock.calls[0][0];
    expect(createArg.data.status).toBe(OrderStatus.DRAFT);
    expect(createArg.data.logs.create[0].action).toBe('CREATE');
    expect(createArg.data.logs.create[0].operatorId).toBe('sales-1');
    expect(createArg.data.settlementType).toBe(
      OrderSettlementType.EXTERNAL_SALES,
    );
  });

  it('adds per-shipment customer shipping and packing charges to the receivable total', async () => {
    await createOrder(
      {
        customerRef: '苹果福',
        receiverName: '张三',
        receiverPhone: '13800000000',
        receiverAddress: '广东佛山',
        expressCode: null,
        destinationProvince: '广东',
        quotedWeightKg: '1',
        shippingFee: '2.80',
        packingMaterialFee: '3.00',
        customerChargeOverrideReason: '本票使用加厚纸箱',
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [baseItem()],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );

    const orderData = dbMock.order.create.mock.calls[0]![0].data;
    expect(orderData.processingAmount).toBe('500.00');
    expect(orderData.totalAmount).toBe('505.80');
    const rows = dbMock.orderCustomerCharge.createMany.mock.calls[0]![0].data;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shipmentId: 'shipment-1',
          categoryId: 'shipping-category',
          businessKey: 'SHIPMENT:1:SHIPPING_FEE',
          status: 'ESTIMATED',
          suggestedAmount: '2.80',
          amount: '2.80',
          sourceRuleId: 'zto-guangdong',
        }),
        expect.objectContaining({
          shipmentId: 'shipment-1',
          categoryId: 'packing-category',
          businessKey: 'SHIPMENT:1:PACKING_MATERIAL',
          status: 'ESTIMATED',
          suggestedAmount: '0.00',
          amount: '3.00',
          overrideReason: '本票使用加厚纸箱',
          sourceRuleId: 'packing-test',
        }),
      ]),
    );
  });

  it('automatically applies the server quote and stores its immutable snapshot', async () => {
    dbMock.product.findMany.mockResolvedValue([
      { id: 'product-1', isActive: true, baseUnitPrice: '0.2000' },
    ]);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({
        id: 'tier-1',
        amount: '0.1200',
        minQty: 500,
      }),
      externalAddOnRule({
        id: 'piece-1',
        name: '双色每个加价',
        calculationType: 'PER_PIECE',
        amount: '0.0100',
        triggerCondition: { isDoubleColor: true },
      }),
      externalAddOnRule({
        id: 'order-1',
        name: '每款制版费',
        calculationType: 'FIXED_AMOUNT',
        amount: '20.0000',
        triggerCondition: {},
      }),
    ]);

    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [
          baseItem({
            productId: 'product-1',
            isDoubleColor: true,
            unitPrice: null,
            fixedFee: null,
            priceOverrideReason: null,
          }),
        ],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );

    const data = dbMock.order.create.mock.calls[0]![0].data;
    expect(data.totalAmount).toBe('150.00');
    expect(data.items.create[0]).toMatchObject({
      unitPrice: '0.1300',
      fixedFee: '20.00',
      subtotal: '150.00',
      suggestedSubtotal: '150.00',
      priceOverrideReason: null,
      pricingSnapshot: expect.objectContaining({
        complete: true,
        priceBook: expect.objectContaining({ id: 'external-book-test' }),
        components: expect.arrayContaining([
          expect.objectContaining({ sourceId: 'tier-1', amount: '120.00' }),
          expect.objectContaining({ sourceId: 'piece-1', amount: '10.00' }),
          expect.objectContaining({ sourceId: 'order-1', amount: '20.00' }),
        ]),
        actual: {
          unitPrice: '0.1300',
          fixedFee: '20.00',
          subtotal: '150.00',
          overrideReason: null,
        },
      }),
    });
    expect(data.items.create[0]).not.toHaveProperty('suggestedPrice');
  });

  it('requires an audit reason when a manual price differs from the suggestion', async () => {
    dbMock.product.findMany.mockResolvedValue([
      { id: 'product-1', isActive: true, baseUnitPrice: '0.1000' },
    ]);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '0.1000' }),
    ]);

    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: null,
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
          isUrgent: false,
          isSfCollect: false,
          items: [
            baseItem({
              productId: 'product-1',
              unitPrice: '0.2000',
              fixedFee: '0',
              priceOverrideReason: null,
            }),
          ],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      ),
    ).rejects.toThrow('成交价与系统建议价不同');
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });

  it('requires an audit reason when manual unit and fixed components are reallocated at the same subtotal', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        isActive: true,
        baseUnitPrice: '1.0000',
        minOrderQty: null,
      },
    ]);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '1.0000' }),
      externalAddOnRule({
        id: 'plate-fee',
        name: '制版费',
        calculationType: 'FIXED_AMOUNT',
        amount: '10.0000',
        triggerCondition: {},
      }),
    ]);

    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: null,
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
          isUrgent: false,
          isSfCollect: false,
          items: [
            baseItem({
              productId: 'product-1',
              quantity: 1_000,
              unitPrice: '1.0100',
              fixedFee: '0',
              priceOverrideReason: null,
            }),
          ],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      ),
    ).rejects.toThrow('成交价与系统建议价不同');
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });

  it('treats differently formatted but numerically equal price components as the suggestion', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        isActive: true,
        baseUnitPrice: '1.0000',
        minOrderQty: null,
      },
    ]);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '1.0000' }),
      externalAddOnRule({
        id: 'plate-fee',
        name: '制版费',
        calculationType: 'FIXED_AMOUNT',
        amount: '10.0000',
        triggerCondition: {},
      }),
    ]);

    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [
          baseItem({
            productId: 'product-1',
            quantity: 1_000,
            unitPrice: '1',
            fixedFee: '10.0',
            priceOverrideReason: null,
          }),
        ],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );

    expect(dbMock.order.create.mock.calls[0]![0].data.items.create[0]).toMatchObject({
      unitPrice: '1',
      fixedFee: '10.0',
      subtotal: '1010.00',
      suggestedSubtotal: '1010.00',
      priceOverrideReason: null,
    });
  });

  it('does not silently auto-price below MOQ and allows an audited special-order price', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        isActive: true,
        baseUnitPrice: '0.1000',
        minOrderQty: 2_000,
      },
    ]);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '0.1000', minQty: 2_000 }),
      externalBlockingReference({
        id: 'below-moq-reference',
        name: '数量低于产品最小起订量 2000',
        maxQty: 1_999,
      }),
    ]);
    const belowMoqItem = baseItem({
      productId: 'product-1',
      quantity: 1_000,
      unitPrice: null,
      fixedFee: null,
      priceOverrideReason: null,
    });

    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: null,
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
          isUrgent: false,
          isSfCollect: false,
          items: [belowMoqItem],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      ),
    ).rejects.toThrow('数量低于产品最小起订量 2000');
    expect(dbMock.order.create).not.toHaveBeenCalled();

    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [
          {
            ...belowMoqItem,
            unitPrice: '0.1200',
            fixedFee: '10.00',
            priceOverrideReason: '客户确认小批量特殊报价',
          },
        ],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );

    const createdItem = dbMock.order.create.mock.calls[0]![0].data.items.create[0];
    expect(createdItem).toMatchObject({
      unitPrice: '0.1200',
      fixedFee: '10.00',
      subtotal: '130.00',
      priceOverrideReason: '客户确认小批量特殊报价',
      pricingSnapshot: expect.objectContaining({
        complete: false,
        errors: expect.arrayContaining([
          expect.stringMatching(/数量低于产品最小起订量 2000/),
        ]),
      }),
    });
  });

  it('rejects an automatically derived subtotal that exceeds Decimal(12,2)', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        isActive: true,
        baseUnitPrice: '999999.9999',
      },
    ]);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '999999.9999' }),
    ]);

    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: null,
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
          isUrgent: false,
          isSfCollect: false,
          items: [
            baseItem({
              productId: 'product-1',
              quantity: 9_999_999,
              unitPrice: null,
              fixedFee: null,
              priceOverrideReason: null,
            }),
          ],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      ),
    ).rejects.toThrow(/建议金额超过系统上限/);
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });

  it('rejects a multi-item total that exceeds Decimal(12,2)', async () => {
    const hugeLine = baseItem({
      quantity: 6_000,
      unitPrice: '999999.0000',
      fixedFee: '0',
      priceOverrideReason: '管理员确认的大额人工报价',
    });

    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: null,
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
          isUrgent: false,
          isSfCollect: false,
          items: [hugeLine, { ...hugeLine, name: '烫金款 B' }],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      ),
    ).rejects.toThrow(/工单总金额超过系统上限/);
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });

  it('validates manual money at the domain boundary before persistence', async () => {
    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: null,
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
          isUrgent: false,
          isSfCollect: false,
          items: [
            baseItem({
              fixedFee: '10000000000.00',
              priceOverrideReason: '人工报价',
            }),
          ],
        },
        salesActor,
      ),
    ).rejects.toThrow(/一次性费用超出系统允许范围/);
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });

  it('stores the custom name and returns item ids in sequence order', async () => {
    const result = await createOrder(
      {
        customName: '王总中秋礼盒首批',
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [baseItem(), baseItem({ name: '内盒' })],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );

    expect(dbMock.order.create.mock.calls[0][0].data.customName).toBe(
      '王总中秋礼盒首批',
    );
    expect(result.itemIds).toEqual(['item-1', 'item-2']);
  });

  it('creates one shipment per address and preserves the quantity allocation', async () => {
    dbMock.orderShipment.create
      .mockResolvedValueOnce({ id: 'shipment-primary' })
      .mockResolvedValueOnce({ id: 'shipment-extra' });

    await createOrder(
      {
        customerRef: null,
        receiverName: '主地址收货人',
        receiverPhone: '13800000000',
        receiverAddress: '佛山主地址',
        expressCode: 'SF',
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: true,
        items: [
          baseItem({ name: 'A 款', quantity: 1000 }),
          baseItem({ name: 'B 款', quantity: 500 }),
        ],
        additionalShipments: [
          {
            receiverName: '分地址收货人',
            receiverPhone: '13900000000',
            receiverAddress: '广州分地址',
            expressCode: 'SF',
            itemQuantities: [300, 100],
          },
        ],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );

    expect(dbMock.orderShipment.create).toHaveBeenCalledTimes(2);
    expect(dbMock.orderShipment.create.mock.calls[0]![0].data).toMatchObject({
      orderId: 'order-created',
      sequence: 1,
      receiverName: '主地址收货人',
    });
    expect(dbMock.orderShipment.create.mock.calls[1]![0].data).toMatchObject({
      orderId: 'order-created',
      sequence: 2,
      receiverName: '分地址收货人',
    });
    expect(dbMock.orderShipmentLine.createMany.mock.calls[0]![0].data).toEqual([
      {
        shipmentId: 'shipment-primary',
        orderItemId: 'item-1',
        quantity: 700,
      },
      {
        shipmentId: 'shipment-primary',
        orderItemId: 'item-2',
        quantity: 400,
      },
    ]);
    expect(dbMock.orderShipmentLine.createMany.mock.calls[1]![0].data).toEqual([
      {
        shipmentId: 'shipment-extra',
        orderItemId: 'item-1',
        quantity: 300,
      },
      {
        shipmentId: 'shipment-extra',
        orderItemId: 'item-2',
        quantity: 100,
      },
    ]);
    expect(dbMock.orderCustomerCharge.createMany.mock.calls[0]![0].data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shipmentId: 'shipment-primary',
          businessKey: 'SHIPMENT:1:SHIPPING_FEE',
        }),
        expect.objectContaining({
          shipmentId: 'shipment-primary',
          businessKey: 'SHIPMENT:1:PACKING_MATERIAL',
        }),
        expect.objectContaining({
          shipmentId: 'shipment-extra',
          businessKey: 'SHIPMENT:2:SHIPPING_FEE',
        }),
        expect.objectContaining({
          shipmentId: 'shipment-extra',
          businessKey: 'SHIPMENT:2:PACKING_MATERIAL',
        }),
      ]),
    );
  });

  it('refuses when a referenced craft id does not exist or is inactive', async () => {
    dbMock.craft.findMany.mockResolvedValueOnce([]); // no active craft matches
    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: null,
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
          items: [baseItem({ crafts: ['does-not-exist'] })],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      ),
    ).rejects.toBeInstanceOf(OrderInvariantError);
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });

  it('refuses when the selected product is absent from the active quote dictionary', async () => {
    dbMock.product.findMany
      // The external-sales quote is deliberately active-only and fails before
      // a stale product selection can be priced or persisted.
      .mockResolvedValueOnce([]);
    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: null,
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
          items: [baseItem({ productId: 'p1' })],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      ),
    ).rejects.toThrowError(/报价产品字典已变化/);
  });

  it('顺丰到付只免快递费，仍把打包耗材费计入 totalAmount', async () => {
    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: true,
        packingMaterialFee: '3.00',
        customerChargeOverrideReason: '本票使用加厚纸箱',
        items: [
          baseItem({ quantity: 3, unitPrice: '0.1' }),
          baseItem({ name: 'B', quantity: 2, unitPrice: '0.2' }),
        ],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );
    const createArg = dbMock.order.create.mock.calls[0][0];
    // 3 × 0.1 = 0.30
    expect(createArg.data.items.create[0].subtotal).toBe('0.30');
    // 2 × 0.2 = 0.40
    expect(createArg.data.items.create[1].subtotal).toBe('0.40');
    // 加工费 0.70 + 打包耗材费 3.00；顺丰到付快递费为 0。
    expect(createArg.data.processingAmount).toBe('0.70');
    expect(createArg.data.totalAmount).toBe('3.70');
    expect(createArg.data.isSfCollect).toBe(true);
    expect(dbMock.orderCustomerCharge.createMany.mock.calls[0]![0].data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          businessKey: 'SHIPMENT:1:SHIPPING_FEE',
          status: 'WAIVED',
          amount: '0.00',
        }),
        expect.objectContaining({
          businessKey: 'SHIPMENT:1:PACKING_MATERIAL',
          status: 'ESTIMATED',
          amount: '3.00',
        }),
      ]),
    );
  });

  it('treats a null unitPrice as 0 for the subtotal', async () => {
    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [baseItem({ quantity: 500, unitPrice: null })],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );
    expect(dbMock.order.create.mock.calls[0][0].data.items.create[0].subtotal).toBe('0.00');
    expect(dbMock.order.create.mock.calls[0][0].data.totalAmount).toBe('0.00');
  });

  it('records isUrgent and stamps a "创建急单" log remark', async () => {
    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: true,
        isSfCollect: false,
        items: [baseItem()],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );
    const createArg = dbMock.order.create.mock.calls[0][0];
    expect(createArg.data.isUrgent).toBe(true);
    expect(createArg.data.logs.create[0].remark).toBe('创建急单');
  });
});

describe('submitOrder', () => {
  // Slice C wire 后 submitOrder 走两次 findUnique：
  //   1. tx 内取 { id, status, submitterId } 走状态机
  //   2. tx 后取 { id, orderNo, customerRef, totalAmount, isUrgent,
  //              submitter.displayName } 喂 notify
  // mockResolvedValue 复用同一返回值就够了（第一次读 .status，
  // 第二次读 .totalAmount 等；都是属性存取，互不干扰）。
  const submittedRichRow = {
    id: 'o1',
    status: OrderStatus.DRAFT,
    submitterId: 'sales-1',
    orderNo: 'O-1',
    customerRef: '苹果福',
    totalAmount: '5000.00',
    promisedDate: null,
        isUrgent: false,
    submitter: { displayName: '张三' },
  };

  it('transitions DRAFT → SUBMITTED and stamps submittedAt from the injected clock', async () => {
    dbMock.order.findUnique.mockResolvedValue(submittedRichRow);
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SUBMITTED });

    const clock = new Date('2026-04-23T10:00:00+08:00');
    const r = await submitOrder('o1', salesActor, clock);
    expect(r.status).toBe(OrderStatus.SUBMITTED);
    const updateArg = dbMock.order.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe(OrderStatus.SUBMITTED);
    expect(updateArg.data.submittedAt).toBe(clock);

    // Exactly one STATUS_CHANGE log with before/after.
    const logArg = dbMock.orderLog.create.mock.calls[0][0];
    expect(logArg.data.action).toBe('STATUS_CHANGE');
    expect(logArg.data.changedFields.status).toEqual({
      before: OrderStatus.DRAFT,
      after: OrderStatus.SUBMITTED,
    });
  });

  it('refuses when a non-owner SALES tries to submit another SALES\'s order (Codex round 27 / P1)', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      submitterId: 'someone-else',
    });

    await expect(submitOrder('o1', salesActor)).rejects.toThrowError(
      /只能提交自己创建的工单/,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('ADMIN may submit on behalf of another submitter (global override)', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      ...submittedRichRow,
      submitterId: 'someone-else',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SUBMITTED });
    await expect(submitOrder('o1', ownerActor)).resolves.toBeDefined();
  });

  it('refuses the submit when the current status is not DRAFT', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.IN_PRODUCTION,
      submitterId: 'sales-1',
    });

    await expect(submitOrder('o1', salesActor)).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('throws OrderInvariantError if the target is missing', async () => {
    dbMock.order.findUnique.mockResolvedValue(null);
    await expect(submitOrder('nope', salesActor)).rejects.toBeInstanceOf(OrderInvariantError);
  });

  // ─── Slice C wire spec ───
  it('submitOrder fires notify("ORDER_SUBMITTED") with rendered payload', async () => {
    dbMock.order.findUnique.mockResolvedValue(submittedRichRow);
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SUBMITTED });
    await submitOrder('o1', salesActor);
    // 1 call (not urgent → 不触 URGENT_ORDER)
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
      'ORDER_SUBMITTED',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        customerRef: '苹果福',
        // formatMoneyPlain 千分位 + 2 位小数，**不带 `¥ ` 前缀**——seed
        // 模板 `金额：¥{totalAmount}` 已含 ¥（Codex round 109 P2）。
        totalAmount: '5,000.00',
        urgentMark: '',
      },
      { dedupeKey: 'notification:ORDER_SUBMITTED:o1' },
    );
  });

  it('submitOrder + isUrgent=true → 同时 fire URGENT_ORDER（独立事件，不替代 ORDER_SUBMITTED）', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      ...submittedRichRow,
      isUrgent: true,
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SUBMITTED });
    await submitOrder('o1', salesActor);
    expect(notifyMock).toHaveBeenCalledTimes(2);
    const [first, second] = notifyMock.mock.calls;
    expect(first[0]).toBe('ORDER_SUBMITTED');
    expect((first[1] as { urgentMark: string }).urgentMark).toBe('🚨 急单');
    expect(second[0]).toBe('URGENT_ORDER');
    expect(second[1]).toEqual({
      orderId: 'o1',
      orderNo: 'O-1',
      submitterName: '张三',
      customerRef: '苹果福',
    });
  });

  it('submitOrder 业务异常时**不**触发 notify（tx 没 commit）', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      ...submittedRichRow,
      submitterId: 'someone-else',
    });
    await expect(submitOrder('o1', salesActor)).rejects.toThrow();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe('cancelOrder', () => {
  it('cancels a non-terminal order and logs with the reason', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SCHEDULING,
      submitterId: 'sales-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });

    await cancelOrder('o1', ownerActor, '客户取消');
    const updateArg = dbMock.order.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe(OrderStatus.CANCELLED);
    // submittedAt shouldn't be touched on CANCELLED.
    expect(updateArg.data.submittedAt).toBeUndefined();

    const logArg = dbMock.orderLog.create.mock.calls[0][0];
    expect(logArg.data.remark).toBe('取消：客户取消');
  });

  it('uses a default remark when reason is null', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      submitterId: 'sales-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });
    await cancelOrder('o1', ownerActor, null);
    expect(dbMock.orderLog.create.mock.calls[0][0].data.remark).toBe('取消工单');
  });

  it('refuses to cancel terminal states (FINISHED)', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.FINISHED,
      submitterId: 'sales-1',
    });
    await expect(cancelOrder('o1', ownerActor, null)).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
  });

  // ── A1 (DECISIONS 2026-07-09): cancel cascades to ProductionTask ──

  it('voids every PENDING task to CANCELLED in the same cancel tx', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SCHEDULING,
      submitterId: 'sales-1',
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 't1', status: TaskStatus.PENDING },
      { id: 't2', status: TaskStatus.PENDING },
    ]);
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });

    const r = await cancelOrder('o1', ownerActor, '客户取消');
    expect(r.status).toBe(OrderStatus.CANCELLED);

    // Each PENDING task written to CANCELLED.
    const updated = dbMock.productionTask.update.mock.calls.map((c) => ({
      id: c[0].where.id,
      status: c[0].data.status,
    }));
    expect(updated).toEqual([
      { id: 't1', status: TaskStatus.CANCELLED },
      { id: 't2', status: TaskStatus.CANCELLED },
    ]);

    // An audit log records how many tasks were voided.
    const remarks = dbMock.orderLog.create.mock.calls.map((c) => c[0].data.remark);
    expect(remarks).toContain('随工单取消 2 个未开工任务');
  });

  it('blocks cancel when a task is already IN_PROGRESS — writes nothing (no half-cancel)', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.IN_PRODUCTION,
      submitterId: 'sales-1',
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 't1', status: TaskStatus.IN_PROGRESS },
    ]);

    await expect(cancelOrder('o1', ownerActor, null)).rejects.toBeInstanceOf(
      OrderInvariantError,
    );
    await expect(cancelOrder('o1', ownerActor, null)).rejects.toThrow(
      /已开工\/已报工任务/,
    );
    // Cascade throws BEFORE the order row or any task is written.
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('blocks cancel when a task is already COMPLETED — no cascade, no order write', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 't1', status: TaskStatus.COMPLETED },
    ]);

    await expect(cancelOrder('o1', ownerActor, null)).rejects.toBeInstanceOf(
      OrderInvariantError,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('blocks cancel when a linked outsource order is SENT/IN_PROGRESS (A1-A2) — no writes', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SCHEDULING,
      submitterId: 'sales-1',
    });
    // Tasks are all PENDING (task check passes); the outsource order is
    // what blocks the cancel.
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 't1', status: TaskStatus.PENDING },
    ]);
    dbMock.outsourceOrder.findMany.mockResolvedValue([{ id: 'os1' }]);

    await expect(cancelOrder('o1', ownerActor, null)).rejects.toBeInstanceOf(
      OrderInvariantError,
    );
    await expect(cancelOrder('o1', ownerActor, null)).rejects.toThrow(
      /已发送或进行中的外协单/,
    );
    // We do NOT auto-cancel the outsource order, void the PENDING task,
    // or cancel the order — the operator must handle outsource first.
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('cancels normally when linked outsource orders are only RECEIVED/CANCELLED (A1-A2)', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SCHEDULING,
      submitterId: 'sales-1',
    });
    dbMock.productionTask.findMany.mockResolvedValue([]);
    // The status:{ in: [SENT, IN_PROGRESS] } filter means RECEIVED /
    // CANCELLED outsource orders never come back from this query.
    dbMock.outsourceOrder.findMany.mockResolvedValue([]);
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });

    const r = await cancelOrder('o1', ownerActor, null);
    expect(r.status).toBe(OrderStatus.CANCELLED);
    // The block query filters to in-flight statuses only.
    const where = dbMock.outsourceOrder.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['SENT', 'IN_PROGRESS']);
  });

  it('voids only PENDING tasks, leaving already-CANCELLED siblings untouched', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SCHEDULING,
      submitterId: 'sales-1',
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 't1', status: TaskStatus.PENDING },
      { id: 't2', status: TaskStatus.CANCELLED },
    ]);
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });

    await cancelOrder('o1', ownerActor, null);
    // Only t1 is written; t2 (already CANCELLED) is left alone.
    expect(dbMock.productionTask.update).toHaveBeenCalledTimes(1);
    expect(dbMock.productionTask.update.mock.calls[0][0].where.id).toBe('t1');
  });

  it('cancels a task-free order (DRAFT) with no cascade writes', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      submitterId: 'sales-1',
    });
    dbMock.productionTask.findMany.mockResolvedValue([]);
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });

    const r = await cancelOrder('o1', ownerActor, null);
    expect(r.status).toBe(OrderStatus.CANCELLED);
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
    // Only the status-change log; no task-cascade log.
    const remarks = dbMock.orderLog.create.mock.calls.map((c) => c[0].data.remark);
    expect(remarks).toEqual(['取消工单']);
  });

  it('does not subtract CS sales when cancelling a draft that was never accrued', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      submitterId: 'cs-1',
      submitterRole: Role.CUSTOMER_SERVICE,
      settlementType: OrderSettlementType.INTERNAL_SALES,
      billingMode: 'CHARGE',
      totalAmount: '5000.00',
      revision: 1,
    });
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.CANCELLED,
    });

    await cancelOrder('o1', ownerActor, '放弃草稿');

    expect(recordCsSalesEntryMock).not.toHaveBeenCalled();
  });

  it('subtracts the exact current amount when cancelling an accrued CS order', async () => {
    const clock = new Date('2026-08-02T03:04:00.000Z');
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SUBMITTED,
      submitterId: 'cs-1',
      submitterRole: Role.CUSTOMER_SERVICE,
      settlementType: OrderSettlementType.INTERNAL_SALES,
      billingMode: 'CHARGE',
      totalAmount: '5000.25',
      revision: 3,
    });
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.CANCELLED,
    });

    await cancelOrder('o1', ownerActor, '客户取消', clock);

    expect(assertCsOrderSalesLedgerReconciledMock).toHaveBeenCalledWith(
      dbMock,
      'o1',
      '5000.25',
    );
    expect(recordCsSalesEntryMock).toHaveBeenCalledTimes(1);
    expect(recordCsSalesEntryMock).toHaveBeenCalledWith(
      dbMock,
      {
        eventKey: 'order:o1:revision:3:cancel',
        csUserId: 'cs-1',
        orderId: 'o1',
        orderRevision: 3,
        type: 'ORDER_CANCELLED',
        amount: expect.objectContaining({}),
        occurredAt: clock,
        remark: '取消工单：客户取消',
      },
    );
    const ledgerInput = recordCsSalesEntryMock.mock.calls[0]?.[1] as {
      amount: { toFixed: (places: number) => string };
    };
    expect(ledgerInput.amount.toFixed(2)).toBe('-5000.25');
  });

  it('rolls back cancellation when legacy CS sales cannot be reconciled', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SUBMITTED,
      submitterId: 'cs-1',
      submitterRole: Role.CUSTOMER_SERVICE,
      settlementType: OrderSettlementType.INTERNAL_SALES,
      billingMode: 'CHARGE',
      totalAmount: '5000.25',
      revision: 3,
    });
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.CANCELLED,
    });
    assertCsOrderSalesLedgerReconciledMock.mockRejectedValue(
      new MockCsSalesLedgerError('历史财务校准后再操作'),
    );

    await expect(
      cancelOrder('o1', ownerActor, '客户取消'),
    ).rejects.toThrow(/历史财务校准/);
    expect(recordCsSalesEntryMock).not.toHaveBeenCalled();
  });
});

describe('shipOrder', () => {
  it('ships every stored address atomically with its own tracking number', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
      orderNo: 'O-1',
    });
    dbMock.orderShipment.findMany.mockResolvedValue([
      { id: 'shipment-1', sequence: 1 },
      { id: 'shipment-2', sequence: 2 },
    ]);
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SHIPPED,
    });

    const clock = new Date('2026-04-25T12:00:00Z');
    await shipOrder(
      'o1',
      ownerActor,
      {
        trackingNo: null,
        shipments: [
          { shipmentId: 'shipment-1', trackingNo: ' SF001 ' },
          { shipmentId: 'shipment-2', trackingNo: 'SF002' },
        ],
      },
      clock,
    );

    expect(dbMock.orderShipment.update.mock.calls.map((call) => call[0])).toEqual([
      {
        where: { id: 'shipment-1' },
        data: {
          trackingNo: 'SF001',
          status: 'SHIPPED',
          shippedAt: clock,
        },
        select: { id: true },
      },
      {
        where: { id: 'shipment-2' },
        data: {
          trackingNo: 'SF002',
          status: 'SHIPPED',
          shippedAt: clock,
        },
        select: { id: true },
      },
    ]);
    expect(dbMock.order.update.mock.calls[0]![0].data.trackingNo).toBe('SF001');
    expect(dbMock.orderLog.create.mock.calls[0]![0].data.remark).toBe(
      '多地址发货：2 个地址',
    );
  });

  it('finalizes external customer charges from actual billed weight in the shipping transaction', async () => {
    dbMock.order.findUnique
      .mockResolvedValueOnce({
        id: 'o1',
        status: OrderStatus.COMPLETED,
        submitterId: 'sales-1',
      })
      .mockResolvedValueOnce({
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        isSfCollect: false,
        processingAmount: '500.00',
        customerCharges: [
          {
            id: 'charge-shipping',
            businessKey: 'SHIPMENT:1:SHIPPING_FEE',
            amount: '2.80',
            priceBookId: 'logistics-book-test',
            category: { code: 'SHIPPING_FEE' },
          },
          {
            id: 'charge-packing',
            businessKey: 'SHIPMENT:1:PACKING_MATERIAL',
            amount: '1.00',
            priceBookId: 'logistics-book-test',
            category: { code: 'PACKING_MATERIAL' },
          },
          {
            id: 'charge-other',
            businessKey: 'ORDER:OTHER',
            amount: '7.00',
            priceBookId: null,
            category: { code: 'OTHER' },
          },
        ],
      })
      .mockResolvedValueOnce({ id: 'o1', orderNo: 'O-1' });
    dbMock.orderShipment.findMany.mockResolvedValue([
      {
        id: 'shipment-1',
        sequence: 1,
        destinationProvince: '广东',
        quotedWeightKg: '1',
        lines: [{ quantity: 1000 }],
      },
    ]);
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SHIPPED,
    });
    const clock = new Date('2026-04-25T12:00:00Z');

    await shipOrder(
      'o1',
      ownerActor,
      {
        trackingNo: null,
        shipments: [
          {
            shipmentId: 'shipment-1',
            trackingNo: 'ZTO001',
            weightKg: '2',
            destinationProvince: '广东',
            shippingFee: null,
            packingMaterialFee: '1.00',
            customerChargeOverrideReason: '发货时确认实际包材',
          },
        ],
      },
      clock,
    );

    expect(dbMock.orderCustomerCharge.update.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            where: { id: 'charge-shipping' },
            data: expect.objectContaining({
              status: 'FINAL',
              suggestedAmount: '4.30',
              amount: '4.30',
              finalizedById: 'owner-1',
              finalizedAt: clock,
            }),
          }),
        ],
        [
          expect.objectContaining({
            where: { id: 'charge-packing' },
            data: expect.objectContaining({
              status: 'FINAL',
              suggestedAmount: '0.00',
              amount: '1.00',
              overrideReason: '发货时确认实际包材',
            }),
          }),
        ],
      ]),
    );
    expect(
      dbMock.order.update.mock.calls.find(
        (call) => call[0]?.data?.totalAmount === '512.30',
      ),
    ).toBeDefined();
    expect(dbMock.orderShipment.update).toHaveBeenCalledWith({
      where: { id: 'shipment-1' },
      data: {
        trackingNo: 'ZTO001',
        weightKg: '2',
        destinationProvince: '广东',
        status: 'SHIPPED',
        shippedAt: clock,
      },
      select: { id: true },
    });
  });

  it('rejects an external non-SF shipment when any carrier-confirmed weight is missing', async () => {
    dbMock.order.findUnique
      .mockResolvedValueOnce({
        id: 'o1',
        status: OrderStatus.COMPLETED,
        submitterId: 'sales-1',
      })
      .mockResolvedValueOnce({
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        isSfCollect: false,
        processingAmount: '500.00',
        customerCharges: [
          {
            id: 'charge-shipping',
            businessKey: 'SHIPMENT:1:SHIPPING_FEE',
            amount: '2.80',
            priceBookId: 'logistics-book-test',
            category: { code: 'SHIPPING_FEE' },
          },
          {
            id: 'charge-packing',
            businessKey: 'SHIPMENT:1:PACKING_MATERIAL',
            amount: '3.00',
            priceBookId: 'logistics-book-test',
            category: { code: 'PACKING_MATERIAL' },
          },
        ],
      });
    dbMock.orderShipment.findMany.mockResolvedValue([
      {
        id: 'shipment-1',
        sequence: 1,
        destinationProvince: '广东',
        quotedWeightKg: '1',
        lines: [{ quantity: 1000 }],
      },
    ]);

    await expect(
      shipOrder('o1', ownerActor, {
        trackingNo: null,
        shipments: [
          {
            shipmentId: 'shipment-1',
            trackingNo: 'ZTO001',
            destinationProvince: '广东',
            shippingFee: null,
            packingMaterialFee: '3.00',
            customerChargeOverrideReason: null,
          },
        ],
      }),
    ).rejects.toThrow(/承运商最终计费重量/);

    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.orderShipment.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('rejects a stale or incomplete multi-address shipment list', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
    });
    dbMock.orderShipment.findMany.mockResolvedValue([
      { id: 'shipment-1', sequence: 1 },
      { id: 'shipment-2', sequence: 2 },
    ]);

    await expect(
      shipOrder('o1', ownerActor, {
        trackingNo: null,
        shipments: [{ shipmentId: 'shipment-1', trackingNo: 'SF001' }],
      }),
    ).rejects.toThrow(/发货地址已变化/);
    await expect(
      shipOrder('o1', ownerActor, {
        trackingNo: null,
        shipments: [
          { shipmentId: 'shipment-2', trackingNo: 'SF002' },
          { shipmentId: 'shipment-1', trackingNo: 'SF001' },
        ],
      }),
    ).rejects.toThrow(/发货地址已变化/);
    expect(dbMock.orderShipment.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('COMPLETED → SHIPPED, stamps shippedAt + trackingNo from arg', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SHIPPED });

    const clock = new Date('2026-04-25T12:00:00Z');
    const r = await shipOrder('o1', ownerActor, 'SF1234567890', clock);
    expect(r.status).toBe(OrderStatus.SHIPPED);
    const updateArg = dbMock.order.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe(OrderStatus.SHIPPED);
    expect(updateArg.data.shippedAt).toBe(clock);
    expect(updateArg.data.trackingNo).toBe('SF1234567890');
    // Other timestamp fields not touched
    expect(updateArg.data.submittedAt).toBeUndefined();
    expect(updateArg.data.finishedAt).toBeUndefined();

    const logArg = dbMock.orderLog.create.mock.calls[0][0];
    expect(logArg.data.action).toBe('STATUS_CHANGE');
    expect(logArg.data.remark).toBe('发货：SF1234567890');
  });

  it('null trackingNo: log uses default remark, no trackingNo field on update', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SHIPPED });
    await shipOrder('o1', ownerActor, null);
    const updateArg = dbMock.order.update.mock.calls[0][0];
    // When no trackingNo, we DON'T spread extraData → no key in data.
    expect(updateArg.data.trackingNo).toBeUndefined();
    expect(dbMock.orderLog.create.mock.calls[0][0].data.remark).toBe('标记发货');
  });

  it('trims trackingNo whitespace before logging + persisting', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SHIPPED });
    await shipOrder('o1', ownerActor, '  SF888  ');
    expect(dbMock.order.update.mock.calls[0][0].data.trackingNo).toBe('SF888');
    expect(dbMock.orderLog.create.mock.calls[0][0].data.remark).toBe('发货：SF888');
  });

  it('blank trackingNo (whitespace only) treated as null', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SHIPPED });
    await shipOrder('o1', ownerActor, '   ');
    expect(dbMock.order.update.mock.calls[0][0].data.trackingNo).toBeUndefined();
    expect(dbMock.orderLog.create.mock.calls[0][0].data.remark).toBe('标记发货');
  });

  it('refuses non-COMPLETED source state (status machine)', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.IN_PRODUCTION,
      submitterId: 'sales-1',
    });
    await expect(shipOrder('o1', ownerActor, null)).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('refuses to ship while a linked outsource order is still live', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
    });
    dbMock.outsourceOrder.findMany.mockResolvedValue([{ id: 'outsource-1' }]);
    await expect(shipOrder('o1', ownerActor, null)).rejects.toThrow(
      /外协单.*才能发货/,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  // ─── Slice C wire spec ───
  it('shipOrder fires notify("ORDER_SHIPPED") with provided trackingNo', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
      orderNo: 'O-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SHIPPED });
    await shipOrder('o1', ownerActor, 'SF1234567890');
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
      'ORDER_SHIPPED',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        trackingNo: 'SF1234567890',
      },
      { dedupeKey: 'notification:ORDER_SHIPPED:o1' },
    );
  });

  // **Round 102 P1 wire-side regression**: trackingNo: null/undefined/blank
  // 必须在传给 notify 前映射成 '未填'，否则 renderTemplate 会让模板里
  // 的 `{trackingNo}` 留 raw 字面量流到群消息（HANDOFF Slice C TODO）。
  it('shipOrder null trackingNo → notify payload trackingNo="未填"（不漏 raw {trackingNo}）', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
      orderNo: 'O-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SHIPPED });
    await shipOrder('o1', ownerActor, null);
    expect(notifyMock).toHaveBeenCalledWith(
      'ORDER_SHIPPED',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        trackingNo: '未填',
      },
      { dedupeKey: 'notification:ORDER_SHIPPED:o1' },
    );
    // 防 future-edit accidentally re-introduce null：payload.trackingNo 不能
    // 等于 null / undefined / 空字符串
    const payload = notifyMock.mock.calls[0]![1] as unknown as { trackingNo: string };
    expect(payload.trackingNo).toBeTruthy();
    expect(typeof payload.trackingNo).toBe('string');
    expect(payload.trackingNo).not.toBe('');
  });

  it('shipOrder blank/whitespace trackingNo also → "未填"', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
      orderNo: 'O-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SHIPPED });
    await shipOrder('o1', ownerActor, '   ');
    const payload = notifyMock.mock.calls[0]![1] as unknown as { trackingNo: string };
    expect(payload.trackingNo).toBe('未填');
  });

  it('shipOrder 业务异常（状态机拒绝）→ 不触发 notify', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.IN_PRODUCTION,
      submitterId: 'sales-1',
    });
    await expect(shipOrder('o1', ownerActor, 'SF1')).rejects.toThrow();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe('finishOrder', () => {
  it('SHIPPED → FINISHED, stamps finishedAt', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SHIPPED,
      submitterId: 'sales-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.FINISHED });

    const clock = new Date('2026-04-26T12:00:00Z');
    const r = await finishOrder('o1', ownerActor, clock);
    expect(r.status).toBe(OrderStatus.FINISHED);
    const updateArg = dbMock.order.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe(OrderStatus.FINISHED);
    expect(updateArg.data.finishedAt).toBe(clock);
    expect(updateArg.data.shippedAt).toBeUndefined();
    expect(dbMock.orderLog.create.mock.calls[0][0].data.remark).toBe('确认完工');
  });

  it('refuses non-SHIPPED source state (e.g. COMPLETED — must ship first)', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
    });
    await expect(finishOrder('o1', ownerActor)).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('refuses to finish an external order while any shipment charge is still estimated', async () => {
    dbMock.order.findUnique
      .mockResolvedValueOnce({
        id: 'o1',
        status: OrderStatus.SHIPPED,
        submitterId: 'sales-1',
      })
      .mockResolvedValueOnce({
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        _count: { shipments: 1 },
        customerCharges: [{ status: 'FINAL' }, { status: 'ESTIMATED' }],
      });

    await expect(finishOrder('o1', ownerActor)).rejects.toThrow(
      /快递费与打包耗材费尚未全部确认/,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });
});

describe('transitionWithLog — per-order advisory lock (Codex round 87 / P2)', () => {
  it('takes the print-shop-erp:order-cascade:<id> lock as the first DB call', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SHIPPED });

    await shipOrder('o1', ownerActor, null);
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    const sql = (dbMock.$executeRaw.mock.calls[0]![0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    // Same key namespace as production.ts orderCascadeLockKey so a
    // worker cascade can't race a manual transition on the same order.
    expect(dbMock.$executeRaw.mock.calls[0]![1]).toBe(
      'print-shop-erp:order-cascade:o1',
    );
  });
});

describe('listOrders / getOrderDetail — scope filter application', () => {
  it('applies getOrderScopeFilter (SALES sees only own) to list', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await listOrders(salesActor);
    const where = dbMock.order.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ submitterId: 'sales-1' });
  });

  it('ADMIN sees everything (empty where)', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await listOrders(ownerActor);
    const where = dbMock.order.findMany.mock.calls[0][0].where;
    expect(where).toEqual({});
  });

  it('WORKER list scope hides assigned tasks while the order is still a scheduling draft', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await listOrders(workerActor);
    const where = dbMock.order.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      status: { not: OrderStatus.SUBMITTED },
      items: { some: { tasks: { some: { workerId: 'worker-1' } } } },
    });
  });

  it('combines q search with role scope instead of replacing it', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await listOrders(salesActor, { q: ' 苹果福 ' });
    const where = dbMock.order.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      AND: [
        { submitterId: 'sales-1' },
        {
          OR: [
            { orderNo: { contains: '苹果福', mode: 'insensitive' } },
            { customName: { contains: '苹果福', mode: 'insensitive' } },
            { customerRef: { contains: '苹果福', mode: 'insensitive' } },
            { receiverName: { contains: '苹果福', mode: 'insensitive' } },
            { receiverPhone: { contains: '苹果福', mode: 'insensitive' } },
            { receiverAddress: { contains: '苹果福', mode: 'insensitive' } },
            { trackingNo: { contains: '苹果福', mode: 'insensitive' } },
            { expressCode: { contains: '苹果福', mode: 'insensitive' } },
            {
              submitter: { displayName: { contains: '苹果福', mode: 'insensitive' } },
            },
            {
              shipments: {
                some: {
                  OR: [
                    { receiverName: { contains: '苹果福', mode: 'insensitive' } },
                    { receiverPhone: { contains: '苹果福', mode: 'insensitive' } },
                    { receiverAddress: { contains: '苹果福', mode: 'insensitive' } },
                    { trackingNo: { contains: '苹果福', mode: 'insensitive' } },
                    { expressCode: { contains: '苹果福', mode: 'insensitive' } },
                  ],
                },
              },
            },
            {
              items: {
                some: {
                  OR: [
                    { name: { contains: '苹果福', mode: 'insensitive' } },
                    { specification: { contains: '苹果福', mode: 'insensitive' } },
                    { paperType: { contains: '苹果福', mode: 'insensitive' } },
                    { foilColors: { has: '苹果福' } },
                    {
                      product: {
                        name: { contains: '苹果福', mode: 'insensitive' },
                      },
                    },
                    {
                      tasks: {
                        some: {
                          status: { not: TaskStatus.CANCELLED },
                          worker: {
                            displayName: {
                              contains: '苹果福',
                              mode: 'insensitive',
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
            { searchPinyin: { contains: '苹果福', mode: 'insensitive' } },
            { searchPinyinInitials: { contains: '苹果福', mode: 'insensitive' } },
          ],
        },
      ],
    });
  });

  it('ignores blank q and keeps the plain scope filter', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await listOrders(salesActor, { q: '   ' });
    const where = dbMock.order.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ submitterId: 'sales-1' });
  });

  it('keeps the database order for search and requests strict newest-first sorting', async () => {
    const base = {
      status: OrderStatus.DRAFT,
      kind: 'NORMAL',
      isUrgent: false,
      isSfCollect: false,
      customName: null,
      customerRef: null,
      receiverName: null,
      receiverPhone: null,
      receiverAddress: null,
      trackingNo: null,
      expressCode: null,
      searchPinyin: null,
      searchPinyinInitials: null,
      totalAmount: '0.00',
      submitterId: 'sales-1',
      submitter: { displayName: '销售小王' },
      sourceOrder: null,
      _count: { shipments: 1 },
      createdAt: new Date('2026-06-28T00:00:00Z'),
      updatedAt: new Date('2026-06-28T00:00:00Z'),
    };
    dbMock.order.findMany.mockResolvedValue([
      { ...base, id: 'contains', orderNo: '20260628-0001', customerRef: '佛山苹果福' },
      { ...base, id: 'exact', orderNo: '苹果福' },
      { ...base, id: 'prefix', orderNo: '苹果福-加急' },
    ]);
    dbMock.productionTask.findMany.mockResolvedValue([
      {
        orderItem: { orderId: 'exact' },
        worker: { displayName: '张师傅' },
      },
      {
        orderItem: { orderId: 'exact' },
        worker: { displayName: '张师傅' },
      },
      {
        orderItem: { orderId: 'exact' },
        worker: { displayName: '李师傅' },
      },
    ]);

    const rows = await listOrders(salesActor, { q: '苹果福' });

    expect(dbMock.order.findMany.mock.calls[0]![0].orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['contains', 'exact', 'prefix']);
    expect(rows[1]?.submitterName).toBe('销售小王');
    expect(rows[1]?.workerNames).toEqual(['李师傅', '张师傅']);
  });

  it('getOrderDetail enforces the scope filter by id (SALES cannot peek at others)', async () => {
    dbMock.order.findFirst.mockResolvedValue(null);
    const result = await getOrderDetail('someone-elses-order', salesActor);
    expect(result).toBeNull();
    expect(dbMock.craft.findMany).not.toHaveBeenCalled();
    const arg = dbMock.order.findFirst.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: 'someone-elses-order', submitterId: 'sales-1' });
  });

  it('getOrderDetail resolves craft names once while preserving item craft order and IDs', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-with-crafts',
      items: [
        {
          id: 'item-1',
          crafts: ['craft-retired', 'craft-active', 'craft-missing'],
        },
        {
          id: 'item-2',
          crafts: ['craft-active', 'craft-retired'],
        },
      ],
    });
    dbMock.craft.findMany.mockResolvedValueOnce([
      { id: 'craft-active', name: '现行工艺', isActive: true },
      { id: 'craft-retired', name: '历史工艺', isActive: false },
    ]);

    const result = await getOrderDetail('order-with-crafts', ownerActor);

    expect(dbMock.craft.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.craft.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['craft-retired', 'craft-active', 'craft-missing'],
        },
      },
      select: { id: true, name: true },
    });
    expect(result?.items).toEqual([
      {
        id: 'item-1',
        crafts: ['craft-retired', 'craft-active', 'craft-missing'],
        craftNames: ['历史工艺', '现行工艺', '已删除工艺'],
      },
      {
        id: 'item-2',
        crafts: ['craft-active', 'craft-retired'],
        craftNames: ['现行工艺', '历史工艺'],
      },
    ]);
  });

  it('getOrderDetail adds empty craftNames without querying Craft for empty items', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-without-crafts',
      items: [
        { id: 'item-1', crafts: [] },
        { id: 'item-2', crafts: [] },
      ],
    });

    const result = await getOrderDetail('order-without-crafts', ownerActor);

    expect(dbMock.craft.findMany).not.toHaveBeenCalled();
    expect(result?.items).toEqual([
      { id: 'item-1', crafts: [], craftNames: [] },
      { id: 'item-2', crafts: [], craftNames: [] },
    ]);
  });

  it('getOrderDetail omits commercial fields and costs at the WORKER query boundary', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'worker-visible-order',
      items: [{ id: 'item-1', crafts: [] }],
    });

    const result = await getOrderDetail('worker-visible-order', workerActor);

    const query = dbMock.order.findFirst.mock.calls[0]![0];
    expect(query.omit).toEqual({
      settlementType: true,
      processingAmount: true,
      totalAmount: true,
    });
    expect(query.include.items.omit).toEqual({
      unitPrice: true,
      fixedFee: true,
      subtotal: true,
      suggestedPrice: true,
      suggestedSubtotal: true,
      pricingSnapshot: true,
      priceOverrideReason: true,
    });
    expect(query.include.logs.select).toEqual({
      id: true,
      action: true,
      createdAt: true,
      operator: { select: { displayName: true, role: true } },
    });
    expect(query.include.logs.select).not.toHaveProperty('changedFields');
    expect(query.include.logs.select).not.toHaveProperty('remark');
    expect(query.include).not.toHaveProperty('changeRequests');
    expect(query.include).not.toHaveProperty('costEntries');
    expect(result?.changeRequests).toEqual([]);
  });

  it('getOrderDetail keeps commercial fields for SALES and costs only for ADMIN', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'commercial-order',
      items: [{ id: 'item-1', crafts: [] }],
    });

    await getOrderDetail('commercial-order', salesActor);
    const salesQuery = dbMock.order.findFirst.mock.calls[0]![0];
    expect(salesQuery).not.toHaveProperty('omit');
    expect(salesQuery.include.items).not.toHaveProperty('omit');
    expect(salesQuery.include.logs.include).toEqual({
      operator: { select: { displayName: true, role: true } },
    });
    expect(salesQuery.include.changeRequests).toEqual({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        requester: { select: { displayName: true, role: true } },
        reviewedBy: { select: { displayName: true } },
      },
    });
    expect(salesQuery.include).not.toHaveProperty('costEntries');

    dbMock.order.findFirst.mockClear().mockResolvedValue({
      id: 'commercial-order',
      items: [{ id: 'item-1', crafts: [] }],
    });
    await getOrderDetail('commercial-order', ownerActor);
    const adminQuery = dbMock.order.findFirst.mock.calls[0]![0];
    expect(adminQuery).not.toHaveProperty('omit');
    expect(adminQuery.include.items).not.toHaveProperty('omit');
    expect(adminQuery.include.costEntries).toEqual({
      orderBy: { createdAt: 'asc' },
      include: {
        createdBy: { select: { displayName: true } },
      },
    });
  });

  it('getOrderDetail hides a SUBMITTED scheduling draft from its assigned WORKER', async () => {
    dbMock.order.findFirst.mockResolvedValue(null);

    await expect(
      getOrderDetail('scheduling-draft', workerActor),
    ).resolves.toBeNull();
    expect(dbMock.order.findFirst.mock.calls[0]![0].where).toEqual({
      id: 'scheduling-draft',
      status: { not: OrderStatus.SUBMITTED },
      items: {
        some: {
          tasks: { some: { workerId: 'worker-1' } },
        },
      },
    });
  });
});

describe('updateOrderFields (SPEC §3.6 — E-lean)', () => {
  function snapshot(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'order-1',
      status: OrderStatus.DRAFT,
      submitterId: 'sales-1',
      customName: null,
      customerRef: '苹果福',
      receiverName: '张三',
      receiverPhone: '13800000000',
      receiverAddress: '佛山市…',
      expressCode: null,
      packageRequirement: null,
      remark: null,
      promisedDate: null,
      isUrgent: false,
      isSfCollect: false,
      ...overrides,
    };
  }

  it('throws when the order cannot be seen (scope filter returns null)', async () => {
    dbMock.order.findFirst.mockResolvedValue(null);
    await expect(
      updateOrderFields('order-1', { remark: 'x' }, salesActor),
    ).rejects.toBeInstanceOf(OrderInvariantError);
  });

  it('throws when a non-owning SALES tries to edit another SALES\'s order', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ submitterId: 'sales-OTHER' }),
    );
    await expect(
      updateOrderFields('order-1', { remark: 'x' }, salesActor),
    ).rejects.toThrow(/只能修改自己创建的工单/);
  });

  it('ADMIN can edit someone else\'s order (global override)', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ submitterId: 'sales-OTHER' }),
    );
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.DRAFT,
    });
    const result = await updateOrderFields(
      'order-1',
      { remark: '管理员代改' },
      ownerActor,
    );
    expect(result.changed).toBe(true);
  });

  it('refuses to edit when the status is terminal (FINISHED)', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ status: OrderStatus.FINISHED }),
    );
    await expect(
      updateOrderFields('order-1', { remark: 'x' }, ownerActor),
    ).rejects.toThrow(/当前状态不可编辑/);
  });

  it('DRAFT / FULL fieldset: customerRef and isUrgent are both applied', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot());
    dbMock.order.update.mockResolvedValue({ id: 'order-1', status: OrderStatus.DRAFT });
    await updateOrderFields(
      'order-1',
      { customerRef: '新客户', isUrgent: true, remark: '新备注' },
      salesActor,
    );
    const data = dbMock.order.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.customerRef).toBe('新客户');
    expect(data.isUrgent).toBe(true);
    expect(data.remark).toBe('新备注');
  });

  it('requires the dedicated audited command for SF collect changes', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot());
    dbMock.orderCostEntry.aggregate.mockResolvedValue({
      _sum: { amount: '12.00' },
    });

    await expect(
      updateOrderFields('order-1', { isSfCollect: true }, salesActor),
    ).resolves.toMatchObject({ changed: false, changedFields: [] });

    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.order.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(dbMock.orderCostEntry.aggregate).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('SHIPPING_ONLY fieldset: customerRef and isUrgent are dropped even if submitted', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ status: OrderStatus.IN_PRODUCTION }),
    );
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
    });
    await updateOrderFields(
      'order-1',
      {
        // These two live outside the SHIPPING_ONLY allowlist and MUST be
        // ignored even if the action hands them down — SPEC §3.6 forbids
        // changing them once production starts.
        customerRef: '攻击者改',
        isUrgent: true,
        isSfCollect: true,
        receiverName: '新收货人',
        remark: '新备注',
      } as never,
      ownerActor,
    );
    const data = dbMock.order.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('customerRef');
    expect(data).not.toHaveProperty('isUrgent');
    expect(data).not.toHaveProperty('isSfCollect');
    expect(data.receiverName).toBe('新收货人');
    expect(data.remark).toBe('新备注');
  });

  it('writes an OrderLog with field-level before / after for every changed field', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ remark: null, receiverName: '旧' }),
    );
    dbMock.order.update.mockResolvedValue({ id: 'order-1', status: OrderStatus.DRAFT });
    await updateOrderFields(
      'order-1',
      { remark: '新', receiverName: '新', receiverPhone: null },
      salesActor,
    );
    const log = dbMock.orderLog.create.mock.calls[0][0].data as {
      action: string;
      changedFields: Record<string, { before: unknown; after: unknown }>;
    };
    expect(log.action).toBe('UPDATE');
    expect(log.changedFields).toMatchObject({
      remark: { before: null, after: '新' },
      receiverName: { before: '旧', after: '新' },
    });
    // receiverPhone went from the snapshot's '13800000000' to null (cleared);
    // that IS a change and should appear.
    expect(log.changedFields.receiverPhone).toEqual({
      before: '13800000000',
      after: null,
    });
    expect(dbMock.orderShipment.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1', sequence: 1 },
      data: {
        receiverName: '新',
        receiverPhone: null,
      },
    });
  });

  it('does not touch the shipment snapshot when only non-address fields change', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot({ remark: null }));
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.DRAFT,
    });
    await updateOrderFields('order-1', { remark: '只改备注' }, salesActor);
    expect(dbMock.orderShipment.updateMany).not.toHaveBeenCalled();
  });

  it('no-op edit (same values re-submitted) skips UPDATE and log entry', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot());
    const result = await updateOrderFields(
      'order-1',
      { remark: null, customerRef: '苹果福' },
      salesActor,
    );
    expect(result.changed).toBe(false);
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('empty-string input normalizes to null for text fields (cleared field)', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot({ remark: '旧备注' }));
    dbMock.order.update.mockResolvedValue({ id: 'order-1', status: OrderStatus.DRAFT });
    await updateOrderFields('order-1', { remark: '' }, salesActor);
    const data = dbMock.order.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.remark).toBeNull();
  });

  it('promisedDate 修改写入 Date 并记 diff；等值 Date 不算改动（时间戳比较）', async () => {
    const promised = new Date('2026-07-15T00:00:00Z');
    // 等值但不同实例的 Date：=== 恒 false，必须按时间戳比较判 no-op
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ promisedDate: new Date('2026-07-15T00:00:00Z') }),
    );
    const noop = await updateOrderFields(
      'order-1',
      { promisedDate: promised },
      salesActor,
    );
    expect(noop.changed).toBe(false);
    expect(dbMock.order.update).not.toHaveBeenCalled();

    // 真实修改：null → 2026-07-15，data 写 Date，diff 记录 before/after
    dbMock.order.findFirst.mockResolvedValue(snapshot({ promisedDate: null }));
    dbMock.order.update.mockResolvedValue({ id: 'order-1', status: OrderStatus.DRAFT });
    const changed = await updateOrderFields(
      'order-1',
      { promisedDate: promised },
      salesActor,
    );
    expect(changed.changed).toBe(true);
    expect(changed.changedFields).toEqual(['promisedDate']);
    const data = dbMock.order.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.promisedDate).toEqual(promised);
  });

  it('SHIPPING_ONLY 状态下 promisedDate 不在可改集合内（被静默丢弃 → no-op）', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ status: OrderStatus.IN_PRODUCTION, promisedDate: null }),
    );
    const result = await updateOrderFields(
      'order-1',
      { promisedDate: new Date('2026-07-15T00:00:00Z') },
      ownerActor,
    );
    expect(result.changed).toBe(false);
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });
});

describe('setOrderUrgent — quick toggle', () => {
  function urgentSnapshot(isUrgent: boolean) {
    return {
      id: 'order-1',
      status: OrderStatus.DRAFT,
      submitterId: 'sales-1',
      customerRef: null,
      receiverName: null,
      receiverPhone: null,
      receiverAddress: null,
      expressCode: null,
      packageRequirement: null,
      remark: null,
      promisedDate: null,
      isUrgent,
      isSfCollect: false,
    };
  }

  it('flips isUrgent from false → true and logs the change', async () => {
    dbMock.order.findFirst.mockResolvedValue(urgentSnapshot(false));
    dbMock.order.update.mockResolvedValue({ id: 'order-1', status: OrderStatus.DRAFT });
    const result = await setOrderUrgent('order-1', true, salesActor);
    expect(result.changed).toBe(true);
    expect(result.changedFields).toEqual(['isUrgent']);
    const data = dbMock.order.update.mock.calls[0][0].data as { isUrgent: boolean };
    expect(data.isUrgent).toBe(true);
  });

  it('no-op when target matches current value', async () => {
    dbMock.order.findFirst.mockResolvedValue(urgentSnapshot(true));
    const result = await setOrderUrgent('order-1', true, salesActor);
    expect(result.changed).toBe(false);
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('refuses once the order has moved past FULL-editable (isUrgent outside SHIPPING_ONLY set)', async () => {
    // isUrgent is only in the FULL set, not SHIPPING_ONLY. A toggle in
    // SCHEDULING silently drops isUrgent and reports no change — that's
    // the desired guard (preserves the flag set at intake).
    dbMock.order.findFirst.mockResolvedValue({
      ...urgentSnapshot(false),
      status: OrderStatus.SCHEDULING,
    });
    const result = await setOrderUrgent('order-1', true, ownerActor);
    expect(result.changed).toBe(false);
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });
});

describe('setOrderSfCollect — 后期履约标识', () => {
  function sfSnapshot(
    status: OrderStatus,
    isSfCollect = false,
    submitterId = 'sales-1',
    settlementType: OrderSettlementType = OrderSettlementType.INTERNAL_SALES,
  ) {
    return {
      id: 'order-1',
      status,
      submitterId,
      customName: null,
      customerRef: null,
      receiverName: null,
      receiverPhone: null,
      receiverAddress: null,
      expressCode: null,
      packageRequirement: null,
      remark: null,
      promisedDate: null,
      isUrgent: false,
      isSfCollect,
      settlementType,
      processingAmount: '5000.00',
      totalAmount: '5000.00',
    };
  }

  function externalChargeContext(overrides: {
    destinationProvince?: string | null;
    weightKg?: string | null;
    shippingAmount?: string;
    otherAmount?: string;
  } = {}) {
    return {
      shipments: [
        {
          id: 'shipment-1',
          sequence: 1,
          status: 'SHIPPED',
          destinationProvince: overrides.destinationProvince ?? null,
          quotedWeightKg: null,
          weightKg: overrides.weightKg ?? null,
          lines: [{ quantity: 1000 }],
        },
      ],
      customerCharges: [
        {
          id: 'charge-shipping',
          businessKey: 'SHIPMENT:1:SHIPPING_FEE',
          amount: overrides.shippingAmount ?? '0.00',
          overrideReason: null,
          priceBookId: 'logistics-book-test',
          shipmentId: 'shipment-1',
          category: { code: 'SHIPPING_FEE' },
        },
        {
          id: 'charge-packing',
          businessKey: 'SHIPMENT:1:PACKING_MATERIAL',
          amount: '0.00',
          overrideReason: null,
          priceBookId: 'logistics-book-test',
          shipmentId: 'shipment-1',
          category: { code: 'PACKING_MATERIAL' },
        },
        {
          id: 'charge-other',
          businessKey: 'ORDER:OTHER',
          amount: overrides.otherAmount ?? '7.00',
          overrideReason: null,
          priceBookId: null,
          shipmentId: null,
          category: { code: 'OTHER' },
        },
      ],
    };
  }

  it.each([OrderStatus.COMPLETED, OrderStatus.SHIPPED])(
    '允许在 %s 后期补录并记录日志',
    async (status) => {
      dbMock.order.findFirst.mockResolvedValue(sfSnapshot(status));
      dbMock.order.update.mockResolvedValue({ id: 'order-1', status });

      const result = await setOrderSfCollect('order-1', true, ownerActor);

      expect(result.changedFields).toEqual(['isSfCollect']);
      expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
      expect(dbMock.orderCostEntry.aggregate).toHaveBeenCalledWith({
        where: {
          orderId: 'order-1',
          category: OrderCostCategory.SHIPPING,
        },
        _sum: { amount: true },
      });
      expect(dbMock.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isSfCollect: true, totalAmount: '5000.00' },
        }),
      );
      expect(dbMock.orderLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'UPDATE',
          changedFields: {
            isSfCollect: { before: false, after: true },
          },
        }),
      });
    },
  );

  it('refuses to enable SF collect when immutable shipping rows have a non-zero net amount', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      sfSnapshot(OrderStatus.COMPLETED),
    );
    dbMock.orderCostEntry.aggregate.mockResolvedValue({
      _sum: { amount: '18.50' },
    });

    await expect(
      setOrderSfCollect('order-1', true, ownerActor),
    ).rejects.toThrow(/已有物流成本流水.*财务核对/);

    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.orderCostEntry.aggregate.mock.invocationCallOrder[0]!,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('allows enabling SF collect when historical shipping rows net to zero', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      sfSnapshot(OrderStatus.SHIPPED),
    );
    dbMock.orderCostEntry.aggregate.mockResolvedValue({
      _sum: { amount: '0.00' },
    });
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SHIPPED,
    });

    await expect(
      setOrderSfCollect('order-1', true, ownerActor),
    ).resolves.toMatchObject({ changed: true });
  });

  it('does not query shipping costs when disabling SF collect', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      sfSnapshot(OrderStatus.SHIPPED, true),
    );
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SHIPPED,
    });

    await expect(
      setOrderSfCollect('order-1', false, ownerActor),
    ).resolves.toMatchObject({ changed: true });
    expect(dbMock.orderCostEntry.aggregate).not.toHaveBeenCalled();
  });

  it('refreshes the complete external shipping charge snapshot when enabling SF collect', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      ...sfSnapshot(
        OrderStatus.SHIPPED,
        false,
        'sales-1',
        OrderSettlementType.EXTERNAL_SALES,
      ),
      totalAmount: '5011.30',
    });
    dbMock.order.findUnique.mockResolvedValue(
      externalChargeContext({
        destinationProvince: '广东',
        weightKg: '2',
        shippingAmount: '4.30',
      }),
    );
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SHIPPED,
    });

    await setOrderSfCollect('order-1', true, ownerActor);

    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledTimes(1);
    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledWith({
      where: { id: 'charge-shipping' },
      data: expect.objectContaining({
        sourceRuleId: null,
        status: 'WAIVED',
        description: '顺丰到付（自行预约）',
        suggestedAmount: '0.00',
        amount: '0.00',
        overrideReason: null,
        pricingSnapshot: expect.objectContaining({
          actual: { amount: '0.00', overrideReason: null },
        }),
      }),
    });
    expect(dbMock.orderShipment.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      data: { carrierCode: 'SF' },
    });
    expect(dbMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isSfCollect: true, totalAmount: '5007.00' },
      }),
    );
  });

  it('lets an admin cancel SF collect after shipping only with complete per-shipment facts', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      ...sfSnapshot(
        OrderStatus.SHIPPED,
        true,
        'sales-1',
        OrderSettlementType.EXTERNAL_SALES,
      ),
      totalAmount: '5007.00',
    });
    dbMock.order.findUnique.mockResolvedValue(externalChargeContext());
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SHIPPED,
    });

    const result = await setOrderSfCollect(
      'order-1',
      false,
      ownerActor,
      [
        {
          shipmentId: 'shipment-1',
          destinationProvince: '广东',
          weightKg: '2',
          shippingFee: null,
          customerChargeOverrideReason: null,
        },
      ],
    );

    expect(result.changedFields).toEqual([
      'isSfCollect',
      'totalAmount',
      'shipmentChargeCorrections',
    ]);
    expect(dbMock.orderCustomerCharge.update.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            where: { id: 'charge-shipping' },
            data: expect.objectContaining({
              status: 'FINAL',
              suggestedAmount: '4.30',
              amount: '4.30',
              finalizedById: 'owner-1',
            }),
          }),
        ],
        [
          expect.objectContaining({
            where: { id: 'charge-packing' },
            data: expect.objectContaining({
              status: 'FINAL',
              suggestedAmount: '0.00',
              amount: '0.00',
            }),
          }),
        ],
      ]),
    );
    expect(dbMock.orderShipment.update).toHaveBeenCalledWith({
      where: { id: 'shipment-1' },
      data: { destinationProvince: '广东', weightKg: '2' },
      select: { id: true },
    });
    expect(dbMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isSfCollect: false, totalAmount: '5011.30' },
      }),
    );
    expect(dbMock.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changedFields: expect.objectContaining({
          shipmentChargeCorrections: expect.objectContaining({
            after: [
              expect.objectContaining({
                shipmentId: 'shipment-1',
                destinationProvince: '广东',
                weightKg: '2',
              }),
            ],
          }),
        }),
      }),
    });
  });

  it('rejects an incomplete post-shipment SF cancellation without mutating charges', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      sfSnapshot(
        OrderStatus.SHIPPED,
        true,
        'sales-1',
        OrderSettlementType.EXTERNAL_SALES,
      ),
    );
    dbMock.order.findUnique.mockResolvedValue(externalChargeContext());

    await expect(
      setOrderSfCollect('order-1', false, ownerActor),
    ).rejects.toThrow(/必须补齐每个地址的计费信息/);

    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: '重复地址',
      corrections: [
        {
          shipmentId: 'shipment-1',
          destinationProvince: '广东',
          weightKg: '2',
          shippingFee: null,
          customerChargeOverrideReason: null,
        },
        {
          shipmentId: 'shipment-1',
          destinationProvince: '广东',
          weightKg: '2',
          shippingFee: null,
          customerChargeOverrideReason: null,
        },
      ],
      expected: /重复的发货地址/,
    },
    {
      label: '其他工单地址',
      corrections: [
        {
          shipmentId: 'shipment-other',
          destinationProvince: '广东',
          weightKg: '2',
          shippingFee: null,
          customerChargeOverrideReason: null,
        },
      ],
      expected: /不属于该工单/,
    },
  ])('拒绝$label的收费更正', async ({ corrections, expected }) => {
    dbMock.order.findFirst.mockResolvedValue(
      sfSnapshot(
        OrderStatus.SHIPPED,
        true,
        'sales-1',
        OrderSettlementType.EXTERNAL_SALES,
      ),
    );
    dbMock.order.findUnique.mockResolvedValue(externalChargeContext());

    await expect(
      setOrderSfCollect('order-1', false, ownerActor, corrections),
    ).rejects.toThrow(expected);

    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.orderShipment.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('forbids sales from changing the charge state of a shipped external order', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      sfSnapshot(
        OrderStatus.SHIPPED,
        false,
        'sales-1',
        OrderSettlementType.EXTERNAL_SALES,
      ),
    );

    await expect(
      setOrderSfCollect('order-1', true, salesActor),
    ).rejects.toThrow(/只能由管理员处理/);

    expect(dbMock.order.findUnique).not.toHaveBeenCalled();
    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it.each([OrderStatus.FINISHED, OrderStatus.CANCELLED])(
    '拒绝修改终态 %s',
    async (status) => {
      dbMock.order.findFirst.mockResolvedValue(sfSnapshot(status));
      await expect(
        setOrderSfCollect('order-1', true, ownerActor),
      ).rejects.toThrow(/不能修改顺丰到付标识/);
      expect(dbMock.order.update).not.toHaveBeenCalled();
    },
  );

  it('非管理员只能修改自己提交的工单', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      sfSnapshot(OrderStatus.SHIPPED, false, 'sales-other'),
    );
    await expect(
      setOrderSfCollect('order-1', true, salesActor),
    ).rejects.toThrow(/只能修改自己创建的工单/);
  });
});
