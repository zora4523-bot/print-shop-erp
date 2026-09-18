import { createOrderRequestFingerprint } from '@/lib/order/create-request-fingerprint';
import * as quoteService from '../order/create-order-quote-service';
vi.mock('@/lib/order/production-readiness', () => ({
  prepareOrderForProductionInTx: vi.fn(async (tx, orderId) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    return { status: order?.settlementType === 'EXTERNAL_SALES' ? 'PENDING_FACTORY' : 'SUBMITTED', ready: false, issues: ['fixture needs pricing'] };
  }),
}));
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import { Prisma } from '../../generated/prisma/client';
import {
  DesignFileType,
  OrderCostCategory,
  OrderPackagingMode,
  OrderSettlementType,
  OrderStatus,
  PartyType,
  ProductionOperationStatus,
  Role,
  TaskStatus,
} from '../../generated/prisma/enums';
import { CREATE_ORDER_GOLDEN_SNAPSHOT } from '../price/__tests__/fixtures/create-order-golden-fixtures';

const { dbMock } = vi.hoisted(() => {
  const mock: {
    order: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    orderItem: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    craft: { findMany: ReturnType<typeof vi.fn> };
    party: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
    user: { findUnique: ReturnType<typeof vi.fn> };
    product: { findMany: ReturnType<typeof vi.fn> };
    material: { findMany: ReturnType<typeof vi.fn> };
    customerPriceBook: { findMany: ReturnType<typeof vi.fn> };
    customerPriceRule: { findMany: ReturnType<typeof vi.fn> };
    customerChargeCategory: { findUnique: ReturnType<typeof vi.fn> };
    productionOperation: {
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    productionProgressStep: {
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
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
    orderPackagingGroup: { create: ReturnType<typeof vi.fn> };
    orderPackagingGroupLine: { createMany: ReturnType<typeof vi.fn> };
    orderCustomerCharge: {
      createMany: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    orderChangeRequest: { findFirst: ReturnType<typeof vi.fn> };
    orderPricingRevision: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    orderLog: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    orderCostEntry: { aggregate: ReturnType<typeof vi.fn> };
    dailyWorkerSalaryItem: { groupBy: ReturnType<typeof vi.fn> };
    $executeRaw: ReturnType<typeof vi.fn>;
    $queryRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  } = {
    order: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    orderItem: { findFirst: vi.fn(), findMany: vi.fn() },
    craft: { findMany: vi.fn() },
    party: { findUnique: vi.fn(), findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
    material: { findMany: vi.fn() },
    customerPriceBook: { findMany: vi.fn() },
    customerPriceRule: { findMany: vi.fn() },
    customerChargeCategory: { findUnique: vi.fn() },
    productionOperation: { findMany: vi.fn(), updateMany: vi.fn() },
    productionProgressStep: { findMany: vi.fn(), updateMany: vi.fn() },
    productionTask: { findMany: vi.fn(), update: vi.fn() },
    outsourceOrder: { findMany: vi.fn() },
    orderShipment: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    orderShipmentLine: { createMany: vi.fn() },
    orderPackagingGroup: { create: vi.fn() },
    orderPackagingGroupLine: { createMany: vi.fn() },
    orderCustomerCharge: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    orderChangeRequest: { findFirst: vi.fn() },
    orderPricingRevision: { create: vi.fn(), findMany: vi.fn() },
    orderLog: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    orderCostEntry: { aggregate: vi.fn() },
    dailyWorkerSalaryItem: { groupBy: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(mock);
      return fn;
    }),
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));
const { publishedCreateOrderSnapshotMock } = vi.hoisted(() => ({
  publishedCreateOrderSnapshotMock: vi.fn(),
}));
vi.mock('@/lib/order/create-order-published-rule-adapter', async () => {
  const actual = await vi.importActual<
    typeof import('../order/create-order-published-rule-adapter')
  >('../order/create-order-published-rule-adapter');
  const { acquirePriceRuleSnapshotReadLock } = await vi.importActual<
    typeof import('../price/rule-snapshot-lock')
  >('../price/rule-snapshot-lock');
  return {
    ...actual,
    readPublishedCreateOrderPriceSnapshot: async (
      tx: Parameters<typeof acquirePriceRuleSnapshotReadLock>[0],
      options: { now?: Date },
    ) => {
      await acquirePriceRuleSnapshotReadLock(tx);
      return publishedCreateOrderSnapshotMock(tx, options);
    },
  };
});
// list-query only needs this parser when date filters are present. This suite
// exercises order-domain behavior and no date-filter cases, so keep it isolated
// from the much larger refined create-order schema module.
vi.mock('@/lib/auth/schemas', () => ({ parseStrictYmd: vi.fn() }));

// Notification wire：用 spy 验证 dispatchNotification() 的事件与
// payload。模块整体替换成 spy；formatMoney 不 mock（lib/dashboard/
// format 是纯函数，测试要看真实输出）。typed as accepting any args
// so vi.fn 推断的 `[][]` 不阻 mock.calls[0]![1] 这类下标访问。
//
// dispatchNotification 是通知 wire 的实际入口（封装 Next 16
// `after()` + 单测降级 void）；spy 这里 = spy 整条 dispatch chain。
const { notifyMock } = vi.hoisted(() => ({
  notifyMock: vi.fn<(...args: unknown[]) => void>(() => undefined),
}));
const { getSettingMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: notifyMock,
}));
vi.mock('@/lib/settings', () => ({ getSetting: getSettingMock }));
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
  // No logistics charges in these fixtures: the basis equals the total.
  csSalesBasisAmountInTx: vi.fn(async (_tx: unknown, _orderId: string, total: { toString(): string }) => new Decimal(total.toString()).toFixed(2)),
  CsSalesLedgerError: MockCsSalesLedgerError,
}));
const { appendPricingRevisionMock } = vi.hoisted(() => ({
  appendPricingRevisionMock: vi.fn(),
}));
vi.mock('@/lib/order/pricing-revision', () => ({
  appendOrderPricingRevisionInTx: appendPricingRevisionMock,
}));
const {
  finalizeExternalOrderQuoteMock,
  MockExternalOrderQuoteChangedError,
  MockExternalOrderQuoteFinalizeError,
} = vi.hoisted(() => ({
  finalizeExternalOrderQuoteMock: vi.fn<
    (...args: unknown[]) => Promise<unknown>
  >(),
  MockExternalOrderQuoteChangedError: class extends Error {
    readonly quoteToken = `create-order-quote-v2:${'a'.repeat(64)}`;
    readonly quotedFee = '566.30';
    readonly quotedFeeCompleteness = 'COMPLETE';
    constructor(message = '报价已变化') {
      super(message);
    }
  },
  MockExternalOrderQuoteFinalizeError: class extends Error {},
}));
vi.mock('@/lib/order/submit-external-order', () => ({
  finalizeExternalOrderQuoteInTx: finalizeExternalOrderQuoteMock,
  ExternalOrderQuoteChangedError: MockExternalOrderQuoteChangedError,
  ExternalOrderQuoteFinalizeError: MockExternalOrderQuoteFinalizeError,
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
  OrderQuoteChangedError,
} from '../order';
import { InvalidOrderTransitionError } from '../order/status-machine';
import { previewFulfillmentPricing, finalizeFulfillmentPricing } from '../order/fulfillment-pricing';

const salesActor = { id: 'sales-1', role: Role.SALES };
const workerActor = { id: 'worker-1', role: Role.WORKER };
const ownerActor = { id: 'owner-1', role: Role.ADMIN };
const shipOrderVersionSnapshot = {
  revision: 4,
  editVersion: 8,
  workOrderVersion: 2,
  priceRevision: 3,
};
const shipOrderCommandSnapshot = {
  expectedRevision: 4,
  expectedEditVersion: 8,
  expectedWorkOrderVersion: 2,
  expectedPriceRevision: 3,
  idempotencyKey: '00000000-0000-4000-8000-000000000101',
};

const testLogisticsSource = {
  sourceName: '测试物流报价表.xlsx',
  sourceSha256: 'c'.repeat(64),
  sourceSheet: '测试',
};

const testLogisticsNotes = {
  ruleVersion: '2026-08-27',
  shipping: {
    billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
    weightResolutionOrder: [
      'ACTUAL_FULFILLMENT_WEIGHT',
      'SERVER_ESTIMATE',
    ],
    maxOrderQuantity: 2_000,
    billableWeightRounding: 'CEIL_KG',
    minimumBillableWeightKg: 1,
    gramsPerItemByPaperWeightGsm: {
      '120': 4.5,
      '150': 6,
      '160': 6,
      '180': 6.75,
      '200': 8,
      '230': 10,
    },
    tenThousandEnvelopeGramsPerItem: 10,
  },
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
    triggerCondition: {
      scope: 'ORDER_TOTAL_QUANTITY',
      segmentedAboveMaximum: true,
    },
    sourceRange: 'A2:B6',
    blocksAutomaticQuote: false,
    category: { id: 'packing-category', code: 'PACKING_MATERIAL' },
    ...testLogisticsSource,
  },
];

async function createOrder(
  input: Parameters<typeof createOrderDomain>[0],
  actor: Parameters<typeof createOrderDomain>[1],
  now?: Date,
) {
  const packagingGroups =
    actor.role === Role.SALES && input.packagingGroups === undefined
      ? input.items.map((item, itemIndex) => ({
          name: `测试包装组 ${itemIndex + 1}`,
          mode: OrderPackagingMode.SINGLE_STYLE,
          actualBagCount: 1,
          itemUnitsPerBag: input.items.map((_, candidateIndex) =>
            candidateIndex === itemIndex ? 10 : 0,
          ),
        }))
      : input.packagingGroups;
  return createOrderDomain(
    {
      destinationProvince: '广东',
      quotedWeightKg: '1',
      shippingFee: '0.00',
      packingMaterialFee: '0.00',
      customerChargeOverrideReason: '测试用例仅验证加工费语义',
      ...input,
      packagingGroups,
      receiverAddress: input.receiverAddress ?? '广东佛山测试收货地址',
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
    triggerCondition: {
      schemaVersion: 1,
      pricingRoutes: ['STOCK_BLANK'],
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
    triggerCondition: {
      schemaVersion: 1,
      pricingRoutes: ['STOCK_BLANK'],
      ...triggerCondition,
    },
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

function externalPackagingRule(
  mode: 'SINGLE_STYLE' | 'MIXED_STYLE',
  amount: string,
) {
  return {
    id: `packaging-${mode}`,
    code: `PACKAGING_${mode}`,
    name: mode === 'SINGLE_STYLE' ? '单款入袋' : '混装入袋',
    kind: 'ADD_ON',
    calculationType: 'PER_BAG',
    amount,
    minQty: null,
    maxQty: null,
    triggerCondition: {
      schemaVersion: 1,
      target: 'PACKAGING_GROUP',
      packagingModes: [mode],
    },
    exclusiveGroup: 'PACKAGING_GROUP_MODE',
    priority: 100,
    blocksAutomaticQuote: false,
    sourceSheet: '当前规则',
    sourceRange: mode === 'SINGLE_STYLE' ? 'A1' : 'A2',
    note: null,
    productId: null,
    category: { code: 'PACKING', name: '入袋与包装' },
  };
}

function baseItem(over: Partial<Record<string, unknown>> = {}) {
  return {
    name: '烫金款 A',
    productId: null,
    pricingRoute: 'STOCK_BLANK' as const,
    productStructure: 'STANDARD_ENVELOPE' as const,
    artworkVersion: null,
    plateGroupId: null,
    pricingGroup: null,
    manualQuoteReason: null,
    specification: null,
    actualWidthMm: null,
    actualHeightMm: null,
    paperType: '160g珠光艳闪',
    paperWeightGsm: 160,
    quantity: 1000,
    crafts: ['craft-1'],
    foilColors: ['哑金'],
    foilTechnique: 'FLAT' as const,
    hasLocalFoil: true,
    lamination: 'NONE' as const,
    printColors: [],
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
  getSettingMock.mockReset().mockResolvedValue({ enabled: true });
  for (const fn of Object.values(dbMock.order)) fn.mockReset();
  dbMock.order.updateMany.mockResolvedValue({ count: 1 });
  dbMock.orderItem.findFirst.mockReset().mockResolvedValue(null);
  dbMock.orderItem.findMany.mockReset().mockResolvedValue([]);
  dbMock.craft.findMany.mockReset();
  dbMock.party.findUnique.mockReset();
  dbMock.party.findFirst.mockReset().mockResolvedValue({ id: 'customer-1' });
  dbMock.user.findUnique.mockReset();
  dbMock.product.findMany.mockReset();
  dbMock.material.findMany.mockReset().mockImplementation(
    async ({ where }: { where: { category?: string; name?: { in: string[] } } }) =>
      where.category
        ? [
            {
              id: 'paper-pearl-160',
              name: '160g珠光艳闪',
              specification: '160g',
              outOfStock: false,
              isActive: true,
            },
          ]
        : (where.name?.in ?? []).map((name) => ({ name })),
  );
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
              notes: testLogisticsNotes,
              rules: testLogisticsRules,
            },
          ]
        : [activeExternalPriceBook],
    );
  dbMock.customerPriceRule.findMany
    .mockReset()
    .mockImplementation(
      async (args: { where?: { triggerCondition?: { equals?: string } } }) =>
        args.where?.triggerCondition?.equals === 'PACKAGING_GROUP'
          ? [externalPackagingRule('SINGLE_STYLE', '0.0000')]
          : [externalBaseRule()],
    );
  dbMock.customerChargeCategory.findUnique.mockReset().mockResolvedValue({
    id: 'cat-plate',
    isActive: true,
  });
  // Default: pre-cutover order with neither operations nor production tasks.
  dbMock.productionOperation.findMany.mockReset().mockResolvedValue([]);
  dbMock.productionOperation.updateMany
    .mockReset()
    .mockResolvedValue({ count: 0 });
  dbMock.productionProgressStep.findMany.mockReset().mockResolvedValue([]);
  dbMock.productionProgressStep.updateMany
    .mockReset()
    .mockResolvedValue({ count: 0 });
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
  dbMock.orderPackagingGroup.create
    .mockReset()
    .mockImplementation(async ({ data }: { data: { sequence: number } }) => ({
      id: `packaging-group-${data.sequence}`,
    }));
  dbMock.orderPackagingGroupLine.createMany
    .mockReset()
    .mockResolvedValue({ count: 1 });
  dbMock.orderCustomerCharge.createMany
    .mockReset()
    .mockResolvedValue({ count: 2 });
  dbMock.orderCustomerCharge.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderCustomerCharge.upsert.mockReset().mockResolvedValue({});
  dbMock.orderCustomerCharge.update.mockReset().mockResolvedValue({});
  dbMock.orderChangeRequest.findFirst.mockReset().mockResolvedValue(null);
  dbMock.orderPricingRevision.create.mockReset().mockResolvedValue({});
  dbMock.orderPricingRevision.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderLog.findFirst.mockReset().mockResolvedValue(null);
  dbMock.orderLog.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderLog.create.mockReset().mockResolvedValue({});
  dbMock.orderCostEntry.aggregate.mockReset().mockResolvedValue({
    _sum: { amount: null },
  });
  dbMock.order.count.mockReset().mockResolvedValue(0);
  dbMock.dailyWorkerSalaryItem.groupBy.mockReset().mockResolvedValue([]);
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$queryRaw.mockReset().mockResolvedValue([{ now: new Date('2026-09-06T03:00:00Z') }]);
  dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
    if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
    return fn;
  });
  publishedCreateOrderSnapshotMock
    .mockReset()
    .mockResolvedValue(CREATE_ORDER_GOLDEN_SNAPSHOT);
  notifyMock.mockReset().mockResolvedValue(undefined);
  assertCsOrderSalesLedgerReconciledMock
    .mockReset()
    .mockResolvedValue(undefined);
  recordCsSalesEntryMock.mockReset().mockResolvedValue(null);
  appendPricingRevisionMock.mockReset().mockResolvedValue({
    pricingRevisionId: 'pricing-revision-2',
    priceRevision: 2,
    orderRevision: 2,
    snapshot: {},
  });
  finalizeExternalOrderQuoteMock.mockReset().mockResolvedValue({
    pricingRevisionId: 'pricing-revision-2',
    quotedFee: '566.30',
    quotedFeeCompleteness: 'COMPLETE',
  });

  // Default: no existing orders for today (fresh serial), every craft
  // exists + is active, no productId references.
  dbMock.order.findFirst.mockResolvedValue(null);
  dbMock.craft.findMany.mockImplementation(
    async ({ where }: { where: { id?: { in: string[] }; code?: string } }) => {
      if (where.code === 'FLAT_FOIL_PARTIAL') {
        return [
          {
            id: 'craft-local-foil',
            code: 'FLAT_FOIL_PARTIAL',
            isActive: true,
          },
        ];
      }
      return (where.id?.in ?? []).map((id) => ({
        id,
        code:
          id === 'craft-1' || id === 'craft-local-foil'
            ? 'FLAT_FOIL_PARTIAL'
            : id === 'craft-legacy'
              ? 'STOCK_FOIL'
              : `CRAFT_${id}`,
        isActive: true,
      }));
    },
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
  it('在领域边界拒绝空白收货地址，不依赖 action schema', async () => {
    await expect(
      createOrderDomain(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: '   ',
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
          isUrgent: false,
          isSfCollect: false,
          additionalShipments: [],
          items: [baseItem()],
        },
        salesActor,
      ),
    ).rejects.toThrow('请填写收货地址');
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('校验并保存建单时选中的客户主数据', async () => {
    dbMock.party.findUnique.mockResolvedValue({
      id: 'customer-1',
      type: PartyType.CUSTOMER,
      isActive: true,
    });

    await createOrder(
      {
        customerPartyId: 'customer-1',
        customerRef: '苹果福',
        receiverName: '王小姐',
        receiverPhone: '13800000000',
        receiverAddress: '广东佛山测试收货地址',
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [baseItem()],
      },
      salesActor,
    );

    expect(dbMock.party.findUnique).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      select: { id: true, type: true, isActive: true },
    });
    expect(dbMock.order.create.mock.calls[0]![0].data).toMatchObject({
      customerPartyId: 'customer-1',
      customerRef: '苹果福',
      items: {
        create: [expect.objectContaining({ lamination: 'NONE' })],
      },
    });
  });

  it('内部配置外项目只保存说明并进入工厂人工核价', async () => {
    const result = await createOrder(
      {
        customerRef: '客户来样',
        receiverName: '王小姐',
        receiverPhone: '13800000000',
        receiverAddress: '广东佛山测试收货地址',
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        shippingFee: null,
        packingMaterialFee: null,
        customerChargeOverrideReason: null,
        items: [
          baseItem({
            pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
            productId: null,
            paperType: null,
            crafts: [],
            manualQuoteReason: '  客户来样纸与特殊击凸未进入规则配置  ',
            unitPrice: null,
            fixedFee: null,
            priceOverrideReason: null,
          }),
        ],
        packagingGroups: [
          {
            name: '客供纸测试包装组',
            mode: OrderPackagingMode.SINGLE_STYLE,
            actualBagCount: 100,
            itemUnitsPerBag: [10],
          },
        ],
      },
      ownerActor,
      new Date('2026-08-28T09:00:00+08:00'),
    );

    expect(result.pricingStatus).toBe('PENDING_ADMIN_CONFIRMATION');
    expect(dbMock.order.create.mock.calls[0]![0].data).toMatchObject({
      processingAmount: '0.00',
      totalAmount: '0.00',
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
      pricingConfirmedAt: null,
      items: {
        create: [
          expect.objectContaining({
            productId: null,
            paperType: null,
            crafts: [],
            manualQuoteReason: '客户来样纸与特殊击凸未进入规则配置',
            unitPrice: '0',
            fixedFee: '0',
            subtotal: '0.00',
            quoteDisposition: 'MANUAL_PRICING_REQUIRED',
            pricingSnapshot: expect.objectContaining({
              version: 1,
              schemaVersion: 2,
              complete: false,
              suggestedSubtotal: null,
              source: 'INTERNAL_CREATE_MANUAL_REQUIRED',
            }),
            priceOverrideReason: null,
          }),
        ],
      },
    });
  });

  it('在服务边界拒绝没有任何包装组的外部销售工单', async () => {
    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: '广东佛山测试收货地址',
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
          isUrgent: false,
          isSfCollect: false,
          packagingGroups: [],
          items: [baseItem()],
        },
        salesActor,
      ),
    ).rejects.toThrow('外部销售工单必须为每个款式设置一个包装组');
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('在服务边界拒绝不包含款式的外部销售包装组', async () => {
    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: '广东佛山测试收货地址',
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
          isUrgent: false,
          isSfCollect: false,
          packagingGroups: [
            {
              name: '空包装组',
              mode: OrderPackagingMode.SINGLE_STYLE,
              actualBagCount: 1,
              itemUnitsPerBag: [0],
            },
          ],
          items: [baseItem()],
        },
        salesActor,
      ),
    ).rejects.toThrow('包装组 1 未包含任何款式');
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('在服务边界拒绝外部销售包装组遗漏款式', async () => {
    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: '广东佛山测试收货地址',
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
          isUrgent: false,
          isSfCollect: false,
          packagingGroups: [
            {
              name: '只包含第一款',
              mode: OrderPackagingMode.SINGLE_STYLE,
              actualBagCount: 10,
              itemUnitsPerBag: [1, 0],
            },
          ],
          items: [baseItem(), baseItem({ name: '烫金款 B' })],
        },
        salesActor,
      ),
    ).rejects.toThrow('款式 2 未加入包装组，无法计算入袋费');
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('在服务边界拒绝外部销售款式重复归入多个包装组', async () => {
    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: '广东佛山测试收货地址',
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
          isUrgent: false,
          isSfCollect: false,
          packagingGroups: [
            {
              name: '第一组',
              mode: OrderPackagingMode.SINGLE_STYLE,
              actualBagCount: 10,
              itemUnitsPerBag: [1, 0],
            },
            {
              name: '重复包含第一款',
              mode: OrderPackagingMode.MIXED_STYLE,
              actualBagCount: 10,
              itemUnitsPerBag: [1, 1],
            },
          ],
          items: [baseItem(), baseItem({ name: '烫金款 B' })],
        },
        salesActor,
      ),
    ).rejects.toThrow(
      '款式 1 同时属于多个包装组，不能重复计算入袋费',
    );
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('拒绝将供应商当作客户绑定到工单', async () => {
    dbMock.party.findUnique.mockResolvedValue({
      id: 'supplier-1',
      type: PartyType.SUPPLIER,
      isActive: true,
    });

    await expect(
      createOrder(
        {
          customerPartyId: 'supplier-1',
          customerRef: '错误客户',
          receiverName: null,
          receiverPhone: null,
          receiverAddress: '广东佛山测试收货地址',
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
          isUrgent: false,
          isSfCollect: false,
          items: [baseItem()],
        },
        salesActor,
      ),
    ).rejects.toThrow('所选往来单位不是客户');
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });

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

  it('外部销售 DRAFT 只保存包装组事实与服务端袋数，不提前报价', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRODUCT_1',
        category: 'BLANK_STOCK',
        isActive: true,
        baseUnitPrice: '1.0000',
        minOrderQty: null,
      },
    ]);
    dbMock.customerPriceRule.findMany.mockImplementation(
      async (args: {
        where?: { triggerCondition?: { equals?: string } };
      }) =>
        args.where?.triggerCondition?.equals === 'PACKAGING_GROUP'
          ? [
              externalPackagingRule('SINGLE_STYLE', '0.1000'),
              externalPackagingRule('MIXED_STYLE', '0.2000'),
            ]
          : [externalBaseRule()],
    );

    await createOrder(
      {
        customerRef: '入袋规则测试客户',
        receiverName: '测试收件人',
        receiverPhone: '13800000000',
        receiverAddress: '广东佛山测试收货地址',
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [
          baseItem({ productId: 'product-1', quantity: 20 }),
          baseItem({ productId: 'product-1', name: '烫金款 B', quantity: 30 }),
          baseItem({ productId: 'product-1', name: '烫金款 C', quantity: 30 }),
        ],
        packagingGroups: [
          {
            name: '单款装',
            mode: 'SINGLE_STYLE',
            actualBagCount: 999,
            itemUnitsPerBag: [1, 0, 0],
          },
          {
            name: '混装',
            mode: 'MIXED_STYLE',
            actualBagCount: 999,
            itemUnitsPerBag: [0, 2, 2],
          },
        ],
      },
      salesActor,
      new Date('2026-08-26T09:00:00+08:00'),
    );

    // 旧断言把预览的 0.1/0.2 元入袋费当成 DRAFT 财务记录；
    // 现在必须等提交 finalizer 在同一价格快照下锁价。
    expect(dbMock.order.create.mock.calls[0]![0].data).toMatchObject({
      packagingAmount: '0.00',
      processingAmount: '0.00',
      totalAmount: '0.00',
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
      priceRevision: 0,
    });
    expect(dbMock.orderPackagingGroup.create.mock.calls).toEqual([
      [
        expect.objectContaining({
          data: expect.objectContaining({
            sequence: 1,
            mode: 'SINGLE_STYLE',
            actualBagCount: 20,
            unitPrice: '0.0000',
            subtotal: '0.00',
            suggestedSubtotal: null,
            priceOverrideReason: null,
          }),
        }),
      ],
      [
        expect.objectContaining({
          data: expect.objectContaining({
            sequence: 2,
            mode: 'MIXED_STYLE',
            actualBagCount: 15,
            unitPrice: '0.0000',
            subtotal: '0.00',
            suggestedSubtotal: null,
            priceOverrideReason: null,
          }),
        }),
      ],
    ]);
    expect(
      dbMock.orderPackagingGroup.create.mock.calls[0]![0].data,
    ).not.toHaveProperty('pricingSnapshot');
    expect(
      dbMock.orderPackagingGroup.create.mock.calls[1]![0].data,
    ).not.toHaveProperty('pricingSnapshot');
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderCustomerCharge.createMany).not.toHaveBeenCalled();
    expect(dbMock.orderPricingRevision.create).not.toHaveBeenCalled();
  });

  it('外部销售建 DRAFT 不读取入袋规则，缺价也不写临时快照', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRODUCT_1',
        category: 'BLANK_STOCK',
        isActive: true,
        baseUnitPrice: '1.0000',
        minOrderQty: null,
      },
    ]);
    dbMock.customerPriceRule.findMany.mockImplementation(
      async (args: {
        where?: { triggerCondition?: { equals?: string } };
      }) =>
        args.where?.triggerCondition?.equals === 'PACKAGING_GROUP'
          ? [externalPackagingRule('SINGLE_STYLE', '0.1000')]
          : [externalBaseRule()],
    );

    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: '广东佛山测试收货地址',
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [
          baseItem({ productId: 'product-1', quantity: 30 }),
          baseItem({ productId: 'product-1', name: '烫金款 B', quantity: 30 }),
        ],
        packagingGroups: [
          {
            name: '未覆盖的混装',
            mode: 'MIXED_STYLE',
            actualBagCount: 15,
            itemUnitsPerBag: [2, 2],
          },
        ],
      },
      salesActor,
    );

    expect(dbMock.order.create.mock.calls[0]![0].data).toMatchObject({
      packagingAmount: '0.00',
      processingAmount: '0.00',
      totalAmount: '0.00',
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
      priceRevision: 0,
    });
    expect(dbMock.orderPackagingGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unitPrice: '0.0000',
          subtotal: '0.00',
          suggestedSubtotal: null,
          priceOverrideReason: null,
        }),
      }),
    );
    expect(
      dbMock.orderPackagingGroup.create.mock.calls[0]![0].data,
    ).not.toHaveProperty('pricingSnapshot');
    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderPricingRevision.create).not.toHaveBeenCalled();
  });

  it('acquires the shared price-rule lock exactly once before every product read', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRODUCT_1',
        category: 'BLANK_STOCK',
        specification: '大号封90×165',
        paperType: '160g珠光艳闪',
        paperMaterialId: null,
        weight: 160,
        isActive: true,
        baseUnitPrice: '0.5000',
        minOrderQty: null,
      },
    ]);

    await createOrderDomain(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: '广东佛山测试收货地址',
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [
          baseItem({
            productId: 'product-1',
            specification: '大号封90×165',
            actualWidthMm: 90,
            actualHeightMm: 165,
            pricingGroup: 'LARGE',
          }),
        ],
        packagingGroups: [
          {
            name: '内部建单测试包装组',
            mode: OrderPackagingMode.SINGLE_STYLE,
            actualBagCount: 100,
            itemUnitsPerBag: [10],
          },
        ],
      },
      ownerActor,
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

  it.each([['0.00', true], ['0.02', false]] as const)('建单半分复算允许舍入、固定费偏差 %s 的结果为 %s', async (fixedFee, allowed) => {
    dbMock.product.findMany.mockResolvedValue([{ id: 'product-1', code: 'EXT-STOCK-PEARL-FLASH-160-LARGE', category: 'BLANK_STOCK', specification: '大号封90×165', paperType: '160g珠光艳闪', paperMaterialId: null, weight: 160, isActive: true }]);
    const actual = quoteService.calculateCreateOrderQuoteFromCatalogInTx;
    const spy = vi.spyOn(quoteService, 'calculateCreateOrderQuoteFromCatalogInTx').mockImplementation(async (...args) => {
      const result = await actual(...args);
      result.quote = { ...result.quote, knownTotal: new Decimal(result.quote.knownTotal).minus(result.quote.items[0]!.amount!).plus('244.08').toFixed(2), items: [{ ...result.quote.items[0]!, status: 'QUOTED', amount: '244.08' }] };
      result.processing.items[0] = { ...result.processing.items[0]!, complete: true, suggestedUnitPrice: '0.3250', suggestedFixedFee: fixedFee, suggestedSubtotal: '244.08' };
      return result;
    });
    try {
      const call = createOrder({ shippingFee: null, packingMaterialFee: null, customerChargeOverrideReason: null, customerRef: null, receiverName: null, receiverPhone: null, receiverAddress: '广东测试地址', expressCode: null, packageRequirement: null, remark: null, promisedDate: null, isUrgent: false, isSfCollect: false,
        items: [baseItem({ quantity: 751, productId: 'product-1', specification: '大号封90×165', actualWidthMm: 90, actualHeightMm: 165, pricingGroup: 'LARGE', unitPrice: null, fixedFee: null, priceOverrideReason: null })],
        packagingGroups: [{ name: '包装', mode: OrderPackagingMode.SINGLE_STYLE, actualBagCount: 76, itemUnitsPerBag: [10] }],
      }, ownerActor);
      if (allowed) {
        await expect(call).resolves.toBeDefined();
        expect(dbMock.order.create.mock.calls.at(-1)![0].data.items.create[0]).toMatchObject({ unitPrice: '0.3250', fixedFee, subtotal: '244.08' });
      } else await expect(call).rejects.toThrow('纯引擎分项与小计不一致');
    } finally { spy.mockRestore(); }
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

  it('defaults plate fees to zero and automatically quotes an internal order', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'EXT-STOCK-PEARL-FLASH-160-LARGE',
        category: 'BLANK_STOCK',
        specification: '大号封90×165',
        paperType: '160g珠光艳闪',
        paperMaterialId: null,
        weight: 160,
        isActive: true,
      },
    ]);
    const result = await createOrderDomain(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: '广东佛山测试收货地址',
        expressCode: null,
        destinationProvince: '广东',
        quotedWeightKg: '1',
        shippingFee: null,
        packingMaterialFee: null,
        customerChargeOverrideReason: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [
          baseItem({
            productId: 'product-1',
            specification: '大号封90×165',
            actualWidthMm: 90,
            actualHeightMm: 165,
            pricingGroup: 'LARGE',
          }),
        ],
        packagingGroups: [
          {
            name: '内部建单测试包装组',
            mode: OrderPackagingMode.SINGLE_STYLE,
            actualBagCount: 100,
            itemUnitsPerBag: [10],
          },
        ],
      },
      ownerActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );

    expect(dbMock.order.create.mock.calls[0]![0].data.pricingStatus).toBe(
      'AUTO_CONFIRMED',
    );
    expect(
      dbMock.order.create.mock.calls[0]![0].data.items.create[0]
        .pricingSnapshot,
    ).toMatchObject({
      version: 1,
      schemaVersion: 2,
      complete: true,
      suggestedSubtotal: '170.00',
      source: 'INTERNAL_CREATE_AUTO',
    });
    expect(result.pricingStatus).toBe('AUTO_CONFIRMED');
    expect(dbMock.orderCustomerCharge.upsert).not.toHaveBeenCalled();
    expect(dbMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 30_000,
    });
    expect(dbMock.orderShipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          destinationProvince: '广东',
          quotedWeightKg: '1',
        }),
      }),
    );
    expect(dbMock.orderPricingRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        revision: 1,
        status: 'AUTO_CONFIRMED',
        source: 'ORDER_CREATED_AUTO',
      }),
    });
    expect(dbMock.orderPackagingGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unitPrice: '0.1000',
          subtotal: '10.00',
          suggestedSubtotal: '10.00',
        }),
      }),
    );
  });

  it('内部纯彩印无烫金建单不查也不写制版收费，价格自动确认', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-print',
        code: 'PRINT-COATED-200-LARGE',
        category: 'COLOR_PRINT',
        specification: '大号封90×165',
        paperType: '200g铜版纸',
        paperMaterialId: null,
        weight: 200,
        isActive: true,
      },
    ]);
    dbMock.craft.findMany.mockResolvedValue([
      { id: 'craft-print', code: 'COATED_COLOR_PRINT', isActive: true },
    ]);
    dbMock.material.findMany.mockImplementation(
      async ({ where }: { where: { category?: string; name?: { in: string[] } } }) =>
        where.category
          ? [
              {
                id: 'paper-coated-200',
                name: '铜版纸',
                specification: '200g',
                outOfStock: false,
                isActive: true,
              },
            ]
          : (where.name?.in ?? []).map((name) => ({ name })),
    );

    const result = await createOrderDomain(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: '广东佛山测试收货地址',
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [
          baseItem({
            name: '纯彩印款',
            productId: 'product-print',
            pricingRoute: 'COLOR_PRINT',
            specification: '大号封90×165',
            actualWidthMm: 90,
            actualHeightMm: 165,
            pricingGroup: 'LARGE',
            paperType: '200g铜版纸',
            paperWeightGsm: 200,
            crafts: ['craft-print'],
            frontFoilColors: [],
            backFoilColors: [],
            foilColors: [],
            foilTechnique: 'NONE',
            hasLocalFoil: false,
            printColors: ['CMYK'],
          }),
        ],
        packagingGroups: [
          {
            name: '纯彩印包装组',
            mode: OrderPackagingMode.SINGLE_STYLE,
            actualBagCount: 100,
            itemUnitsPerBag: [10],
          },
        ],
      },
      ownerActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );

    expect(result.pricingStatus).toBe('AUTO_CONFIRMED');
    expect(dbMock.order.create.mock.calls[0]![0].data).toMatchObject({
      pricingStatus: 'AUTO_CONFIRMED',
      processingAmount: '320.00',
      totalAmount: '320.00',
    });
    expect(dbMock.customerChargeCategory.findUnique).not.toHaveBeenCalled();
    expect(dbMock.orderCustomerCharge.upsert).not.toHaveBeenCalled();
    expect(dbMock.orderPricingRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'AUTO_CONFIRMED',
        source: 'ORDER_CREATED_AUTO',
      }),
    });
  });

  it('ignores external-sales weight and fee overrides at order creation', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRODUCT_1',
        category: 'BLANK_STOCK',
        isActive: true,
        baseUnitPrice: '0.5000',
      },
    ]);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '0.5000' }),
    ]);

    const result = await createOrder(
      {
        customerRef: '苹果福',
        receiverName: '张三',
        receiverPhone: '13800000000',
        receiverAddress: '广东佛山',
        expressCode: null,
        destinationProvince: '广东',
        quotedWeightKg: '12.5',
        shippingFee: '2.80',
        packingMaterialFee: '3.00',
        customerChargeOverrideReason: '本票使用加厚纸箱',
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

    const orderData = dbMock.order.create.mock.calls[0]![0].data;
    expect(orderData.processingAmount).toBe('0.00');
    expect(orderData.totalAmount).toBe('0.00');
    expect(orderData.priceRevision).toBe(0);
    expect(orderData.pricingStatus).toBe('PENDING_ADMIN_CONFIRMATION');
    expect(result.pricingStatus).toBe('PENDING_ADMIN_CONFIRMATION');
    expect(dbMock.orderShipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quotedWeightKg: null }),
      }),
    );
    expect(dbMock.orderCustomerCharge.createMany).not.toHaveBeenCalled();
    expect(dbMock.orderPricingRevision.create).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
  });

  it('款式重量事实不完整时仍只存 DRAFT 事实，不伪造物流费', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRODUCT_1',
        category: 'BLANK_STOCK',
        isActive: true,
        baseUnitPrice: '0.5000',
      },
    ]);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '0.5000' }),
    ]);

    const pendingResult = await createOrder(
      {
        customerRef: '苹果福',
        receiverName: '张三',
        receiverPhone: '13800000000',
        receiverAddress: '广东佛山',
        expressCode: null,
        destinationProvince: '广东',
        quotedWeightKg: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [
          baseItem({
            productId: 'product-1',
            paperWeightGsm: null,
            productStructure: 'UNSPECIFIED',
          }),
        ],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );

    const orderData = dbMock.order.create.mock.calls[0]![0].data;
    expect(orderData.pricingStatus).toBe('PENDING_ADMIN_CONFIRMATION');
    expect(orderData.totalAmount).toBe('0.00');
    expect(orderData.items.create[0]).toMatchObject({
      paperWeightGsm: null,
      productStructure: 'UNSPECIFIED',
      unitPrice: '0',
      fixedFee: '0',
      subtotal: '0.00',
      suggestedSubtotal: null,
    });
    expect(orderData.items.create[0]).not.toHaveProperty('pricingSnapshot');
    expect(pendingResult.pricingStatus).toBe('PENDING_ADMIN_CONFIRMATION');
    expect(dbMock.orderShipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quotedWeightKg: null }),
      }),
    );
    expect(dbMock.orderCustomerCharge.createMany).not.toHaveBeenCalled();
    expect(dbMock.orderPricingRevision.create).not.toHaveBeenCalled();
  });

  it('完整价表存在时也不把预览报价落入外部销售 DRAFT', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRODUCT_1',
        category: 'BLANK_STOCK',
        isActive: true,
        baseUnitPrice: '0.2000',
      },
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
            frontFoilColors: ['哑金', '亮金'],
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
    expect(data.totalAmount).toBe('0.00');
    expect(data.processingAmount).toBe('0.00');
    expect(data.packagingAmount).toBe('0.00');
    expect(data.priceRevision).toBe(0);
    expect(data.pricingStatus).toBe('PENDING_ADMIN_CONFIRMATION');
    expect(data.items.create[0]).toMatchObject({
      unitPrice: '0',
      fixedFee: '0',
      subtotal: '0.00',
      suggestedSubtotal: null,
      priceOverrideReason: null,
    });
    expect(data.items.create[0]).not.toHaveProperty('pricingSnapshot');
    expect(data.items.create[0]).not.toHaveProperty('suggestedPrice');
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderPricingRevision.create).not.toHaveBeenCalled();
  });

  it('ignores an external-sales manual price and leaves all DRAFT price columns empty', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRODUCT_1',
        category: 'BLANK_STOCK',
        isActive: true,
        baseUnitPrice: '0.1000',
      },
    ]);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '0.1000' }),
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
              unitPrice: '0.2000',
              fixedFee: '0',
              priceOverrideReason: null,
            }),
          ],
          packagingGroups: [
            {
              name: '大额测试包装组',
              mode: OrderPackagingMode.SINGLE_STYLE,
              actualBagCount: 9_999_999,
              itemUnitsPerBag: [1],
            },
          ],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      );
    expect(dbMock.order.create.mock.calls[0]![0].data).toMatchObject({
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
      items: {
        create: [
          expect.objectContaining({
            unitPrice: '0',
            fixedFee: '0',
            subtotal: '0.00',
            suggestedSubtotal: null,
            priceOverrideReason: null,
          }),
        ],
      },
    });
    expect(
      dbMock.order.create.mock.calls[0]![0].data.items.create[0],
    ).not.toHaveProperty('pricingSnapshot');
  });

  it('does not persist external-sales client price component allocation', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRODUCT_1',
        category: 'BLANK_STOCK',
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
              unitPrice: '1.0100',
              fixedFee: '0',
              priceOverrideReason: null,
            }),
          ],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      );
    expect(dbMock.order.create.mock.calls[0]![0].data).toMatchObject({
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
      items: {
        create: [
          expect.objectContaining({
            unitPrice: '0',
            fixedFee: '0',
            subtotal: '0.00',
            suggestedSubtotal: null,
            priceOverrideReason: null,
          }),
        ],
      },
    });
    expect(
      dbMock.order.create.mock.calls[0]![0].data.items.create[0],
    ).not.toHaveProperty('pricingSnapshot');
  });

  it('does not compare browser price formatting while creating an external DRAFT', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRODUCT_1',
        category: 'BLANK_STOCK',
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
      unitPrice: '0',
      fixedFee: '0',
      subtotal: '0.00',
      suggestedSubtotal: null,
      priceOverrideReason: null,
    });
    expect(
      dbMock.order.create.mock.calls[0]![0].data.items.create[0],
    ).not.toHaveProperty('pricingSnapshot');
    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
  });

  it('keeps an unmatched below-MOQ style at zero until an admin sets the final price', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRODUCT_1',
        category: 'BLANK_STOCK',
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
          items: [belowMoqItem],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      );
    expect(dbMock.order.create.mock.calls[0]![0].data).toMatchObject({
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
      processingAmount: '0.00',
      items: {
        create: [
          expect.objectContaining({
            unitPrice: '0',
            fixedFee: '0',
            subtotal: '0.00',
          }),
        ],
      },
    });
    dbMock.order.create.mockClear();

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
      unitPrice: '0',
      fixedFee: '0',
      subtotal: '0.00',
      suggestedSubtotal: null,
      priceOverrideReason: null,
    });
    expect(createdItem).not.toHaveProperty('pricingSnapshot');
    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderPricingRevision.create).not.toHaveBeenCalled();
  });

  it('rejects an automatically derived subtotal that exceeds Decimal(12,2)', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRODUCT_1',
        category: 'BLANK_STOCK',
        specification: '大号封90×165',
        paperType: '160g珠光艳闪',
        paperMaterialId: null,
        weight: 160,
        isActive: true,
        baseUnitPrice: '999999.9999',
      },
    ]);
    publishedCreateOrderSnapshotMock.mockResolvedValue({
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      partial: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial,
        blankUnitPrices: CREATE_ORDER_GOLDEN_SNAPSHOT.partial.blankUnitPrices.map(
          (row, index) =>
            index === 0 ? { ...row, unitPrice: '999999.9999' } : row,
        ),
      },
    });

    await expect(
      createOrderDomain(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: '广东佛山测试收货地址',
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
              specification: '大号封90×165',
              actualWidthMm: 90,
              actualHeightMm: 165,
              pricingGroup: 'LARGE',
              unitPrice: null,
              fixedFee: null,
              priceOverrideReason: null,
            }),
          ],
        },
        ownerActor,
        new Date('2026-04-23T09:00:00+08:00'),
      ),
    ).rejects.toThrow(/建议(?:金额|小计)超过系统上限/);
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });

  it('rejects a multi-item total that exceeds Decimal(12,2)', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'EXT-STOCK-PEARL-FLASH-160-LARGE',
        category: 'BLANK_STOCK',
        specification: '大号封90×165',
        paperType: '160g珠光艳闪',
        paperMaterialId: null,
        weight: 160,
        isActive: true,
      },
    ]);
    publishedCreateOrderSnapshotMock.mockResolvedValue({
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      partial: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial,
        blankUnitPrices: CREATE_ORDER_GOLDEN_SNAPSHOT.partial.blankUnitPrices.map(
          (row, index) =>
            index === 0 ? { ...row, unitPrice: '999999.0000' } : row,
        ),
      },
    });
    const hugeLine = baseItem({
      productId: 'product-1',
      quantity: 6_000,
      specification: '大号封90×165',
      actualWidthMm: 90,
      actualHeightMm: 165,
      pricingGroup: 'LARGE',
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
          items: [hugeLine, { ...hugeLine, name: '烫金款 B' }],
          packagingGroups: [
            {
              name: '烫金款 A 包装组',
              mode: OrderPackagingMode.SINGLE_STYLE,
              actualBagCount: 1,
              itemUnitsPerBag: [10, 0],
            },
            {
              name: '烫金款 B 包装组',
              mode: OrderPackagingMode.SINGLE_STYLE,
              actualBagCount: 1,
              itemUnitsPerBag: [0, 10],
            },
          ],
        },
        ownerActor,
        new Date('2026-04-23T09:00:00+08:00'),
      ),
    ).rejects.toThrow(/工单总金额超过系统上限/);
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
    expect(dbMock.orderCustomerCharge.createMany).not.toHaveBeenCalled();
    expect(dbMock.orderPricingRevision.create).not.toHaveBeenCalled();
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

  it('normalizes a direct stock-route command onto the canonical local-foil craft before persistence', async () => {
    dbMock.craft.findMany.mockImplementationOnce(async () => [
      {
        id: 'craft-packing',
        code: 'PACKING',
        isActive: true,
      },
      {
        id: 'craft-legacy',
        code: 'STOCK_FOIL',
        isActive: false,
      },
    ]);

    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: '广东佛山测试地址',
        expressCode: null,
        packageRequirement: null,
        remark: null,
        promisedDate: null,
        isUrgent: false,
        isSfCollect: false,
        items: [
          baseItem({ crafts: ['craft-packing', 'craft-legacy'] }),
        ],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );

    expect(
      dbMock.order.create.mock.calls[0]![0].data.items.create[0].crafts,
    ).toEqual(['craft-packing', 'craft-local-foil']);
  });

  it('rejects a stock-route command when the canonical local-foil craft is unavailable', async () => {
    dbMock.craft.findMany.mockImplementation(
      async ({ where }: { where: { id?: { in: string[] }; code?: string } }) =>
        where.code === 'FLAT_FOIL_PARTIAL'
          ? []
          : (where.id?.in ?? []).map((id) => ({
              id,
              code: `CRAFT_${id}`,
              isActive: true,
            })),
    );

    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: '广东佛山测试地址',
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: null,
          isUrgent: false,
          isSfCollect: false,
          items: [baseItem({ crafts: ['craft-packing'] })],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      ),
    ).rejects.toThrow('没有启用的“局部烫金”工艺');
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });

  it('refuses an absent product through direct fact validation without running a quote', async () => {
    dbMock.product.findMany.mockResolvedValueOnce([]);
    let caught: unknown;
    try {
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
          items: [baseItem({ productId: 'p1' })],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OrderInvariantError);
    expect(caught).toMatchObject({
      message: '产品不存在：p1',
    });
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });

  it('顺丰到付只作为 DRAFT 物流事实，不提前生成快递或纸箱费', async () => {
    dbMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRODUCT_1',
        category: 'BLANK_STOCK',
        isActive: true,
        baseUnitPrice: '0.1000',
      },
      {
        id: 'product-2',
        code: 'PRODUCT_2',
        category: 'BLANK_STOCK',
        isActive: true,
        baseUnitPrice: '0.2000',
      },
    ]);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({
        id: 'base-product-1',
        amount: '0.1000',
        productId: 'product-1',
      }),
      externalBaseRule({
        id: 'base-product-2',
        amount: '0.2000',
        productId: 'product-2',
      }),
    ]);
    dbMock.customerPriceBook.findMany.mockImplementation(
      async (args: { where?: { purpose?: string } }) =>
        args.where?.purpose === 'LOGISTICS'
          ? [
              {
                id: 'logistics-book-test',
                code: 'LOGISTICS_TEST',
                name: '外部销售物流测试价目簿',
                version: 1,
                sourceName: testLogisticsSource.sourceName,
                sourceSha256: testLogisticsSource.sourceSha256,
                notes: testLogisticsNotes,
                rules: testLogisticsRules.map((rule) =>
                  rule.id === 'packing-test'
                    ? { ...rule, amount: '3.00' }
                    : rule,
                ),
              },
            ]
          : [activeExternalPriceBook],
    );

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
        packingMaterialFee: '9.00',
        customerChargeOverrideReason: '本票使用加厚纸箱',
        items: [
          baseItem({ productId: 'product-1', quantity: 3, unitPrice: '9.9' }),
          baseItem({
            name: 'B',
            productId: 'product-2',
            quantity: 2,
            unitPrice: '9.9',
          }),
        ],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );
    const createArg = dbMock.order.create.mock.calls[0][0];
    expect(createArg.data.items.create[0].subtotal).toBe('0.00');
    expect(createArg.data.items.create[1].subtotal).toBe('0.00');
    expect(createArg.data.processingAmount).toBe('0.00');
    expect(createArg.data.totalAmount).toBe('0.00');
    expect(createArg.data.priceRevision).toBe(0);
    expect(createArg.data.isSfCollect).toBe(true);
    expect(dbMock.orderShipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          carrierCode: 'SF',
          quotedWeightKg: null,
        }),
      }),
    );
    expect(dbMock.orderCustomerCharge.createMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderPricingRevision.create).not.toHaveBeenCalled();
  });

  it('加工费待定时保留可验证款式与分配事实，留给提交时报价', async () => {
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
    expect(dbMock.orderShipmentLine.createMany).toHaveBeenCalledWith({
      data: [
        {
          shipmentId: 'shipment-1',
          orderItemId: 'item-1',
          quantity: 500,
        },
      ],
    });
    expect(dbMock.orderCustomerCharge.createMany).not.toHaveBeenCalled();
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
  // 通知 wire 接入后 submitOrder 走两次 findUnique：
  //   1. tx 内取 { id, status, submitterId } 走状态机
  //   2. tx 后取 { id, orderNo, customerRef, totalAmount, isUrgent,
  //              submitter.displayName } 喂 notify
  // mockResolvedValue 复用同一返回值就够了（第一次读 .status，
  // 第二次读 .totalAmount 等；都是属性存取，互不干扰）。
  const submittedRichRow = {
    id: 'o1',
    status: OrderStatus.DRAFT,
    submitterId: 'sales-1',
    receiverAddress: '佛山市南海区测试路 1 号',
    receiverPhone: null,
    settlementType: OrderSettlementType.INTERNAL_SALES,
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

  it('拒绝退役前保存的内销 120g 草稿首次提交', async () => {
    dbMock.order.findUnique.mockResolvedValue(submittedRichRow);
    dbMock.orderItem.findMany.mockResolvedValue([{ paperType: '120g珠光艳闪', paperWeightGsm: 120 }]);
    await expect(submitOrder('o1', salesActor)).rejects.toThrow('120g 纸张已停用');
    expect(dbMock.orderItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId: 'o1' } }));
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

  it.each([
    ['null', null],
    ['空字符串', ''],
    ['纯空格', '   '],
  ])('外部销售工单收货人手机号为%s时拒绝提交', async (_label, receiverPhone) => {
    dbMock.order.findUnique.mockResolvedValue({
      ...submittedRichRow,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      receiverPhone,
    });

    await expect(submitOrder('o1', salesActor)).rejects.toThrow(
      /缺少收货人手机号.*补全.*提交/,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('外部销售工单每个款式至少需要一张设计图片', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      ...submittedRichRow,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      receiverPhone: '13800000000',
    });
    dbMock.orderItem.findFirst.mockResolvedValue({ sequence: 2 });

    await expect(submitOrder('o1', salesActor)).rejects.toThrow(
      /第 2 款缺少设计图片.*上传.*提交/,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(dbMock.orderItem.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: 'o1',
        designs: { none: { fileType: DesignFileType.IMAGE } },
      },
      orderBy: { sequence: 'asc' },
      select: { sequence: true },
    });
  });

  it('外部销售工单的所有款式都有设计图片时可提交', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      ...submittedRichRow,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      receiverPhone: '13800000000',
    });
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.PENDING_FACTORY,
    });

    await expect(submitOrder('o1', salesActor)).resolves.toMatchObject({
      status: OrderStatus.PENDING_FACTORY,
    });
    expect(finalizeExternalOrderQuoteMock).toHaveBeenCalledWith(
      dbMock,
      'o1',
      'sales-1',
      expect.any(Date),
      null,
    );
    expect(dbMock.order.update).toHaveBeenCalledTimes(1);
  });

  it('外部提交重算失败时保持草稿并返回可理解的业务错误', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      ...submittedRichRow,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      receiverPhone: '13800000000',
    });
    finalizeExternalOrderQuoteMock.mockRejectedValue(
      new MockExternalOrderQuoteFinalizeError('当前纸张已缺货，请重新选择'),
    );

    await expect(submitOrder('o1', salesActor)).rejects.toThrow(
      '当前纸张已缺货，请重新选择',
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('外部报价已变化时保持草稿并上抛可结构化复核的错误', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      ...submittedRichRow,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      receiverPhone: '13800000000',
    });
    finalizeExternalOrderQuoteMock.mockRejectedValue(
      new MockExternalOrderQuoteChangedError('报价已变化'),
    );

    await expect(
      submitOrder(
        'o1',
        salesActor,
        new Date('2026-08-28T00:00:00.000Z'),
        `create-order-quote-v2:${'0'.repeat(64)}`,
      ),
    ).rejects.toBeInstanceOf(OrderQuoteChangedError);
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('内部工单保持既有流程，不要求手机号或设计图片', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      ...submittedRichRow,
      receiverPhone: null,
    });
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SUBMITTED,
    });

    await expect(submitOrder('o1', salesActor)).resolves.toMatchObject({
      status: OrderStatus.SUBMITTED,
    });
    expect(dbMock.orderItem.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['空字符串', ''],
    ['纯空格', '   '],
  ])('防御性拒绝收货地址为%s的直接领域提交', async (_label, receiverAddress) => {
    dbMock.order.findUnique.mockResolvedValue({
      ...submittedRichRow,
      receiverAddress,
    });

    await expect(submitOrder('o1', salesActor)).rejects.toThrow(
      /缺少收货地址.*补全.*再提交/,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('refuses the submit when the current status is not DRAFT', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.IN_PRODUCTION,
      submitterId: 'sales-1',
      receiverAddress: '佛山市南海区测试路 1 号',
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

  // ─── Notification wire spec ───
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
        urgentMark: '',
        summary: '新工单已提交，待处理资料或费用',
        deepLink: '/orders#wo=O-1',
      },
      { dedupeKey: 'notification:ORDER_SUBMITTED:o1' },
    );
  });

  it('新单通知关闭时不投递 ORDER_SUBMITTED', async () => {
    getSettingMock.mockResolvedValue({ enabled: false });
    dbMock.order.findUnique.mockResolvedValue(submittedRichRow);
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SUBMITTED,
    });

    await submitOrder('o1', salesActor);

    expect(notifyMock).not.toHaveBeenCalled();
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
  it('directly cancels a rejected pre-confirmation order and logs the reason', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
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

  it('rejects an empty reason at the domain boundary before reading the order', async () => {
    await expect(cancelOrder('o1', ownerActor, '   ')).rejects.toThrow(
      '取消原因必填',
    );
    expect(dbMock.order.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    OrderStatus.CONFIRMED,
    OrderStatus.RELEASED,
    OrderStatus.FOILING,
    OrderStatus.PACKING,
    OrderStatus.SHIPPED,
  ])('fails closed for direct cancellation from %s', async (status) => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status,
      submitterId: 'sales-1',
    });

    await expect(cancelOrder('o1', ownerActor, '客户取消')).rejects.toThrow(
      /取消申请/,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('refuses to cancel terminal states (FINISHED)', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.FINISHED,
      submitterId: 'sales-1',
    });
    await expect(cancelOrder('o1', ownerActor, '测试取消')).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
  });

  it('bulk-cancels new PENDING operations without reading legacy tasks', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionOperation.findMany.mockResolvedValue([
      {
        id: 'op-1',
        status: ProductionOperationStatus.PENDING,
        _count: { reports: 0 },
      },
      {
        id: 'op-2',
        status: ProductionOperationStatus.PENDING,
        _count: { reports: 0 },
      },
    ]);
    dbMock.productionOperation.updateMany.mockResolvedValue({ count: 2 });
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.CANCELLED,
    });

    await cancelOrder('o1', ownerActor, '客户取消');

    expect(dbMock.productionOperation.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: 'o1',
        status: ProductionOperationStatus.PENDING,
      },
      data: { status: ProductionOperationStatus.CANCELLED },
    });
    expect(dbMock.productionTask.findMany).not.toHaveBeenCalled();
    expect(
      dbMock.orderLog.create.mock.calls.map((call) => call[0].data.remark),
    ).toContain('随工单取消 2 个未报工工序');
  });

  it('bulk-cancels PENDING no-pay progress with new operations in the same tx', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionOperation.findMany.mockResolvedValue([
      {
        id: 'op-1',
        status: ProductionOperationStatus.PENDING,
        _count: { reports: 0 },
      },
    ]);
    dbMock.productionProgressStep.findMany.mockResolvedValue([
      {
        id: 'progress-1',
        status: ProductionOperationStatus.PENDING,
        _count: { reports: 0 },
      },
      {
        id: 'progress-2',
        status: ProductionOperationStatus.PENDING,
        _count: { reports: 0 },
      },
    ]);
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.CANCELLED,
    });

    await cancelOrder('o1', ownerActor, '客户取消');

    expect(dbMock.productionProgressStep.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: 'o1',
        status: ProductionOperationStatus.PENDING,
      },
      data: { status: ProductionOperationStatus.CANCELLED },
    });
    expect(dbMock.productionTask.findMany).not.toHaveBeenCalled();
    expect(
      dbMock.orderLog.create.mock.calls.map((call) => call[0].data.remark),
    ).toContain('随工单取消 2 个未报工无计件进度步骤');
  });

  it('fails closed when no-pay progress exists without a new operation generation', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionProgressStep.findMany.mockResolvedValue([
      {
        id: 'progress-orphan',
        status: ProductionOperationStatus.PENDING,
        _count: { reports: 0 },
      },
    ]);

    await expect(cancelOrder('o1', ownerActor, '测试取消')).rejects.toThrow(
      /孤立的无计件进度步骤/,
    );
    expect(dbMock.productionProgressStep.updateMany).not.toHaveBeenCalled();
    expect(dbMock.productionTask.findMany).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('blocks cancellation when a no-pay progress step has any report', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionOperation.findMany.mockResolvedValue([
      {
        id: 'op-1',
        status: ProductionOperationStatus.PENDING,
        _count: { reports: 0 },
      },
    ]);
    dbMock.productionProgressStep.findMany.mockResolvedValue([
      {
        id: 'progress-1',
        status: ProductionOperationStatus.PENDING,
        _count: { reports: 1 },
      },
    ]);

    await expect(cancelOrder('o1', ownerActor, '测试取消')).rejects.toThrow(
      /已报工的无计件进度/,
    );
    expect(dbMock.productionProgressStep.updateMany).not.toHaveBeenCalled();
    expect(dbMock.productionOperation.updateMany).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it.each([
    ProductionOperationStatus.IN_PROGRESS,
    ProductionOperationStatus.COMPLETED,
  ])('blocks cancellation for a %s no-pay progress step', async (status) => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionOperation.findMany.mockResolvedValue([
      {
        id: 'op-1',
        status: ProductionOperationStatus.PENDING,
        _count: { reports: 0 },
      },
    ]);
    dbMock.productionProgressStep.findMany.mockResolvedValue([
      { id: 'progress-1', status, _count: { reports: 0 } },
    ]);

    await expect(cancelOrder('o1', ownerActor, '测试取消')).rejects.toThrow(
      /已报工的无计件进度/,
    );
    expect(dbMock.productionProgressStep.updateMany).not.toHaveBeenCalled();
    expect(dbMock.productionOperation.updateMany).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('blocks cancellation when a new operation has any report', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionOperation.findMany.mockResolvedValue([
      {
        id: 'op-1',
        status: ProductionOperationStatus.PENDING,
        _count: { reports: 1 },
      },
    ]);

    await expect(cancelOrder('o1', ownerActor, '测试取消')).rejects.toThrow(
      /已报工的生产工序/,
    );
    expect(dbMock.productionOperation.updateMany).not.toHaveBeenCalled();
    expect(dbMock.productionTask.findMany).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it.each([
    ProductionOperationStatus.IN_PROGRESS,
    ProductionOperationStatus.COMPLETED,
  ])('blocks cancellation for a %s new operation', async (status) => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionOperation.findMany.mockResolvedValue([
      { id: 'op-1', status, _count: { reports: 0 } },
    ]);

    await expect(cancelOrder('o1', ownerActor, '测试取消')).rejects.toThrow(
      /已报工的生产工序/,
    );
    expect(dbMock.productionOperation.updateMany).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('blocks cancellation unless every new operation is still PENDING', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionOperation.findMany.mockResolvedValue([
      {
        id: 'op-1',
        status: ProductionOperationStatus.PENDING,
        _count: { reports: 0 },
      },
      {
        id: 'op-2',
        status: ProductionOperationStatus.CANCELLED,
        _count: { reports: 0 },
      },
    ]);

    await expect(cancelOrder('o1', ownerActor, '测试取消')).rejects.toThrow(
      /只能整单取消全部待处理工序/,
    );
    expect(dbMock.productionOperation.updateMany).not.toHaveBeenCalled();
    expect(dbMock.productionTask.findMany).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  // Historical compatibility: orders without operations still close their
  // legacy ProductionTask rows in the same transaction.

  it('voids every PENDING task to CANCELLED in the same cancel tx', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
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
    expect(remarks).toContain('随历史工单取消 2 个未开工任务');
  });

  it('取消工单时清理仍在抢单池的任务上下文', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 't-pool', status: TaskStatus.PENDING, isSelfClaimable: true },
    ]);
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.CANCELLED,
    });

    await cancelOrder('o1', ownerActor, '客户取消');
    expect(dbMock.productionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't-pool' },
        data: {
          status: TaskStatus.CANCELLED,
          isSelfClaimable: false,
          selfClaimOpenedAt: null,
          selfClaimedAt: null,
          claimMachineTypes: [],
        },
      }),
    );
  });

  it('取消已抢但未开工任务时保留抢单时间与机型快照', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 't-claimed', status: TaskStatus.PENDING, isSelfClaimable: false },
    ]);
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.CANCELLED,
    });

    await cancelOrder('o1', ownerActor, '客户取消');
    const data = dbMock.productionTask.update.mock.calls[0][0].data;
    expect(data).toEqual({
      status: TaskStatus.CANCELLED,
      isSelfClaimable: false,
    });
    expect(data.selfClaimedAt).toBeUndefined();
    expect(data.selfClaimOpenedAt).toBeUndefined();
    expect(data.claimMachineTypes).toBeUndefined();
  });

  it('blocks cancel when a task is already IN_PROGRESS — writes nothing (no half-cancel)', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 't1', status: TaskStatus.IN_PROGRESS },
    ]);

    await expect(cancelOrder('o1', ownerActor, '测试取消')).rejects.toBeInstanceOf(
      OrderInvariantError,
    );
    await expect(cancelOrder('o1', ownerActor, '测试取消')).rejects.toThrow(
      /已开工\/已报工任务/,
    );
    // Cascade throws BEFORE the order row or any task is written.
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('blocks cancel when a task is already COMPLETED — no cascade, no order write', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 't1', status: TaskStatus.COMPLETED },
    ]);

    await expect(cancelOrder('o1', ownerActor, '测试取消')).rejects.toBeInstanceOf(
      OrderInvariantError,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('blocks cancel when a linked outsource order is SENT/IN_PROGRESS (A1-A2) — no writes', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    // Tasks are all PENDING (task check passes); the outsource order is
    // what blocks the cancel.
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 't1', status: TaskStatus.PENDING },
    ]);
    dbMock.outsourceOrder.findMany.mockResolvedValue([{ id: 'os1' }]);

    await expect(cancelOrder('o1', ownerActor, '测试取消')).rejects.toBeInstanceOf(
      OrderInvariantError,
    );
    await expect(cancelOrder('o1', ownerActor, '测试取消')).rejects.toThrow(
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
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionTask.findMany.mockResolvedValue([]);
    // The status:{ in: [SENT, IN_PROGRESS] } filter means RECEIVED /
    // CANCELLED outsource orders never come back from this query.
    dbMock.outsourceOrder.findMany.mockResolvedValue([]);
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });

    const r = await cancelOrder('o1', ownerActor, '测试取消');
    expect(r.status).toBe(OrderStatus.CANCELLED);
    // The block query filters to in-flight statuses only.
    const where = dbMock.outsourceOrder.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['SENT', 'IN_PROGRESS']);
  });

  it('voids only PENDING tasks, leaving already-CANCELLED siblings untouched', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.REJECTED,
      submitterId: 'sales-1',
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 't1', status: TaskStatus.PENDING },
      { id: 't2', status: TaskStatus.CANCELLED },
    ]);
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });

    await cancelOrder('o1', ownerActor, '测试取消');
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

    const r = await cancelOrder('o1', ownerActor, '清理草稿');
    expect(r.status).toBe(OrderStatus.CANCELLED);
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
    // Only the status-change log; no task-cascade log.
    const remarks = dbMock.orderLog.create.mock.calls.map((c) => c[0].data.remark);
    expect(remarks).toEqual(['取消：清理草稿']);
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
      status: OrderStatus.PENDING_FACTORY,
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
      status: OrderStatus.PENDING_FACTORY,
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
  beforeEach(() => {
    dbMock.orderShipment.findMany.mockResolvedValue([
      {
        id: 'shipment-1',
        sequence: 1,
        destinationProvince: null,
        weightKg: null,
        lines: [],
      },
    ]);
  });

  function shippableOrder(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
      orderNo: 'O-1',
      settlementType: OrderSettlementType.INTERNAL_SALES,
      pricingStatus: 'AUTO_CONFIRMED',
      ...shipOrderVersionSnapshot,
      ...overrides,
    };
  }

  const oneShipmentCommand = {
    ...shipOrderCommandSnapshot,
    trackingNo: 'SF001',
    shipments: [{ shipmentId: 'shipment-1', trackingNo: 'SF001' }],
  };

  function fulfillmentShippingStore() {
    const makeCharge = (id: string, code: string, amount: string) => ({
      id, orderId: 'o1', shipmentId: code === 'OTHER' ? null : 'shipment-1',
      businessKey: code === 'OTHER' ? 'ORDER:OTHER' : `SHIPMENT:1:${code}`,
      categoryId: `category-${code}`, category: { code }, priceBookId: null,
      sourceRuleId: null, status: 'ESTIMATED', quantity: new Decimal('2'),
      unit: 'kg', unitPrice: null, suggestedAmount: new Decimal(amount), amount: new Decimal(amount),
      overrideReason: '已审核人工收费', isAdjustment: false, approvalReference: null,
      pricingSnapshot: { source: 'ORIGINAL_APPROVED' } as Record<string, unknown>,
    });
    const current = {
      id: 'o1', orderNo: 'O-1', submitterId: 'sales-1', ...shipOrderVersionSnapshot,
      settlementType: OrderSettlementType.EXTERNAL_SALES, status: OrderStatus.COMPLETED as OrderStatus,
      pricingStatus: 'ADMIN_CONFIRMED', isSfCollect: false, settledAt: null, settledFee: null,
      processingAmount: new Decimal('112'), packagingAmount: new Decimal('12'),
      totalAmount: new Decimal('155'), confirmedFee: new Decimal('155'), quotedFee: new Decimal('150'),
      quotedPricingRevisionId: 'original-quote', _count: { changeRequests: 0 },
      items: [{ id: 'item-1', sequence: 1, quantity: 1000, unitPrice: new Decimal('0.09'), fixedFee: new Decimal('10'), subtotal: new Decimal('100'), pricingSnapshot: { source: 'MANUAL_LOCKED' } }],
      packagingGroups: [{ id: 'group-1', mode: 'SINGLE_STYLE', actualBagCount: 100, unitPrice: new Decimal('0.12'), subtotal: new Decimal('12'), pricingSnapshot: { source: 'PACKING_LOCKED' } }],
      customerCharges: [makeCharge('shipping-1', 'SHIPPING_FEE', '8'), makeCharge('packing-1', 'PACKING_MATERIAL', '5'), makeCharge('other-1', 'OTHER', '30')],
      shipments: [{ id: 'shipment-1', sequence: 1, destinationProvince: '广东', weightKg: new Decimal('2'), lines: [{ orderItemId: 'item-1', quantity: 1000 }] }],
    };
    const snapshot = (source: string) => ({
      id: `revision-${current.priceRevision}`, orderId: current.id, revision: current.priceRevision,
      status: current.pricingStatus, source, createdById: ownerActor.id,
      snapshot: JSON.parse(JSON.stringify({ order: current, items: current.items,
        packagingGroups: current.packagingGroups,
        customerCharges: current.customerCharges.map((charge) => ({ ...charge, categoryCode: charge.category.code })),
      })),
    });
    const revisions = [snapshot('FACTORY_CONFIRM_CURRENT_PUBLISHED')];
    const copy = () => ({ ...current, customerCharges: current.customerCharges.map((charge) => ({ ...charge })),
      shipments: current.shipments.map((shipment) => ({ ...shipment })) });
    const logs: Array<{ changedFields: unknown }> = [];
    dbMock.order.findFirst.mockImplementation(async () => copy());
    dbMock.order.findUnique.mockImplementation(async () => copy());
    dbMock.orderLog.create.mockImplementation(async ({ data }) => { logs.push(data); return data; });
    dbMock.orderLog.findMany.mockImplementation(async () => logs);
    dbMock.orderPricingRevision.findMany.mockImplementation(async () => [...revisions]);
    dbMock.order.update.mockImplementation(async ({ data }) => {
      Object.assign(current, data);
      for (const key of ['totalAmount', 'confirmedFee', 'quotedFee'] as const) {
        if (data[key] != null) current[key] = new Decimal(data[key]);
      }
      return copy();
    });
    dbMock.orderCustomerCharge.update.mockImplementation(async ({ where, data }) => {
      const charge = current.customerCharges.find((row) => row.id === where.id)!;
      Object.assign(charge, data);
      for (const key of ['amount', 'suggestedAmount', 'quantity'] as const) {
        if (data[key] != null) charge[key] = new Decimal(data[key]);
      }
      return charge;
    });
    dbMock.orderShipment.update.mockImplementation(async ({ where, data }) => {
      const shipment = current.shipments.find((row) => row.id === where.id)!;
      Object.assign(shipment, data);
      if (data.weightKg != null) shipment.weightKg = new Decimal(data.weightKg);
      return shipment;
    });
    dbMock.orderShipment.findMany.mockImplementation(async () => current.shipments.map((shipment) => ({ ...shipment })));
    appendPricingRevisionMock.mockImplementation(async (_tx, input) => {
      current.priceRevision += 1;
      current.revision += 1;
      current.pricingStatus = input.status;
      revisions.unshift(snapshot(input.source));
      return { priceRevision: current.priceRevision, orderRevision: current.revision, pricingRevisionId: revisions[0]!.id };
    });
    return current;
  }

  async function confirmFulfillmentForShipping(isSfCollect: boolean) {
    const current = fulfillmentShippingStore();
    const input = { orderId: current.id, isSfCollect, shipments: isSfCollect ? [] : [{
      shipmentId: 'shipment-1', destinationProvince: '广东', weightKg: '2',
      shippingFee: '19.50', customerChargeOverrideReason: '承运商实际账单',
    }] };
    const preview = await previewFulfillmentPricing(input, ownerActor);
    const result = await finalizeFulfillmentPricing({ ...input, ...preview,
      idempotencyKey: 'd1111111-2222-4333-8444-555555555555', shipments: input.shipments,
    }, ownerActor);
    return { current, result };
  }

  it.each([true, false])('ships after real fulfilment confirmation (SF=%s), preserving approved manual freight, packaging and other charges', async (isSfCollect) => {
    const { current, result } = await confirmFulfillmentForShipping(isSfCollect);
    expect(result.confirmedFee).toBe(isSfCollect ? '147.00' : '166.50');
    dbMock.orderCustomerCharge.update.mockClear();
    dbMock.order.update.mockClear();
    await expect(shipOrder(current.id, ownerActor, {
      ...oneShipmentCommand, expectedRevision: result.revision, expectedPriceRevision: result.priceRevision,
    })).resolves.toMatchObject({ status: OrderStatus.SHIPPED });
    expect(current.totalAmount.toFixed(2)).toBe(result.confirmedFee);
    expect(current.confirmedFee.toFixed(2)).toBe(result.confirmedFee);
    expect(current.customerCharges.map((row) => row.amount.toFixed(2))).toEqual([isSfCollect ? '0.00' : '19.50', '5.00', '30.00']);
    expect(current.customerCharges.map((row) => row.status)).toEqual([isSfCollect ? 'WAIVED' : 'FINAL', 'FINAL', 'ESTIMATED']);
    expect(current.processingAmount.toFixed(2)).toBe('112.00');
    expect(current.packagingGroups[0]!.unitPrice.toFixed(2)).toBe('0.12');
    expect(current.workOrderVersion).toBe(shipOrderVersionSnapshot.workOrderVersion);
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
    for (const [call] of dbMock.orderCustomerCharge.update.mock.calls) expect(call.data).not.toHaveProperty('amount');
    for (const [call] of dbMock.order.update.mock.calls) expect(call.data).not.toHaveProperty('totalAmount');
  });

  it('retains manual freight across sales SF on/off pending changes and the real UI confirmation payload', async () => {
    const { current } = await confirmFulfillmentForShipping(false);
    for (const [index, isSfCollect] of [true, false].entries()) {
      await setOrderSfCollect(current.id, isSfCollect, salesActor, [], {
        expectedOrderRevision: current.revision, expectedEditVersion: current.editVersion,
        expectedWorkOrderVersion: current.workOrderVersion, expectedPriceRevision: current.priceRevision,
        idempotencyKey: `a1111111-2222-4333-8444-55555555555${index}`,
      });
      expect(current.pricingStatus).toBe('PENDING_ADMIN_CONFIRMATION');
      expect(current.confirmedFee).toBeNull();
    }
    const input = { orderId: current.id, isSfCollect: false, shipments: [{
      shipmentId: 'shipment-1', destinationProvince: '广东', weightKg: '2',
      shippingFee: null, customerChargeOverrideReason: null,
    }] };
    const preview = await previewFulfillmentPricing(input, ownerActor);
    expect(preview).toMatchObject({ canConfirm: true, newTotal: '166.50' });
    await expect(finalizeFulfillmentPricing({ ...input, ...preview, shipments: input.shipments,
      idempotencyKey: 'a1111111-2222-4333-8444-555555555553',
    }, ownerActor)).resolves.toMatchObject({ confirmedFee: '166.50' });
    expect(current.customerCharges[0]!.amount.toFixed(2)).toBe('19.50');
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
  });

  it.each([
    { weightKg: '3' },
    { destinationProvince: '浙江' },
    { shippingFee: '20.00' },
    { packingMaterialFee: '9.00' },
  ])('requires another fulfilment review when shipping changes approved facts: %j', async (changedFacts) => {
    const { current, result } = await confirmFulfillmentForShipping(false);
    dbMock.orderCustomerCharge.update.mockClear();
    dbMock.orderShipment.update.mockClear();
    await expect(shipOrder(current.id, ownerActor, {
      ...oneShipmentCommand, expectedRevision: result.revision, expectedPriceRevision: result.priceRevision,
      shipments: [{ shipmentId: 'shipment-1', trackingNo: 'ZTO001', ...changedFacts }],
    })).rejects.toThrow(/履约/);
    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.orderShipment.update).not.toHaveBeenCalled();
    expect(current.status).toBe(OrderStatus.COMPLETED);
  });

  it.each([
    OrderSettlementType.EXTERNAL_SALES,
    OrderSettlementType.INTERNAL_SALES,
    OrderSettlementType.FACTORY_DIRECT,
    OrderSettlementType.NO_CHARGE,
  ])('blocks %s shipping when the authoritative shipment set is empty', async (settlementType) => {
    dbMock.order.findUnique.mockResolvedValue(
      shippableOrder({ settlementType }),
    );
    dbMock.orderShipment.findMany.mockResolvedValue([]);

    await expect(
      shipOrder('o1', ownerActor, oneShipmentCommand),
    ).rejects.toThrow(/没有发货地址/);
    expect(dbMock.orderChangeRequest.findFirst).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('blocks a versioned command that omits the stored shipment details', async () => {
    dbMock.order.findUnique.mockResolvedValue(shippableOrder());

    await expect(
      shipOrder('o1', ownerActor, {
        ...shipOrderCommandSnapshot,
        trackingNo: 'SF001',
        shipments: [],
      }),
    ).rejects.toThrow(/缺少地址明细/);
    expect(dbMock.orderChangeRequest.findFirst).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('keeps legacy external-sales callers from bypassing per-address charge finalization', async () => {
    dbMock.order.findUnique.mockResolvedValue(
      shippableOrder({ settlementType: OrderSettlementType.EXTERNAL_SALES }),
    );

    await expect(shipOrder('o1', ownerActor, 'SF001')).rejects.toThrow(
      /发货前必须逐地址确认快递费与打包耗材费/,
    );
    expect(dbMock.orderChangeRequest.findFirst).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(appendPricingRevisionMock).not.toHaveBeenCalled();
  });

  it('blocks shipping when a pending change appears after the page snapshot', async () => {
    dbMock.order.findUnique.mockResolvedValue(shippableOrder());
    dbMock.orderChangeRequest.findFirst.mockResolvedValue({ id: 'change-1' });

    await expect(
      shipOrder('o1', ownerActor, oneShipmentCommand),
    ).rejects.toThrow(/待裁决变更申请/);
    expect(dbMock.productionOperation.findMany).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('blocks shipping while a current W2 operation is incomplete', async () => {
    dbMock.order.findUnique.mockResolvedValue(shippableOrder());
    dbMock.productionOperation.findMany.mockResolvedValue([
      { status: ProductionOperationStatus.PENDING },
    ]);

    await expect(
      shipOrder('o1', ownerActor, oneShipmentCommand),
    ).rejects.toThrow(/未完成的生产工序/);
    expect(dbMock.productionTask.findMany).not.toHaveBeenCalled();
    expect(dbMock.outsourceOrder.findMany).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('blocks shipping while a current W2 progress step is incomplete', async () => {
    dbMock.order.findUnique.mockResolvedValue(shippableOrder());
    dbMock.productionOperation.findMany.mockResolvedValue([
      { status: ProductionOperationStatus.COMPLETED },
    ]);
    dbMock.productionProgressStep.findMany.mockResolvedValue([
      { status: ProductionOperationStatus.IN_PROGRESS },
    ]);

    await expect(
      shipOrder('o1', ownerActor, oneShipmentCommand),
    ).rejects.toThrow(/未完成的生产工序/);
    expect(dbMock.productionTask.findMany).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('blocks pre-cutover shipping while a legacy production task is incomplete', async () => {
    dbMock.order.findUnique.mockResolvedValue(shippableOrder());
    dbMock.productionTask.findMany.mockResolvedValue([
      { status: TaskStatus.IN_PROGRESS },
    ]);

    await expect(
      shipOrder('o1', ownerActor, oneShipmentCommand),
    ).rejects.toThrow(/未完成的生产工序/);
    expect(dbMock.outsourceOrder.findMany).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('rejects a same-id shipment command after its source facts changed', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
      settlementType: OrderSettlementType.INTERNAL_SALES,
      pricingStatus: 'AUTO_CONFIRMED',
      revision: 4,
      editVersion: 9,
      workOrderVersion: 2,
      priceRevision: 3,
    });

    await expect(
      shipOrder('o1', ownerActor, {
        ...shipOrderCommandSnapshot,
        trackingNo: 'SF001',
        shipments: [
          { shipmentId: 'shipment-1', trackingNo: 'SF001' },
        ],
      }),
    ).rejects.toThrow(/版本已变化/);

    expect(dbMock.outsourceOrder.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderShipment.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('replays an identical request after response loss and rejects changed content under the same key', async () => {
    const completedSnapshot = {
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
      orderNo: 'O-1',
      settlementType: OrderSettlementType.INTERNAL_SALES,
      pricingStatus: 'AUTO_CONFIRMED',
      ...shipOrderVersionSnapshot,
    };
    const command = {
      ...shipOrderCommandSnapshot,
      trackingNo: 'SF001',
      shipments: [{ shipmentId: 'shipment-1', trackingNo: 'SF001' }],
    };
    dbMock.order.findUnique.mockResolvedValue(completedSnapshot);
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SHIPPED,
    });

    await expect(shipOrder('o1', ownerActor, command)).resolves.toMatchObject({
      status: OrderStatus.SHIPPED,
      idempotentReplay: false,
    });
    expect(dbMock.orderLog.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: 'o1',
        action: 'STATUS_CHANGE',
        changedFields: {
          path: ['shipRequest', 'after', 'idempotencyKey'],
          equals: shipOrderCommandSnapshot.idempotencyKey,
        },
      },
      select: { changedFields: true },
    });
    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.orderLog.findFirst.mock.invocationCallOrder[0]!,
    );
    const firstAudit = dbMock.orderLog.create.mock.calls[0]?.[0].data
      .changedFields;
    expect(firstAudit).toMatchObject({
      shipRequest: {
        before: null,
        after: {
          idempotencyKey: shipOrderCommandSnapshot.idempotencyKey,
          fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
          expectedRevision: 4,
          expectedEditVersion: 8,
          expectedWorkOrderVersion: 2,
          expectedPriceRevision: 3,
        },
      },
    });

    const writesAfterFirst = {
      orders: dbMock.order.update.mock.calls.length,
      logs: dbMock.orderLog.create.mock.calls.length,
      notifications: notifyMock.mock.calls.length,
    };
    dbMock.order.findUnique.mockReset().mockResolvedValue({
      ...completedSnapshot,
      status: OrderStatus.SHIPPED,
      revision: 99,
      priceRevision: 4,
    });
    dbMock.orderLog.findFirst.mockResolvedValue({ changedFields: firstAudit });

    await expect(shipOrder('o1', ownerActor, command)).resolves.toMatchObject({
      status: OrderStatus.SHIPPED,
      idempotentReplay: true,
    });
    expect(dbMock.order.update).toHaveBeenCalledTimes(writesAfterFirst.orders);
    expect(dbMock.orderLog.create).toHaveBeenCalledTimes(writesAfterFirst.logs);
    expect(notifyMock).toHaveBeenCalledTimes(writesAfterFirst.notifications);

    await expect(
      shipOrder('o1', ownerActor, {
        ...command,
        shipments: [
          { shipmentId: 'shipment-1', trackingNo: 'SF-CHANGED' },
        ],
      }),
    ).rejects.toThrow(/同一发货请求标识已用于不同内容/);
    expect(dbMock.order.update).toHaveBeenCalledTimes(writesAfterFirst.orders);
    expect(dbMock.orderLog.create).toHaveBeenCalledTimes(writesAfterFirst.logs);
  });

  it('ships every stored address atomically with its own tracking number', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
      orderNo: 'O-1',
      ...shipOrderVersionSnapshot,
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
        ...shipOrderCommandSnapshot,
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
    expect(
      dbMock.orderShipment.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(dbMock.orderChangeRequest.findFirst.mock.invocationCallOrder[0]!);
    expect(
      dbMock.orderChangeRequest.findFirst.mock.invocationCallOrder[0],
    ).toBeLessThan(dbMock.productionOperation.findMany.mock.invocationCallOrder[0]!);
    expect(
      dbMock.productionOperation.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      dbMock.productionProgressStep.findMany.mock.invocationCallOrder[0]!,
    );
    expect(
      dbMock.productionProgressStep.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(dbMock.productionTask.findMany.mock.invocationCallOrder[0]!);
    expect(
      dbMock.productionTask.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(dbMock.outsourceOrder.findMany.mock.invocationCallOrder[0]!);
    expect(dbMock.productionOperation.findMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', workOrderVersion: 2 },
      select: { status: true },
    });
    expect(dbMock.productionProgressStep.findMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', workOrderVersion: 2 },
      select: { status: true },
    });
  });

  it('allows PACKING to ship after every authoritative guard passes', async () => {
    dbMock.order.findUnique.mockResolvedValue(
      shippableOrder({ status: OrderStatus.PACKING }),
    );
    dbMock.order.update.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SHIPPED,
    });

    await expect(
      shipOrder('o1', ownerActor, oneShipmentCommand),
    ).resolves.toMatchObject({
      status: OrderStatus.SHIPPED,
      idempotentReplay: false,
    });
  });

  it('finalizes administrator-entered actual shipment charges without discarding them', async () => {
    dbMock.order.findUnique
      .mockResolvedValueOnce({
        id: 'o1',
        status: OrderStatus.COMPLETED,
        submitterId: 'sales-1',
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        pricingStatus: 'ADMIN_CONFIRMED',
        ...shipOrderVersionSnapshot,
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
        ...shipOrderCommandSnapshot,
        trackingNo: null,
        shipments: [
          {
            shipmentId: 'shipment-1',
            trackingNo: 'ZTO001',
            weightKg: '2',
            destinationProvince: '广东',
            shippingFee: '4.50',
            packingMaterialFee: '1.25',
            customerChargeOverrideReason: '承运商与包材实际结算金额',
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
              amount: '4.50',
              overrideReason: '承运商与包材实际结算金额',
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
              amount: '1.25',
              overrideReason: '承运商与包材实际结算金额',
            }),
          }),
        ],
      ]),
    );
    expect(
      dbMock.order.update.mock.calls.find(
        (call) => call[0]?.data?.totalAmount === '512.75',
      ),
    ).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: '512.75',
          confirmedFee: '512.75',
        }),
      }),
    ]);
    expect(
      dbMock.order.update.mock.calls.find(
        (call) => call[0]?.data?.totalAmount === '512.75',
      )?.[0]?.data,
    ).not.toHaveProperty('settledFee');
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
    expect(appendPricingRevisionMock).toHaveBeenCalledWith(
      dbMock,
      expect.objectContaining({
        orderId: 'o1',
        status: 'ADMIN_CONFIRMED',
        source: 'SHIPMENT_CHARGES_FINALIZED',
        expectedPriceRevision: 3,
        incrementOrderRevision: true,
      }),
    );
  });

  it('preserves a previously recorded carrier weight when SF collect is restored before shipping', async () => {
    dbMock.order.findUnique
      .mockResolvedValueOnce({
        id: 'o1',
        status: OrderStatus.COMPLETED,
        submitterId: 'sales-1',
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        pricingStatus: 'ADMIN_CONFIRMED',
        ...shipOrderVersionSnapshot,
      })
      .mockResolvedValueOnce({
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        // The administrator recorded the carrier weight first, then restored
        // SF collect. Its disabled form field therefore submits null.
        isSfCollect: true,
        processingAmount: '500.00',
        customerCharges: [
          {
            id: 'charge-shipping',
            businessKey: 'SHIPMENT:1:SHIPPING_FEE',
            amount: '0.00',
            priceBookId: 'logistics-book-test',
            category: { code: 'SHIPPING_FEE' },
          },
          {
            id: 'charge-packing',
            businessKey: 'SHIPMENT:1:PACKING_MATERIAL',
            amount: '0.00',
            priceBookId: 'logistics-book-test',
            category: { code: 'PACKING_MATERIAL' },
          },
        ],
      })
      .mockResolvedValueOnce({ id: 'o1', orderNo: 'O-1' });
    dbMock.orderShipment.findMany.mockResolvedValue([
      {
        id: 'shipment-1',
        sequence: 1,
        destinationProvince: '广东',
        weightKg: '2.5',
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
        ...shipOrderCommandSnapshot,
        trackingNo: null,
        shipments: [
          {
            shipmentId: 'shipment-1',
            trackingNo: 'SF001',
            weightKg: null,
            destinationProvince: null,
            shippingFee: '0.00',
            packingMaterialFee: '0.00',
            customerChargeOverrideReason: null,
          },
        ],
      },
      clock,
    );

    expect(dbMock.orderShipment.update).toHaveBeenCalledWith({
      where: { id: 'shipment-1' },
      data: {
        trackingNo: 'SF001',
        destinationProvince: '广东',
        status: 'SHIPPED',
        shippedAt: clock,
      },
      select: { id: true },
    });
    expect(
      dbMock.orderShipment.update.mock.calls[0]![0].data,
    ).not.toHaveProperty('weightKg');
  });

  it('rejects shipping while the price is pending administrator confirmation', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.COMPLETED,
      submitterId: 'sales-1',
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
      revision: 4,
      editVersion: 8,
      workOrderVersion: 2,
      priceRevision: 2,
    });

    await expect(
      shipOrder('o1', ownerActor, {
        ...shipOrderCommandSnapshot,
        expectedPriceRevision: 2,
        trackingNo: null,
        shipments: [{ shipmentId: 'shipment-1', trackingNo: 'SF001' }],
      }),
    ).rejects.toThrow(/价格.*管理员.*不能发货/);
    expect(dbMock.orderShipment.findMany).not.toHaveBeenCalled();
    expect(appendPricingRevisionMock).not.toHaveBeenCalled();
  });

  it('rejects an external non-SF shipment when any carrier-confirmed weight is missing', async () => {
    dbMock.order.findUnique
      .mockResolvedValueOnce({
        id: 'o1',
        status: OrderStatus.COMPLETED,
        submitterId: 'sales-1',
        ...shipOrderVersionSnapshot,
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
        ...shipOrderCommandSnapshot,
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
      ...shipOrderVersionSnapshot,
    });
    dbMock.orderShipment.findMany.mockResolvedValue([
      { id: 'shipment-1', sequence: 1 },
      { id: 'shipment-2', sequence: 2 },
    ]);

    await expect(
      shipOrder('o1', ownerActor, {
        ...shipOrderCommandSnapshot,
        trackingNo: null,
        shipments: [{ shipmentId: 'shipment-1', trackingNo: 'SF001' }],
      }),
    ).rejects.toThrow(/发货地址已变化/);
    await expect(
      shipOrder('o1', ownerActor, {
        ...shipOrderCommandSnapshot,
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

  // ─── Notification wire spec ───
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
  // 的 `{trackingNo}` 留 raw 字面量流到群消息。
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
  it('fails closed before any database read or settlement-bypassing write', async () => {
    await expect(finishOrder('o1', ownerActor)).rejects.toThrow(
      /旧版完结入口已停用.*结算/,
    );
    expect(dbMock.order.findUnique).not.toHaveBeenCalled();
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
    dbMock.orderShipment.findMany.mockResolvedValue([
      {
        id: 'shipment-1',
        sequence: 1,
        destinationProvince: null,
        weightKg: null,
        lines: [],
      },
    ]);

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
            {
              customerParty: {
                is: {
                  OR: [
                    { name: { contains: '苹果福', mode: 'insensitive' } },
                    {
                      shortName: {
                        contains: '苹果福',
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
              },
            },
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
      select: { id: true, name: true, isOutsource: true },
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
    // 这张 mock 没有 requiresOutsource（undefined）→ outsourceCoverageApplies
    // 为 false → 覆盖计算整段跳过，字段恒为空数组。横幅与闸口共用这个谓词，
    // 所以这行也是「未排产/非外协工单不出现横幅」的回归。
    expect(result?.uncoveredOutsourceItems).toEqual([]);
  });

  it('getOrderDetail projects structured packaging groups with their style composition', async () => {
    const packagingGroups = [
      {
        id: 'packaging-1',
        sequence: 1,
        name: '礼盒单款装',
        mode: 'SINGLE_STYLE',
        actualBagCount: 125,
        unitPrice: '0.2000',
        subtotal: '25.00',
        suggestedSubtotal: '25.00',
        pricingSnapshot: { sourceRuleId: 'packing-single' },
        priceOverrideReason: null,
        lines: [
          {
            id: 'packaging-line-1',
            unitsPerBag: 8,
            orderItem: { id: 'item-1', sequence: 1, name: '礼盒款' },
          },
        ],
      },
    ];
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-with-packaging',
      items: [],
      packagingGroups,
    });

    const result = await getOrderDetail('order-with-packaging', ownerActor);

    expect(dbMock.order.findFirst.mock.calls[0]![0].include.packagingGroups).toEqual({
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        sequence: true,
        name: true,
        mode: true,
        actualBagCount: true,
        unitPrice: true,
        subtotal: true,
        suggestedSubtotal: true,
        pricingSnapshot: true,
        priceOverrideReason: true,
        lines: {
          orderBy: { orderItem: { sequence: 'asc' } },
          select: {
            id: true,
            unitsPerBag: true,
            orderItem: {
              select: { id: true, sequence: true, name: true },
            },
          },
        },
      },
    });
    expect(result?.packagingGroups).toEqual(packagingGroups);
  });

  it('getOrderDetail 列出未被外协单覆盖的款式（详情页「暂不能完工」横幅的数据源）', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-uncovered',
      requiresOutsource: true,
      outsourceOrders: [
        // 已取消的那张不算覆盖，哪怕它写着 item-2。
        {
          id: 'os-cancelled',
          status: 'CANCELLED',
          orderItemIds: ['item-2'],
          itemSnapshots: [{ orderItemId: 'item-2', quantity: 100 }],
        },
        {
          id: 'os-live',
          status: 'RECEIVED',
          orderItemIds: ['item-1'],
          itemSnapshots: [{ orderItemId: 'item-1', quantity: 100 }],
        },
      ],
      items: [
        { id: 'item-1', sequence: 1, name: '款式一', quantity: 100, crafts: ['craft-uv'] },
        { id: 'item-2', sequence: 2, name: '款式二', quantity: 100, crafts: ['craft-uv'] },
        { id: 'item-3', sequence: 3, name: '款式三', quantity: 100, crafts: ['craft-foil'] },
      ],
    });
    dbMock.craft.findMany.mockResolvedValueOnce([
      { id: 'craft-uv', name: '局部UV', isOutsource: true },
      { id: 'craft-foil', name: '烫金', isOutsource: false },
    ]);

    const result = await getOrderDetail('order-uncovered', ownerActor);

    expect(result?.uncoveredOutsourceItems).toEqual([
      { id: 'item-2', sequence: 2, name: '款式二' },
    ]);
    // 仍然只有一条 craft 查询：名称解析与覆盖判定复用同一份字典。
    expect(dbMock.craft.findMany).toHaveBeenCalledTimes(1);
  });

  it('getOrderDetail 对 requiresOutsource=false 的工单不算覆盖缺口（与闸口同一谓词）', async () => {
    // 反向漂移回归：craft 后来被翻成外协、但工单排产时的快照是 false，
    // 闸口不会拦，横幅也必须闭嘴——否则主管补出来的外协单是一笔凭空应付。
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-snapshot-false',
      requiresOutsource: false,
      outsourceOrders: [],
      items: [
        { id: 'item-1', sequence: 1, name: '款式一', crafts: ['craft-uv'] },
      ],
    });
    dbMock.craft.findMany.mockResolvedValueOnce([
      { id: 'craft-uv', name: '局部UV', isOutsource: true },
    ]);

    const result = await getOrderDetail('order-snapshot-false', ownerActor);

    expect(result?.uncoveredOutsourceItems).toEqual([]);
    // 名称解析没有被一起跳过。
    expect(result?.items[0]?.craftNames).toEqual(['局部UV']);
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
      packagingAmount: true,
      totalAmount: true,
      pricingStatus: true,
      priceRevision: true,
      pricingConfirmedAt: true,
      pricingConfirmedById: true,
    });
    expect(query.include.items.omit).toEqual({
      unitPrice: true,
      fixedFee: true,
      subtotal: true,
      suggestedPrice: true,
      suggestedSubtotal: true,
      pricingSnapshot: true,
      manualQuoteReason: true,
      priceOverrideReason: true,
    });
    expect(query.include.packagingGroups.select).toEqual({
      id: true,
      sequence: true,
      name: true,
      mode: true,
      actualBagCount: true,
      lines: {
        orderBy: { orderItem: { sequence: 'asc' } },
        select: {
          id: true,
          unitsPerBag: true,
          orderItem: {
            select: { id: true, sequence: true, name: true },
          },
        },
      },
    });
    expect(query.include.packagingGroups.select).not.toHaveProperty('unitPrice');
    expect(query.include.packagingGroups.select).not.toHaveProperty('subtotal');
    expect(query.include.packagingGroups.select).not.toHaveProperty(
      'suggestedSubtotal',
    );
    expect(query.include.packagingGroups.select).not.toHaveProperty(
      'pricingSnapshot',
    );
    expect(query.include.packagingGroups.select).not.toHaveProperty(
      'priceOverrideReason',
    );
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
  const editSnapshotAt = new Date('2026-08-30T00:00:00.000Z');

  function editInput(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      expectedEditVersion: 7,
      ...overrides,
    };
  }

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
      editVersion: 7,
      updatedAt: new Date(editSnapshotAt),
      ...overrides,
    };
  }

  describe('admin external sales association', () => {
    const original = { id: 'sales-1', displayName: '原销售', username: 'old-sales' };
    const target = { id: 'sales-2', displayName: '新销售', username: 'new-sales' };
    const association = {
      submitterId: original.id, submitter: original,
      settlementType: OrderSettlementType.EXTERNAL_SALES, status: OrderStatus.DRAFT,
      settledAt: null, settledFee: null, shippedAt: null, finishedAt: null,
      sourceOrderId: null, agentMonthlyBillItem: null,
      _count: { billItems: 0, csSalesEntries: 0, reworkOrders: 0, changeRequests: 0 },
    };
    beforeEach(() => {
      dbMock.order.findFirst.mockResolvedValue(snapshot({ settlementType: OrderSettlementType.EXTERNAL_SALES }));
      dbMock.order.findUnique.mockResolvedValue(association);
      dbMock.user.findUnique.mockResolvedValue({ ...target, role: Role.SALES, isActive: true });
    });
    it('updates only ownership under CAS and records readable before/after account snapshots', async () => {
      await updateOrderFields('order-1', editInput({ externalSalesUserId: ' sales-2 ' }), ownerActor);
      expect(dbMock.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', editVersion: 7 }, data: { submitterId: 'sales-2' },
      });
      expect(dbMock.orderLog.create).toHaveBeenCalledWith({ data: {
        orderId: 'order-1', operatorId: ownerActor.id, action: 'UPDATE',
        changedFields: { submitterId: { before: original, after: target } },
      } });
      expect(dbMock.orderPricingRevision.create).not.toHaveBeenCalled();
      expect(dbMock.orderShipment.updateMany).not.toHaveBeenCalled();
    });
    it.each([Role.SALES, Role.CUSTOMER_SERVICE])('rejects reassignment from %s even for an owned order', async (role) => {
      await expect(updateOrderFields('order-1', editInput({ externalSalesUserId: 'sales-2' }), { id: 'sales-1', role })).rejects.toThrow('只有管理员');
      expect(dbMock.order.updateMany).not.toHaveBeenCalled();
    });
    it.each([null, { ...target, role: Role.ADMIN, isActive: true }, { ...target, role: Role.CUSTOMER_SERVICE, isActive: true }, { ...target, role: Role.SALES, isActive: false }])('rejects inactive, absent or non-sales target %j', async (account) => {
      dbMock.user.findUnique.mockResolvedValue(account);
      await expect(updateOrderFields('order-1', editInput({ externalSalesUserId: 'sales-2' }), ownerActor)).rejects.toThrow('所选账号');
      expect(dbMock.order.updateMany).not.toHaveBeenCalled();
    });
    it.each([
      { settlementType: OrderSettlementType.INTERNAL_SALES },
      { settlementType: OrderSettlementType.FACTORY_DIRECT },
      { settlementType: OrderSettlementType.NO_CHARGE },
      { status: OrderStatus.CONFIRMED },
      { settledAt: new Date() }, { settledFee: new Decimal(0) }, { shippedAt: new Date() },
      { agentMonthlyBillItem: { id: 'bill-item' } },
      { _count: { ...association._count, billItems: 1 } },
      { _count: { ...association._count, csSalesEntries: 1 } },
      { _count: { ...association._count, changeRequests: 1 } },
      { _count: { ...association._count, reworkOrders: 1 } },
      { sourceOrderId: 'source' },
    ])('rejects frozen financial or related-order facts %j', async (overrides) => {
      dbMock.order.findUnique.mockResolvedValue({ ...association, ...overrides });
      await expect(updateOrderFields('order-1', editInput({ externalSalesUserId: 'sales-2' }), ownerActor)).rejects.toBeInstanceOf(OrderInvariantError);
      expect(dbMock.order.updateMany).not.toHaveBeenCalled();
      expect(dbMock.orderLog.create).not.toHaveBeenCalled();
    });
    it('keeps an unchanged historical account without revalidating its current role', async () => {
      dbMock.user.findUnique.mockResolvedValue(null);
      const result = await updateOrderFields('order-1', editInput({ externalSalesUserId: 'sales-1' }), ownerActor);
      expect(result.changed).toBe(false);
      expect(dbMock.user.findUnique).not.toHaveBeenCalled();
    });
    it('rejects a stale reassignment before querying accounts', async () => {
      await expect(updateOrderFields('order-1', { expectedEditVersion: 6, externalSalesUserId: 'sales-2' }, ownerActor)).rejects.toThrow('刷新');
      expect(dbMock.user.findUnique).not.toHaveBeenCalled();
      expect(dbMock.order.updateMany).not.toHaveBeenCalled();
    });
    it('does not allow direct submitter or settlement fields through the general whitelist', async () => {
      const result = await updateOrderFields('order-1', editInput({ submitterId: 'sales-2', settlementType: 'INTERNAL_SALES', createdById: 'sales-2' }), ownerActor);
      expect(result.changed).toBe(false);
      expect(dbMock.order.updateMany).not.toHaveBeenCalled();
    });
  });

  it('blocks ordinary editing while an approval is pending', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ changeRequests: [{ id: 'request' }] }),
    );
    await expect(
      updateOrderFields('order-1', editInput({ remark: 'changed' }), ownerActor),
    ).rejects.toThrow('待审批');
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();
  });

  it('cannot bypass shipped-contact restrictions by omitting the shipment JSON', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot({ shipments: [{ sequence: 1, status: 'SHIPPED' }] }));
    await expect(updateOrderFields('order-1', editInput({ receiverName: 'changed' }), ownerActor)).rejects.toThrow('已发货');
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();
  });

  it('cannot clear required external contacts through a legacy basic-fields payload', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot({ settlementType: OrderSettlementType.EXTERNAL_SALES }));
    await expect(updateOrderFields('order-1', editInput({ receiverPhone: null }), ownerActor)).rejects.toThrow('收件人和收货电话');
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();
  });

  it.each([null, '', '   '])('rejects clearing an external order name (%j)', async (customName) => {
    dbMock.order.findFirst.mockResolvedValue(snapshot({ settlementType: OrderSettlementType.EXTERNAL_SALES, customName: '原工单' }));
    await expect(updateOrderFields('order-1', editInput({ customName }), ownerActor)).rejects.toThrow('必须填写工单名称');
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('keeps partial historical edits possible and normalizes an explicit external name', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot({ settlementType: OrderSettlementType.EXTERNAL_SALES }));
    await updateOrderFields('order-1', editInput({ remark: '补充说明' }), ownerActor);
    expect(dbMock.order.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { remark: '补充说明' } }));
    await updateOrderFields('order-1', editInput({ customName: '  正式名称  ' }), ownerActor);
    expect(dbMock.order.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { customName: '正式名称' } }));
  });

  it('allows an optional internal name and saves packaging notes without changing bag or price facts', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot({ settlementType: OrderSettlementType.INTERNAL_SALES, customName: '原工单' }));
    await updateOrderFields('order-1', editInput({ customName: null, packageRequirement: '贴客户标签' }), ownerActor);
    expect(dbMock.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { customName: null, packageRequirement: '贴客户标签' } }));
  });

  it('validates a changed customer association and logs the actual relationship change', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ customerPartyId: 'old-customer' }),
    );
    dbMock.party.findUnique.mockResolvedValue({
      id: 'new-customer',
      isActive: true,
      type: PartyType.CUSTOMER,
    });
    await updateOrderFields(
      'order-1',
      editInput({ customerPartyId: 'new-customer' }),
      ownerActor,
    );
    expect(dbMock.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { customerPartyId: 'new-customer' } }),
    );
    expect(dbMock.orderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changedFields: {
            customerPartyId: { before: 'old-customer', after: 'new-customer' },
          },
        }),
      }),
    );
  });

  it.each([
    null,
    { id: 'supplier', isActive: true, type: PartyType.SUPPLIER },
    { id: 'inactive', isActive: false, type: PartyType.CUSTOMER },
  ])(
    'rejects an invalid customer without changing the order',
    async (customer) => {
      dbMock.order.findFirst.mockResolvedValue(snapshot());
      dbMock.party.findUnique.mockResolvedValue(customer);
      await expect(
        updateOrderFields(
          'order-1',
          editInput({ customerPartyId: 'new-customer' }),
          ownerActor,
        ),
      ).rejects.toThrow('所选客户');
      expect(dbMock.order.updateMany).not.toHaveBeenCalled();
    },
  );

  it('writes secondary shipment contacts under the order version without changing prices or allocations', async () => {
    const primary = {
      id: 's1',
      sequence: 1,
      status: 'PLANNED',
      receiverName: '张三',
      receiverPhone: '13800000000',
      receiverAddress: '佛山市…',
      expressCode: null,
      destinationProvince: '广东',
    };
    const secondary = { ...primary, id: 's2', sequence: 2 };
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ shipments: [primary, secondary] }),
    );
    await updateOrderFields(
      'order-1',
      editInput({
        shipments: [primary, { ...secondary, receiverName: '李四' }].map(
          (row) => ({
            id: row.id,
            receiverName: row.receiverName,
            receiverPhone: row.receiverPhone,
            receiverAddress: row.receiverAddress,
            expressCode: row.expressCode,
            expectedDestinationProvince: row.destinationProvince,
            sameDestination: false,
          }),
        ),
      }),
      ownerActor,
    );
    expect(dbMock.orderShipment.updateMany).toHaveBeenCalledTimes(1);
    expect(dbMock.orderShipment.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1', id: 's2', sequence: 2 },
      data: {
        receiverName: '李四',
        receiverPhone: '13800000000',
        receiverAddress: '佛山市…',
        expressCode: null,
      },
    });
    const data = dbMock.order.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('totalAmount');
    expect(data).not.toHaveProperty('pricingStatus');
    expect(dbMock.order.updateMany.mock.calls[0][0].where).toEqual({
      id: 'order-1',
      editVersion: 7,
    });
  });


  it('throws when the order cannot be seen (scope filter returns null)', async () => {
    dbMock.order.findFirst.mockResolvedValue(null);
    await expect(
      updateOrderFields('order-1', editInput({ remark: 'x' }), salesActor),
    ).rejects.toBeInstanceOf(OrderInvariantError);
  });

  it('throws when a non-owning SALES tries to edit another SALES\'s order', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ submitterId: 'sales-OTHER' }),
    );
    await expect(
      updateOrderFields('order-1', editInput({ remark: 'x' }), salesActor),
    ).rejects.toThrow(/只能修改自己创建的工单/);
  });

  it('ADMIN can edit someone else\'s order (global override)', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ submitterId: 'sales-OTHER' }),
    );
    const result = await updateOrderFields(
      'order-1',
      editInput({ remark: '管理员代改' }),
      ownerActor,
    );
    expect(result.changed).toBe(true);
  });

  it('refuses to edit when the status is terminal (FINISHED)', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ status: OrderStatus.FINISHED }),
    );
    await expect(
      updateOrderFields('order-1', editInput({ remark: 'x' }), ownerActor),
    ).rejects.toThrow(/当前状态不可编辑/);
  });

  it.each([
    ['缺失', { remark: 'x' }],
    ['非法', { expectedEditVersion: Number.NaN, remark: 'x' }],
  ])('领域层友好拒绝%s的编辑版本令牌', async (_label, input) => {
    dbMock.order.findFirst.mockResolvedValue(snapshot());

    await expect(
      updateOrderFields('order-1', input as never, salesActor),
    ).rejects.toThrow('编辑页面已过期，请刷新后重试');
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderShipment.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('读取到的工单已晚于表单快照时拒绝任何写入', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ editVersion: 8 }),
    );

    await expect(
      updateOrderFields('order-1', editInput({ remark: '过期备注' }), salesActor),
    ).rejects.toThrow('工单已被其他人修改，请刷新页面后再编辑');
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderShipment.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('CAS 落库冲突时不写 Shipment 或 OrderLog', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot());
    dbMock.order.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      updateOrderFields(
        'order-1',
        editInput({ receiverName: '并发修改' }),
        salesActor,
      ),
    ).rejects.toThrow('工单已被其他人修改，请刷新页面后再编辑');
    expect(dbMock.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', editVersion: 7 },
      data: { receiverName: '并发修改' },
    });
    expect(dbMock.orderShipment.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('DRAFT / FULL fieldset: customerRef and isUrgent are both applied', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot());
    await updateOrderFields(
      'order-1',
      editInput({ customerRef: '新客户', isUrgent: true, remark: '新备注' }),
      salesActor,
    );
    const data = dbMock.order.updateMany.mock.calls[0][0].data as Record<string, unknown>;
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
      updateOrderFields(
        'order-1',
        editInput({ isSfCollect: true }) as never,
        salesActor,
      ),
    ).resolves.toMatchObject({ changed: false, changedFields: [] });

    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.order.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(dbMock.orderCostEntry.aggregate).not.toHaveBeenCalled();
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['空字符串', ''],
    ['纯空格', '   '],
  ])('领域层拒绝把收货地址改为%s', async (_label, receiverAddress) => {
    dbMock.order.findFirst.mockResolvedValue(snapshot());

    await expect(
      updateOrderFields(
        'order-1',
        editInput({ receiverAddress }) as never,
        salesActor,
      ),
    ).rejects.toThrow('请填写收货地址');
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderShipment.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('收货地址修剪后同一事务写入工单与主发货记录', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot());

    await updateOrderFields(
      'order-1',
      editInput({ receiverAddress: '  广州市越秀区新地址  ' }),
      salesActor,
    );

    expect(dbMock.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1', editVersion: 7 },
        data: expect.objectContaining({ receiverAddress: '广州市越秀区新地址' }),
      }),
    );
    expect(dbMock.orderShipment.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1', sequence: 1 },
      data: { receiverAddress: '广州市越秀区新地址' },
    });
  });

  it('缺少主发货记录时拒绝完成地址编辑，避免两份快照分叉', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot());
    dbMock.orderShipment.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      updateOrderFields(
        'order-1',
        editInput({ receiverAddress: '广州市越秀区新地址' }),
        salesActor,
      ),
    ).rejects.toThrow(/缺少主发货记录.*无法同步/);
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('SHIPPING_ONLY fieldset: customerRef and isUrgent are dropped even if submitted', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ status: OrderStatus.IN_PRODUCTION }),
    );
    await updateOrderFields(
      'order-1',
      editInput({
        // These two live outside the SHIPPING_ONLY allowlist and MUST be
        // ignored even if the action hands them down — SPEC §3.6 forbids
        // changing them once production starts.
        customerRef: '攻击者改',
        isUrgent: true,
        isSfCollect: true,
        receiverName: '新收货人',
        remark: '新备注',
      }) as never,
      ownerActor,
    );
    const data = dbMock.order.updateMany.mock.calls[0][0].data as Record<string, unknown>;
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
    await updateOrderFields(
      'order-1',
      editInput({ remark: '新', receiverName: '新', receiverPhone: null }),
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
    await updateOrderFields(
      'order-1',
      editInput({ remark: '只改备注' }),
      salesActor,
    );
    expect(dbMock.orderShipment.updateMany).not.toHaveBeenCalled();
  });

  it('no-op edit (same values re-submitted) skips UPDATE and log entry', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot());
    const result = await updateOrderFields(
      'order-1',
      editInput({ remark: null, customerRef: '苹果福' }),
      salesActor,
    );
    expect(result.changed).toBe(false);
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('empty-string input normalizes to null for text fields (cleared field)', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot({ remark: '旧备注' }));
    await updateOrderFields('order-1', editInput({ remark: '' }), salesActor);
    const data = dbMock.order.updateMany.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.remark).toBeNull();
  });

  it('explicit undefined preserves a FULL form’s existing date, urgent flag and optional text', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot({
      promisedDate: new Date('2026-09-20T00:00:00Z'),
      isUrgent: true,
      packageRequirement: '十个一袋',
    }));
    await updateOrderFields(
      'order-1',
      editInput({
        remark: '只改备注',
        promisedDate: undefined,
        isUrgent: undefined,
        packageRequirement: undefined,
      }),
      ownerActor,
    );
    expect(dbMock.order.updateMany.mock.calls[0][0].data).toEqual({
      remark: '只改备注',
    });
    expect(dbMock.orderLog.create.mock.calls[0][0].data.changedFields).toEqual({
      remark: { before: null, after: '只改备注' },
    });
  });

  it('undefined-only partial input is a no-op instead of clearing persisted values', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot({
      promisedDate: new Date('2026-09-20T00:00:00Z'),
      isUrgent: true,
      remark: '原备注',
    }));
    const result = await updateOrderFields(
      'order-1',
      editInput({ promisedDate: undefined, isUrgent: undefined, remark: undefined }),
      ownerActor,
    );
    expect(result.changed).toBe(false);
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('explicit false, null and empty string remain intentional field changes', async () => {
    dbMock.order.findFirst.mockResolvedValue(snapshot({
      promisedDate: new Date('2026-09-20T00:00:00Z'),
      isUrgent: true,
      remark: '原备注',
    }));
    await updateOrderFields(
      'order-1',
      editInput({ promisedDate: null, isUrgent: false, remark: '' }),
      ownerActor,
    );
    expect(dbMock.order.updateMany.mock.calls[0][0].data).toEqual({
      promisedDate: null,
      isUrgent: false,
      remark: null,
    });
  });

  it('promisedDate 修改写入 Date 并记 diff；等值 Date 不算改动（时间戳比较）', async () => {
    const promised = new Date('2026-07-15T00:00:00Z');
    // 等值但不同实例的 Date：=== 恒 false，必须按时间戳比较判 no-op
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ promisedDate: new Date('2026-07-15T00:00:00Z') }),
    );
    const noop = await updateOrderFields(
      'order-1',
      editInput({ promisedDate: promised }),
      salesActor,
    );
    expect(noop.changed).toBe(false);
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();

    // 真实修改：null → 2026-07-15，data 写 Date，diff 记录 before/after
    dbMock.order.findFirst.mockResolvedValue(snapshot({ promisedDate: null }));
    const changed = await updateOrderFields(
      'order-1',
      editInput({ promisedDate: promised }),
      salesActor,
    );
    expect(changed.changed).toBe(true);
    expect(changed.changedFields).toEqual(['promisedDate']);
    const data = dbMock.order.updateMany.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.promisedDate).toEqual(promised);
  });

  it('SHIPPING_ONLY 状态下 promisedDate 不在可改集合内（被静默丢弃 → no-op）', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      snapshot({ status: OrderStatus.IN_PRODUCTION, promisedDate: null }),
    );
    const result = await updateOrderFields(
      'order-1',
      editInput({ promisedDate: new Date('2026-07-15T00:00:00Z') }),
      ownerActor,
    );
    expect(result.changed).toBe(false);
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();
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
    expect(dbMock.order.updateMany).not.toHaveBeenCalled();
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
  it('rejects a delivery change while a modification is pending without writing fees', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      ...sfSnapshot(OrderStatus.SUBMITTED, false, salesActor.id, OrderSettlementType.EXTERNAL_SALES),
      changeRequests: [{ id: 'pending-change' }],
    });
    await expect(setOrderSfCollect('order-1', true, salesActor)).rejects.toThrow('待审批申请');
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(appendPricingRevisionMock).not.toHaveBeenCalled();
  });
  it('rejects an unversioned external fulfilment correction before changing financial facts', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      sfSnapshot(OrderStatus.COMPLETED, false, 'sales-1', OrderSettlementType.EXTERNAL_SALES),
    );
    dbMock.order.findUnique.mockResolvedValue(externalChargeContext());
    dbMock.order.update.mockResolvedValue({ id: 'order-1', status: OrderStatus.COMPLETED });

    await expect(setOrderSfCollect('order-1', true, ownerActor)).rejects.toThrow(/版本/);
    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

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
      pricingStatus: 'ADMIN_CONFIRMED',
      priceRevision: 4,
      revision: 7,
      processingAmount: '5000.00',
      totalAmount: '5000.00',
    };
  }

  function externalChargeContext(overrides: {
    destinationProvince?: string | null;
    quotedWeightKg?: string | null;
    weightKg?: string | null;
    shippingAmount?: string;
    otherAmount?: string;
  } = {}) {
    return {
      items: [
        {
          id: 'item-1',
          quantity: 1_000,
          paperWeightGsm: 160,
          paperType: '160g珠光艳闪',
          productStructure: 'STANDARD_ENVELOPE',
        },
      ],
      shipments: [
        {
          id: 'shipment-1',
          sequence: 1,
          status: 'SHIPPED',
          destinationProvince: overrides.destinationProvince ?? null,
          quotedWeightKg: overrides.quotedWeightKg ?? null,
          weightKg: overrides.weightKg ?? null,
          lines: [{ orderItemId: 'item-1', quantity: 1000 }],
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

  it('refreshes the pre-factory external quote snapshot when enabling SF collect', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      ...sfSnapshot(
        OrderStatus.SUBMITTED,
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
    const quote: Record<string, unknown> = { quotedFee: null, quotedFeeCompleteness: null, quotedPricingRevisionId: null };
    dbMock.order.update.mockImplementation(async ({ data }) => {
      Object.assign(quote, data);
      const present = ['quotedFee', 'quotedFeeCompleteness', 'quotedPricingRevisionId'].map((key) => quote[key] !== null);
      expect(present.every(Boolean) || present.every((value) => !value), '每次 SQL 更新都必须满足报价三字段约束').toBe(true);
      return { id: 'order-1', status: OrderStatus.SUBMITTED };
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
          actual: expect.objectContaining({
            amount: '0.00',
            overrideReason: null,
          }),
        }),
      }),
    });
    expect(dbMock.orderShipment.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      data: { carrierCode: 'SF' },
    });
    expect(dbMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isSfCollect: true,
          totalAmount: '5007.00',
          confirmedFee: null,
          settledFee: null,
        }),
      }),
    );
    expect(appendPricingRevisionMock).toHaveBeenCalledWith(
      dbMock,
      expect.objectContaining({
        orderId: 'order-1',
        status: 'PENDING_ADMIN_CONFIRMATION',
        source: 'SF_COLLECT_CHANGED_PENDING',
        expectedPriceRevision: 4,
        incrementOrderRevision: true,
        orderFeeSnapshot: { quotedFee: '5007.00', confirmedFee: null, settledFee: null },
      }),
    );
    const quoteLinkIndex = dbMock.order.update.mock.calls.findIndex(
      (call) =>
        call[0]?.data?.quotedPricingRevisionId === 'pricing-revision-2',
    );
    expect(quoteLinkIndex).toBeGreaterThanOrEqual(0);
    expect(dbMock.order.update.mock.calls[quoteLinkIndex]).toEqual([
      expect.objectContaining({
        where: { id: 'order-1' },
        data: { quotedFee: '5007.00', quotedFeeCompleteness: 'COMPLETE', quotedPricingRevisionId: 'pricing-revision-2' },
      }),
    ]);
    expect(
      appendPricingRevisionMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      dbMock.order.update.mock.invocationCallOrder[quoteLinkIndex]!,
    );
  });

  it('lets an admin cancel SF collect before factory review with complete per-shipment facts', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      ...sfSnapshot(
        OrderStatus.SUBMITTED,
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
              status: 'ESTIMATED',
              suggestedAmount: '4.30',
              amount: '4.30',
              finalizedById: null,
            }),
          }),
        ],
        [
          expect.objectContaining({
            where: { id: 'charge-packing' },
            data: expect.objectContaining({
              status: 'ESTIMATED',
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
        data: expect.objectContaining({
          isSfCollect: false,
          totalAmount: '5011.30',
          confirmedFee: null,
          settledFee: null,
        }),
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

  it('rejects an unversioned post-shipment SF cancellation without mutating charges', async () => {
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
    ).rejects.toThrow(/缺少订单版本/);

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
  ])('在工厂审核前仍拒绝$label的收费更正', async ({ corrections, expected }) => {
    dbMock.order.findFirst.mockResolvedValue(
      sfSnapshot(
        OrderStatus.SUBMITTED,
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

  it('ignores all salesperson-supplied shipment corrections without clearing an actual weight', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      sfSnapshot(
        OrderStatus.SUBMITTED,
        true,
        'sales-1',
        OrderSettlementType.EXTERNAL_SALES,
      ),
    );
    const context = externalChargeContext({
      destinationProvince: '广东',
      weightKg: '2',
    });
    context.shipments[0]!.status = 'PENDING';
    dbMock.order.findUnique.mockResolvedValue(context);
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SUBMITTED,
    });

    await setOrderSfCollect(
      'order-1',
      false,
      salesActor,
      [
        {
          shipmentId: 'shipment-1',
          destinationProvince: '广东',
          weightKg: '12.5',
          shippingFee: null,
          customerChargeOverrideReason: null,
        },
      ],
    );

    expect(dbMock.orderShipment.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changedFields: expect.not.objectContaining({
          shipmentChargeCorrections: expect.anything(),
        }),
      }),
    });
  });

  it('忽略历史浏览器重量并按服务端款式事实估算运费', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      sfSnapshot(
        OrderStatus.SUBMITTED,
        true,
        'sales-1',
        OrderSettlementType.EXTERNAL_SALES,
      ),
    );
    const context = externalChargeContext({
      quotedWeightKg: '12.5',
      destinationProvince: '广东',
    });
    context.shipments[0]!.status = 'PENDING';
    dbMock.order.findUnique.mockResolvedValue(context);
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SUBMITTED,
    });

    await setOrderSfCollect('order-1', false, salesActor);

    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledWith({
      where: { id: 'charge-shipping' },
      data: expect.objectContaining({
        sourceRuleId: 'zto-guangdong',
        quantity: '6',
        suggestedAmount: '10.30',
        amount: '10.30',
        overrideReason: null,
        pricingSnapshot: expect.objectContaining({
          quote: expect.objectContaining({
            basis: expect.objectContaining({
              billableWeightKg: '6',
              weightSource: 'SERVER_ESTIMATE',
            }),
          }),
        }),
      }),
    });
    expect(dbMock.orderShipment.update).not.toHaveBeenCalled();
  });

  it('取消顺丰到付时款式重量事实不完整则保持待终价', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      sfSnapshot(
        OrderStatus.SUBMITTED,
        true,
        'sales-1',
        OrderSettlementType.EXTERNAL_SALES,
      ),
    );
    const baseContext = externalChargeContext({ quotedWeightKg: '12.5' });
    const context = {
      ...baseContext,
      items: baseContext.items.map((item) => ({
        ...item,
        paperWeightGsm: null,
        productStructure: 'UNSPECIFIED',
      })),
      shipments: baseContext.shipments.map((shipment) => ({
        ...shipment,
        status: 'PENDING',
      })),
    };
    dbMock.order.findUnique.mockResolvedValue(context);
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SUBMITTED,
    });

    await setOrderSfCollect('order-1', false, salesActor);

    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledWith({
      where: { id: 'charge-shipping' },
      data: expect.objectContaining({
        sourceRuleId: null,
        suggestedAmount: null,
        amount: '0.00',
        overrideReason: '取消顺丰到付，快递费待发货时确认',
      }),
    });
    expect(dbMock.orderShipment.update).not.toHaveBeenCalled();
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

describe('sales early cancellation boundaries', () => {
  it.each([OrderStatus.DRAFT, OrderStatus.PENDING_FACTORY, OrderStatus.REJECTED])('allows the owner to cancel %s with the current edit version', async (status) => {
    dbMock.order.findUnique.mockResolvedValue({ id: 'o1', status, submitterId: salesActor.id, editVersion: 4 });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });
    await expect(cancelOrder('o1', salesActor, '客户取消', new Date(), 4)).resolves.toMatchObject({ status: OrderStatus.CANCELLED });
  });
  it('rejects foreign ownership, stale versions and active requests before writing', async () => {
    dbMock.order.findUnique.mockResolvedValue({ id: 'o1', status: OrderStatus.REJECTED, submitterId: 'other', editVersion: 4 });
    await expect(cancelOrder('o1', salesActor, '客户取消', new Date(), 4)).rejects.toThrow('只能取消自己');
    dbMock.order.findUnique.mockResolvedValue({ id: 'o1', status: OrderStatus.REJECTED, submitterId: salesActor.id, editVersion: 4 });
    await expect(cancelOrder('o1', salesActor, '客户取消', new Date(), 3)).rejects.toThrow('已更新');
    dbMock.orderChangeRequest.findFirst.mockResolvedValue({ id: 'pending' });
    await expect(cancelOrder('o1', salesActor, '客户取消', new Date(), 4)).rejects.toThrow('当前申请');
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });
});

it('sales cannot bind an active customer belonging to another salesperson', async () => {
  dbMock.party.findUnique.mockResolvedValue({ id: 'foreign-customer', type: PartyType.CUSTOMER, isActive: true });
  dbMock.party.findFirst.mockResolvedValue(null);
  await expect(createOrder({ customerPartyId: 'foreign-customer', customerRef: '客户', receiverName: '收件人', receiverPhone: '13800000000', receiverAddress: '广东佛山测试收货地址', expressCode: null, packageRequirement: null, remark: null, promisedDate: null, isUrgent: false, isSfCollect: false, items: [baseItem()] }, salesActor)).rejects.toThrow('只能选择自己关联的客户');
  expect(dbMock.order.create).not.toHaveBeenCalled();
});

describe('admin creates for an external salesperson', () => {
  function delegatedInput(): Parameters<typeof createOrderDomain>[0] {
    return {
      expressCode: null,
      packageRequirement: null,
      remark: null,
      promisedDate: null,
      isUrgent: false,
      isSfCollect: false,
      clientSubmissionId: 'ab75a0a0-eace-4a54-9ce9-367b95efc701',
      externalSalesUserId: 'sales-2',
      customName: '外部销售代录测试',
      customerPartyId: 'old-customer',
      customerRef: '旧简称',
      receiverName: '张先生',
      receiverPhone: '13800138000',
      receiverAddress: '上海市测试地址',
      items: [baseItem()],
      packagingGroups: [
        {
          name: null,
          mode: 'SINGLE_STYLE',
          actualBagCount: 100,
          itemUnitsPerBag: [10],
        },
      ],
    };
  }
  it('records the selected owner and external settlement while retaining the creating admin', async () => {
    dbMock.user.findUnique.mockResolvedValue({
      role: Role.SALES,
      isActive: true,
    });
    await createOrderDomain(delegatedInput(), ownerActor);
    expect(dbMock.order.create.mock.calls[0]![0].data).toMatchObject({
      submitterId: 'sales-2',
      createdById: ownerActor.id,
      submitterRole: Role.SALES,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      customerPartyId: null,
      customerRef: null,
      status: OrderStatus.DRAFT,
      priceRevision: 0,
      logs: { create: expect.arrayContaining([expect.objectContaining({
        action: 'CREATE', changedFields: { createRequest: { version: 1, fingerprint: createOrderRequestFingerprint(delegatedInput()) } },
      })]) },
    });
    expect(dbMock.party.findUnique).not.toHaveBeenCalled();
    expect(
      dbMock.$executeRaw.mock.calls.some(([sql]) =>
        sql.join('').includes('FOR SHARE'),
      ),
    ).toBe(true);
  });
  it.each([Role.SALES, Role.CUSTOMER_SERVICE, Role.WORKER])(
    'rejects assignment by %s before writing',
    async (role) => {
      await expect(
        createOrderDomain(delegatedInput(), { id: 'actor', role }),
      ).rejects.toThrow('只有管理员');
      expect(dbMock.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    { role: Role.SALES, isActive: false },
    { role: Role.ADMIN, isActive: true },
  ])('rejects missing, disabled or non-sales accounts: %j', async (target) => {
    dbMock.user.findUnique.mockResolvedValue(target);
    await expect(
      createOrderDomain(delegatedInput(), ownerActor),
    ).rejects.toThrow('所选账号');
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });
  it('replays for the creator, and rejects changing the owner under the same submission id', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'created',
      orderNo: 'GD-test',
      logs: [{ changedFields: { createRequest: { version: 1, fingerprint: createOrderRequestFingerprint(delegatedInput()) } } }],
      createdById: ownerActor.id,
      submitterId: 'sales-2',
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
      items: [{ id: 'item' }],
    });
    await expect(
      createOrderDomain(delegatedInput(), ownerActor),
    ).resolves.toMatchObject({ id: 'created' });
    await expect(
      createOrderDomain(
        { ...delegatedInput(), externalSalesUserId: 'sales-3' },
        ownerActor,
      ),
    ).rejects.toThrow('提交标识');
    await expect(
      createOrderDomain(delegatedInput(), {
        id: 'another-admin',
        role: Role.ADMIN,
      }),
    ).rejects.toThrow('提交标识');
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });
  it('rejects changed facts after an ambiguous successful create instead of returning the old order', async () => {
    const input = delegatedInput();
    dbMock.order.findUnique.mockResolvedValue({ id: 'created', orderNo: 'GD-original',
      createdById: ownerActor.id, submitterId: 'sales-2', items: [{ id: 'item' }],
      logs: [{ changedFields: { createRequest: { version: 1, fingerprint: createOrderRequestFingerprint(input) } } }],
    });
    await expect(createOrderDomain({ ...input, receiverAddress: '新的收货地址' }, ownerActor)).rejects.toThrow('GD-original');
    await expect(createOrderDomain({ ...input, items: [{ ...input.items[0]!, quantity: 2000 }] }, ownerActor)).rejects.toThrow('已保存');
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });
  it('does not silently replay historical requests without comparable creation facts', async () => {
    dbMock.order.findUnique.mockResolvedValue({ id: 'legacy', orderNo: 'GD-legacy',
      createdById: ownerActor.id, submitterId: 'sales-2', items: [{ id: 'item' }], logs: [],
    });
    await expect(createOrderDomain(delegatedInput(), ownerActor)).rejects.toThrow('工单列表');
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });
  it.each([false, true])('checks original facts after a concurrent unique conflict (changed=%s)', async (changed) => {
    const input = delegatedInput();
    dbMock.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002', clientVersion: 'test', meta: { target: ['clientSubmissionId'] },
    }));
    dbMock.order.findUnique.mockResolvedValue({ id: 'concurrent', orderNo: 'GD-concurrent',
      createdById: ownerActor.id, submitterId: 'sales-2', items: [{ id: 'item' }],
      logs: [{ changedFields: { createRequest: { version: 1, fingerprint: createOrderRequestFingerprint(input) } } }],
    });
    const pending = createOrderDomain(changed ? { ...input, receiverAddress: '修改地址' } : input, ownerActor);
    if (changed) await expect(pending).rejects.toThrow('GD-concurrent');
    else await expect(pending).resolves.toMatchObject({ id: 'concurrent', itemIds: ['item'] });
  });
  it.each([null, '管理员核价'])('rejects retired 120g paper before any write (manualQuoteReason=%s)', async (manualQuoteReason) => {
    const input = delegatedInput();
    await expect(createOrderDomain({
      ...input,
      items: [{ ...input.items[0]!, paperType: '120g珠光艳闪', paperWeightGsm: 120, manualQuoteReason }],
    }, ownerActor)).rejects.toThrow('120g 纸张已停用');
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });
  it('rejects oversized bags even when a domain caller bypasses the schema', async () => {
    const input = delegatedInput();
    await expect(
      createOrderDomain(
        { ...input, items: [{ ...input.items[0]!, pack: 13 }] },
        ownerActor,
      ),
    ).rejects.toThrow('12');
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });
});
