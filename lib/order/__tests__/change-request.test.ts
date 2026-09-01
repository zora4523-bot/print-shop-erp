import Decimal from 'decimal.js';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderBillingMode,
  OrderChangeRequestStatus,
  OrderCustomerChargeStatus,
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderPackagingMode,
  OrderProductStructure,
  OrderQuotedFeeCompleteness,
  OrderSettlementType,
  OrderStatus,
  Role,
  TaskStatus,
} from '../../../generated/prisma/enums';
import { calculateCreateOrderQuote } from '../../price/create-order';
import {
  CREATE_ORDER_GOLDEN_SNAPSHOT,
  createGoldenOrderInput,
  createGoldenOrderItem,
} from '../../price/__tests__/fixtures/create-order-golden-fixtures';
import { presentCreateOrderProcessingQuote } from '../create-order-quote-presentation';
import { PENDING_PLATE_BUSINESS_KEY } from '../pending-plate-charge';

const mocks = vi.hoisted(() => {
  const db = {
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    order: { findUnique: vi.fn(), update: vi.fn() },
    orderItem: { update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    orderItemPlateDetail: { findMany: vi.fn(), update: vi.fn() },
    orderPackagingGroup: { update: vi.fn() },
    orderShipmentLine: { upsert: vi.fn(), create: vi.fn() },
    orderCustomerCharge: {
      aggregate: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    customerChargeCategory: { findUnique: vi.fn() },
    orderPriceVersionLock: { createMany: vi.fn() },
    orderChangeRequest: {
      findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn(),
    },
    orderLog: { create: vi.fn() },
    csSalesEntry: { aggregate: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    salaryPeriod: { findFirst: vi.fn(), update: vi.fn() },
  };
  return {
    db,
    calculate: vi.fn(),
    finalizeCharges: vi.fn(),
    appendRevision: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('@/lib/order/create-order-quote-service', () => ({
  calculateCreateOrderQuoteFromCatalogInTx: mocks.calculate,
}));
vi.mock('@/lib/order/pricing-revision', () => ({
  appendOrderPricingRevisionInTx: mocks.appendRevision,
}));
vi.mock('@/lib/price/order-charge-service', () => ({
  OrderCustomerChargeError: class OrderCustomerChargeError extends Error {},
  resolveExternalOrderChargesForFinalization: mocks.finalizeCharges,
}));

import {
  createOrderChangeRequest,
  isChangeRequestQuoteAutomaticallyApplicable,
  previewOrderChangeRequestPricing,
  reviewOrderChangeRequest,
} from '../change-request';

const sales = { id: 'sales-1', role: Role.SALES };
const admin = { id: 'admin-1', role: Role.ADMIN };
const priceVersion = {
  processing: {
    id: 'processing-v3', code: 'PROCESSING', version: 3, sourceSha256: 'a'.repeat(64),
  },
  logistics: {
    id: 'logistics-v2', code: 'LOGISTICS', version: 2, sourceSha256: 'b'.repeat(64),
  },
};

type ServiceArgs = {
  now: Date;
  includeOrderCharges: boolean;
  facts: {
    isSfCollect: boolean;
    items: Array<{ itemKey: string; quantity: number }>;
    packagingGroups: Array<{
      groupKey: string;
      mode: OrderPackagingMode;
      items: Array<{ itemKey: string; unitsPerBag: number | null }>;
    }>;
    shipments: Array<{
      shipmentKey: string;
      province: string | null;
      trustedFulfilmentWeightKg: string | null;
      itemQuantities: Record<string, number>;
    }>;
  };
};

function pureResult(args: ServiceArgs) {
  const canonicalItems = args.facts.items.map((item, index) => ({
    itemKey: item.itemKey,
    fig: index + 1,
    craft: 'FULL' as const,
    paperType: '珠光艳闪',
    paperWeightGsm: 160,
    specification: '中号封',
    pricingGroup: 'MID' as const,
    productStructure: OrderProductStructure.STANDARD_ENVELOPE,
    quantity: item.quantity,
    frontColors: ['哑金'],
    backColors: [],
    configuration: {
      paper: 'CATALOG' as const,
      paperWeight: 'CATALOG' as const,
      specification: 'CATALOG' as const,
      craft: 'CATALOG' as const,
    },
  }));
  const rawItems = canonicalItems.map((item) => ({
    itemKey: item.itemKey,
    fig: item.fig,
    status: 'QUOTED' as const,
    unitPrice: '1.0000',
    processingAmount: new Decimal(item.quantity).toFixed(2),
    amount: new Decimal(item.quantity).toFixed(2),
    knownAmount: new Decimal(item.quantity).toFixed(2),
    lines: [], manualReasons: [], errors: [],
  }));
  const quantityByKey = new Map(canonicalItems.map((item) => [item.itemKey, item.quantity]));
  const rawGroups = args.facts.packagingGroups.map((group) => {
    const bagCount = Math.max(...group.items.map((line) =>
      Math.ceil((quantityByKey.get(line.itemKey) ?? 0) / (line.unitsPerBag ?? 1))),
    );
    const amount = new Decimal(bagCount).times('0.10').toFixed(2);
    return {
      groupKey: group.groupKey,
      status: 'QUOTED' as const,
      itemKeys: group.items.map((line) => line.itemKey),
      bagCount,
      amount,
      knownAmount: amount,
      line: {
        layer: 'PACKAGING_GROUP' as const,
        itemKey: null, groupKey: group.groupKey, code: 'BAGGING', label: '入袋',
        status: 'QUOTED' as const, amount, includedInKnownTotal: true,
        basis: { rate: '0.10', bagCount }, errors: [],
      },
      errors: [],
    };
  });
  const processing = rawItems.reduce((sum, item) => sum.plus(item.amount), new Decimal(0))
    .plus(rawGroups.reduce((sum, group) => sum.plus(group.amount), new Decimal(0)));
  const shippingLines = args.includeOrderCharges
    ? args.facts.shipments.map((shipment) => ({
        layer: 'ORDER' as const,
        itemKey: null, groupKey: null,
        code: `SHIPPING:${shipment.shipmentKey}`,
        label: '快递费', status: 'QUOTED' as const, amount: '3.00',
        includedInKnownTotal: true, basis: {}, errors: [],
      }))
    : [];
  const orderAmount = args.includeOrderCharges
    ? new Decimal(5).plus(new Decimal(3).times(shippingLines.length)).toFixed(2)
    : '0.00';
  const knownTotal = processing.plus(orderAmount).toFixed(2);
  return {
    input: {
      items: canonicalItems,
      packagingGroups: args.facts.packagingGroups,
      isSfCollect: args.facts.isSfCollect,
      includeOrderCharges: args.includeOrderCharges,
      shipments: args.facts.shipments.map((shipment) => ({
        shipmentKey: shipment.shipmentKey,
        province: shipment.province,
        trustedBillableWeightKg: shipment.trustedFulfilmentWeightKg,
        itemQuantities: shipment.itemQuantities,
      })),
    },
    snapshot: { priceVersion },
    quote: {
      priceVersion,
      status: 'PARTIAL' as const,
      submittable: true,
      items: rawItems,
      packagingGroups: rawGroups,
      order: {
        amount: orderAmount,
        knownAmount: orderAmount,
        lines: [
          ...(args.includeOrderCharges ? [{
            layer: 'ORDER' as const,
            itemKey: null, groupKey: null, code: 'CARTON', label: '纸箱耗材',
            status: 'QUOTED' as const, amount: '5.00', includedInKnownTotal: true,
            basis: {}, errors: [],
          }] : []),
          ...shippingLines,
          {
            layer: 'ORDER' as const,
            itemKey: null, groupKey: null, code: 'PLATE_FEE', label: '制版费',
            status: 'PENDING_AMOUNT' as const, amount: null,
            includedInKnownTotal: false, basis: {}, errors: [],
          },
        ],
        errors: [],
      },
      total: null,
      knownTotal,
      excludedManualItemKeys: [],
      pendingLineCodes: ['PLATE_FEE'],
      manualReasons: [],
      pendingReasons: [{ code: 'PLATE_AMOUNT_PENDING' as const, message: '制版费待定' }],
      errors: [],
    },
    processing: {
      items: rawItems.map((item) => ({
        components: [],
        suggestedUnitPrice: '1.0000', suggestedFixedFee: '0.00',
        suggestedSubtotal: item.amount, complete: true, errors: [],
        snapshot: { engineVersion: 'CREATE_ORDER_PURE_V1', priceVersion },
      })),
      packaging: {
        groups: rawGroups.map((group) => ({
          groupKey: group.groupKey, complete: true, errors: [],
          suggestedUnitPrice: '0.1000', suggestedSubtotal: group.amount,
          snapshot: { engineVersion: 'CREATE_ORDER_PURE_V1', priceVersion },
        })),
        suggestedTotal: rawGroups.reduce(
          (sum, group) => sum.plus(group.amount), new Decimal(0),
        ).toFixed(2),
        requiresAdminConfirmation: false,
        errors: [],
      },
    },
  };
}

describe('isChangeRequestQuoteAutomaticallyApplicable', () => {
  it('真实纯引擎仅剩 PLATE_FEE 待定时允许改单重算', () => {
    const input = createGoldenOrderInput([
      createGoldenOrderItem({ quantity: 1_200 }),
    ]);
    const quote = calculateCreateOrderQuote(
      input,
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    const processing = presentCreateOrderProcessingQuote({ input, quote });

    expect(quote).toMatchObject({
      status: 'PARTIAL',
      total: null,
      pendingLineCodes: ['PLATE_FEE'],
      pendingReasons: [{ code: 'PLATE_AMOUNT_PENDING' }],
    });
    expect(
      isChangeRequestQuoteAutomaticallyApplicable({ quote, processing }),
    ).toBe(true);
  });

  it('不放过任何夹带其他 pending code 的 PARTIAL 报价', () => {
    const input = createGoldenOrderInput([
      createGoldenOrderItem({ quantity: 2_001 }),
    ]);
    const quote = calculateCreateOrderQuote(
      input,
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    const processing = presentCreateOrderProcessingQuote({ input, quote });

    expect(quote.pendingLineCodes).toEqual(
      expect.arrayContaining(['PLATE_FEE', 'SHIPPING:primary']),
    );
    expect(
      isChangeRequestQuoteAutomaticallyApplicable({ quote, processing }),
    ).toBe(false);
  });
});

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1', sequence: 1, fig: 1, name: '红包 A', productId: 'product-1',
    pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
    productStructure: OrderProductStructure.STANDARD_ENVELOPE,
    artworkVersion: null, plateGroupId: null, pricingGroup: 'MID', manualQuoteReason: null,
    quantity: 1_000, specification: '中号封',
    actualWidthMm: new Decimal(80), actualHeightMm: new Decimal(115),
    paperType: '珠光艳闪', paperWeightGsm: 160, crafts: ['craft-1'],
    frontFoilColors: ['哑金'], backFoilColors: [], foilColors: ['哑金'],
    foilTechnique: OrderFoilTechnique.FLAT, hasLocalFoil: false,
    lamination: OrderLamination.NONE, printColors: [],
    isDoubleSided: false, isDoubleColor: false,
    unitPrice: new Decimal('1'), fixedFee: new Decimal(0), subtotal: new Decimal(1000),
    suggestedSubtotal: new Decimal(1000), pricingSnapshot: { engineVersion: 'OLD' },
    priceOverrideReason: null, remark: null,
    tasks: [{ status: TaskStatus.PENDING }],
    shipmentLines: [{ quantity: 1_000, shipment: { id: 'shipment-1', sequence: 1 } }],
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1', orderId: 'order-1', requesterId: 'sales-1', baseRevision: 2,
    status: OrderChangeRequestStatus.PENDING, reason: '客户变更',
    proposedChanges: { items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 }] },
    requester: { id: 'sales-1', displayName: '销售', role: Role.SALES },
    order: {
      id: 'order-1', orderNo: 'GD-260828-001', submitterId: 'sales-1', submitterRole: Role.SALES,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      billingMode: OrderBillingMode.CHARGE, revision: 2,
      pricingStatus: 'ADMIN_CONFIRMED', priceRevision: 5,
      quotedFee: new Decimal(1008),
      confirmedFee: new Decimal(1008),
      settledFee: new Decimal(1008),
      status: OrderStatus.SUBMITTED, isSfCollect: false,
      packagingAmount: new Decimal(0), processingAmount: new Decimal(1000),
      totalAmount: new Decimal(1008), items: [item()],
      shipments: [{ id: 'shipment-1', sequence: 1, destinationProvince: '广东', weightKg: null }],
      packagingGroups: [], productionOperations: [],
      customerCharges: [
        {
          id: 'shipping-1', shipmentId: 'shipment-1',
          businessKey: 'SHIPMENT:1:SHIPPING_FEE', priceBookId: 'old-logistics',
          amount: new Decimal(3), overrideReason: null, category: { code: 'SHIPPING_FEE' },
        },
        {
          id: 'packing-1', shipmentId: 'shipment-1',
          businessKey: 'SHIPMENT:1:PACKING_MATERIAL', priceBookId: 'old-logistics',
          amount: new Decimal(5), overrideReason: null, category: { code: 'PACKING_MATERIAL' },
        },
      ],
    },
    ...overrides,
  };
}

function locate(value: ReturnType<typeof request>) {
  mocks.db.orderChangeRequest.findUnique
    .mockResolvedValueOnce({ orderId: value.orderId })
    .mockResolvedValueOnce(value);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.$executeRaw.mockResolvedValue(undefined);
  mocks.db.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db),
  );
  mocks.calculate.mockImplementation(
    async (_tx: unknown, args: ServiceArgs) => pureResult(args),
  );
  mocks.finalizeCharges.mockImplementation(
    async (_tx: unknown, input: { shipments: Array<{ shipmentKey: string }> }) => {
      const charges = input.shipments.flatMap((shipment, index) => [
        {
          shipmentKey: shipment.shipmentKey, categoryCode: 'SHIPPING_FEE',
          categoryId: 'shipping-category', priceBookId: priceVersion.logistics.id,
          sourceRuleId: 'shipping-rule', businessKey: `SHIPMENT:${shipment.shipmentKey}:SHIPPING_FEE`,
          status: 'ESTIMATED', description: '快递费', quantity: '1', unit: 'kg',
          suggestedAmount: '3.00', amount: '3.00', pricingSnapshot: {}, overrideReason: null,
        },
        {
          shipmentKey: shipment.shipmentKey, categoryCode: 'PACKING_MATERIAL',
          categoryId: 'packing-category', priceBookId: priceVersion.logistics.id,
          sourceRuleId: 'packing-rule', businessKey: `SHIPMENT:${shipment.shipmentKey}:PACKING_MATERIAL`,
          status: 'ESTIMATED', description: '纸箱耗材', quantity: '1200', unit: '个',
          suggestedAmount: index === 0 ? '5.00' : '0.00',
          amount: index === 0 ? '5.00' : '0.00', pricingSnapshot: {}, overrideReason: null,
        },
      ]);
      return {
        priceBook: {
          ...priceVersion.logistics, name: '物流价目簿', sourceName: 'rules.md', policy: {},
        },
        charges,
        totalAmount: charges.reduce(
          (sum, charge) => sum.plus(charge.amount), new Decimal(0),
        ).toFixed(2),
        requiresAdminConfirmation: false,
      };
    },
  );
  mocks.appendRevision.mockResolvedValue({
    pricingRevisionId: 'pricing-revision-6', priceRevision: 6, orderRevision: 3, snapshot: {},
  });
  mocks.db.orderItem.findMany.mockResolvedValue([{ subtotal: new Decimal(1200) }]);
  mocks.db.orderItemPlateDetail.findMany.mockResolvedValue([]);
  mocks.db.orderCustomerCharge.aggregate.mockResolvedValue({ _sum: { amount: new Decimal(8) } });
  mocks.db.orderCustomerCharge.upsert.mockResolvedValue({ id: 'plate-pending' });
  mocks.db.customerChargeCategory.findUnique.mockResolvedValue({
    id: 'plate-category',
    isActive: true,
  });
  mocks.db.orderChangeRequest.update.mockResolvedValue({ id: 'request-1' });
  mocks.db.orderItem.create.mockResolvedValue({ id: 'item-new' });
});

describe('createOrderChangeRequest', () => {
  it('只保存提案，不改写工单或历史快照', async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'GD-1', submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED, revision: 2, items: [item()],
      changeRequests: [], packagingGroups: [], productionOperations: [],
    });
    mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'request-1' });
    await expect(createOrderChangeRequest({
      orderId: 'order-1', reason: '改数量',
      items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 }],
    }, sales)).resolves.toEqual({ id: 'request-1' });
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });

  it('已有新工序/报工时阻断生产事实变更，名称修改仍可提交', async () => {
    const order = {
      id: 'order-1', orderNo: 'GD-1', submitterId: 'sales-1',
      status: OrderStatus.IN_PRODUCTION, revision: 2, items: [item()],
      changeRequests: [], packagingGroups: [],
      productionOperations: [{ id: 'op-1', reports: [{ id: 'report-1' }] }],
    };
    mocks.db.order.findUnique.mockResolvedValue(order);
    await expect(createOrderChangeRequest({
      orderId: 'order-1', reason: '改数量',
      items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 }],
    }, sales)).rejects.toThrow(/已有新报工记录/);

    mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'request-name' });
    await expect(createOrderChangeRequest({
      orderId: 'order-1', reason: '改名',
      items: [{ operation: 'UPDATE', itemId: 'item-1', name: '新名' }],
    }, sales)).resolves.toEqual({ id: 'request-name' });
  });
});

describe('previewOrderChangeRequestPricing', () => {
  it('把投影后的整单一次交给纯引擎，预览不写库', async () => {
    const second = item({
      id: 'item-2', sequence: 2, quantity: 500, subtotal: new Decimal(500),
      shipmentLines: [{ quantity: 500, shipment: { id: 'shipment-1', sequence: 1 } }],
    });
    const value = request({ order: {
      ...request().order, items: [item(), second],
      processingAmount: new Decimal(1500), totalAmount: new Decimal(1508),
    } });
    locate(value);
    const result = await previewOrderChangeRequestPricing(value.id, admin);
    expect(mocks.calculate).toHaveBeenCalledTimes(1);
    const args = mocks.calculate.mock.calls[0]![1] as ServiceArgs;
    expect(args.facts.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemKey: 'item-1', quantity: 1_200 }),
      expect.objectContaining({ itemKey: 'item-2', quantity: 500 }),
    ]));
    expect(result).toMatchObject({ oldTotal: '1508.00', newTotal: '1708.00', delta: '200.00' });
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });

  it('只改名称时不重算历史金额', async () => {
    const value = request({
      proposedChanges: { items: [{ operation: 'UPDATE', itemId: 'item-1', name: '新名' }] },
    });
    locate(value);
    await expect(previewOrderChangeRequestPricing(value.id, admin)).resolves.toMatchObject({
      newTotal: '1008.00', delta: '0.00', complete: true,
    });
    expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it('预览改价不把已确认的旧制版费带入新已知金额', async () => {
    const value = request({
      proposedChanges: {
        items: [{
          operation: 'ADD',
          templateItemId: 'item-1',
          name: '红包 B',
          quantity: 300,
          frontFoilColors: ['哑金'],
          backFoilColors: [],
        }],
      },
      order: {
        ...request().order,
        totalAmount: new Decimal(1108),
        customerCharges: [
          ...request().order.customerCharges,
          {
            id: 'plate-confirmed',
            shipmentId: null,
            businessKey: PENDING_PLATE_BUSINESS_KEY,
            priceBookId: null,
            amount: new Decimal(100),
            overrideReason: '工厂已确认',
            category: { code: 'PLATE_MAKING_FEE' },
          },
        ],
      },
    });
    locate(value);

    await expect(previewOrderChangeRequestPricing(value.id, admin)).resolves
      .toMatchObject({
        oldTotal: '1108.00',
        newTotal: '1308.00',
        delta: '200.00',
      });
  });

  it('查不到价时失败关闭并指向工厂核价', async () => {
    const value = request();
    locate(value);
    mocks.calculate.mockRejectedValueOnce(new Error('查不到价'));
    await expect(previewOrderChangeRequestPricing(value.id, admin))
      .rejects.toThrow(/查不到价.*工厂确认环节完成核价/);
  });
});

describe('reviewOrderChangeRequest', () => {
  it('revision 变化时标记 STALE，不调引擎', async () => {
    const value = request({ baseRevision: 1, order: { ...request().order, revision: 2 } });
    locate(value);
    await reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null }, admin);
    expect(mocks.db.orderChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: OrderChangeRequestStatus.STALE }),
    }));
    expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it('新工序/报工在锁内阻断事实变更', async () => {
    const value = request({ order: {
      ...request().order,
      productionOperations: [{ id: 'op-1', reports: [{ id: 'report-1' }] }],
    } });
    locate(value);
    await expect(reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null }, admin))
      .rejects.toThrow(/已有新报工记录/);
    expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it('旧 task 只作历史 guard', async () => {
    const value = request({ order: {
      ...request().order,
      items: [item({ tasks: [{ status: TaskStatus.IN_PROGRESS }] })],
    } });
    locate(value);
    await expect(reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null }, admin))
      .rejects.toThrow(/已有开工或完工记录.*不能再修改数量/);
  });

  it('整单一次纯计算，更新全部款式并冻结双价表证据', async () => {
    const second = item({
      id: 'item-2', sequence: 2, quantity: 500, subtotal: new Decimal(500),
      shipmentLines: [{ quantity: 500, shipment: { id: 'shipment-1', sequence: 1 } }],
    });
    const value = request({ order: {
      ...request().order, items: [item(), second],
      processingAmount: new Decimal(1500), totalAmount: new Decimal(1508),
    } });
    locate(value);
    mocks.db.orderItem.findMany.mockResolvedValue([
      { subtotal: new Decimal(1200) }, { subtotal: new Decimal(500) },
    ]);
    await reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null }, admin);
    expect(mocks.calculate).toHaveBeenCalledTimes(1);
    expect(mocks.db.orderItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'item-2' }, data: expect.objectContaining({ subtotal: '500.00' }),
    }));
    expect(mocks.db.orderPriceVersionLock.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ purpose: 'PROCESSING', priceBookId: priceVersion.processing.id }),
      expect.objectContaining({ purpose: 'LOGISTICS', priceBookId: priceVersion.logistics.id }),
    ] });
    expect(mocks.db.order.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        quotedFee: '1708.00',
        quotedFeeCompleteness:
          OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
        quotedPricingRevisionId: 'pricing-revision-6',
      }),
    }));
  });

  it('已提交工单改价时将旧制版费重置为唯一待核价项', async () => {
    const oldPlateAmount = new Decimal(100);
    const value = request({
      proposedChanges: {
        items: [{
          operation: 'ADD',
          templateItemId: 'item-1',
          name: '红包 B',
          quantity: 300,
          frontFoilColors: ['哑金'],
          backFoilColors: [],
        }],
      },
      order: {
        ...request().order,
        totalAmount: new Decimal(1108),
        customerCharges: [
          ...request().order.customerCharges,
          {
            id: 'plate-confirmed',
            shipmentId: null,
            businessKey: PENDING_PLATE_BUSINESS_KEY,
            priceBookId: null,
            amount: oldPlateAmount,
            overrideReason: '工厂已确认',
            status: OrderCustomerChargeStatus.ESTIMATED,
            pricingSnapshot: { status: 'ADMIN_CONFIRMED' },
            category: { code: 'PLATE_MAKING_FEE' },
          },
        ],
      },
    });
    locate(value);
    mocks.db.orderItem.findMany.mockResolvedValue([
      { subtotal: new Decimal(1000) },
      { subtotal: new Decimal(300) },
    ]);
    // The canonical upsert clears the old plate amount before aggregation.
    mocks.db.orderCustomerCharge.aggregate.mockResolvedValue({
      _sum: { amount: new Decimal(8) },
    });

    await reviewOrderChangeRequest(
      { requestId: value.id, decision: 'APPROVE', reviewRemark: null },
      admin,
    );

    expect(mocks.db.orderCustomerCharge.upsert).toHaveBeenCalledWith({
      where: {
        orderId_businessKey: {
          orderId: 'order-1',
          businessKey: PENDING_PLATE_BUSINESS_KEY,
        },
      },
      create: expect.objectContaining({
        orderId: 'order-1',
        businessKey: PENDING_PLATE_BUSINESS_KEY,
        status: OrderCustomerChargeStatus.PENDING_AMOUNT,
        amount: null,
      }),
      update: expect.objectContaining({
        status: OrderCustomerChargeStatus.PENDING_AMOUNT,
        suggestedAmount: null,
        amount: null,
        finalizedById: null,
        finalizedAt: null,
        pricingSnapshot: expect.objectContaining({
          source: 'CHANGE_REQUEST_PENDING_PLATE',
        }),
      }),
    });
    expect(mocks.appendRevision).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        status: 'PENDING_ADMIN_CONFIRMATION',
        orderFeeSnapshot: {
          quotedFee: '1308.00',
          confirmedFee: null,
          settledFee: null,
        },
        metadata: expect.objectContaining({
          quotedFee: '1308.00',
          quotedFeeCompleteness:
            OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
          pureQuote: expect.objectContaining({ knownTotal: '1308.00' }),
        }),
      }),
    );
    expect(mocks.db.order.update).toHaveBeenLastCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        quotedFee: '1308.00',
        quotedFeeCompleteness:
          OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
        quotedPricingRevisionId: 'pricing-revision-6',
        confirmedFee: null,
        settledFee: null,
      }),
    });
  });

  it('改单重算时软移除结构化制版明细，再建立唯一待核价聚合项', async () => {
    const value = request({
      proposedChanges: {
        items: [{
          operation: 'ADD',
          templateItemId: 'item-1',
          name: '红包 B',
          quantity: 300,
          frontFoilColors: ['哑金'],
          backFoilColors: [],
        }],
      },
      order: {
        ...request().order,
        totalAmount: new Decimal(1108),
        customerCharges: [
          ...request().order.customerCharges,
          {
            id: 'plate-detail-charge',
            shipmentId: null,
            businessKey: 'PLATE_DETAIL:plate-detail-1',
            priceBookId: null,
            amount: new Decimal(100),
            overrideReason: '管理员确认制版明细',
            status: OrderCustomerChargeStatus.FINAL,
            pricingSnapshot: { source: 'ORDER_ITEM_PLATE_DETAIL' },
            category: { code: 'PLATE_MAKING_FEE' },
          },
        ],
      },
    });
    locate(value);
    mocks.db.orderItemPlateDetail.findMany.mockResolvedValue([
      { id: 'plate-detail-1', amount: new Decimal(100) },
    ]);
    mocks.db.orderItem.findMany.mockResolvedValue([
      { subtotal: new Decimal(1000) },
      { subtotal: new Decimal(300) },
    ]);
    mocks.db.orderCustomerCharge.aggregate.mockResolvedValue({
      _sum: { amount: new Decimal(8) },
    });

    await reviewOrderChangeRequest(
      { requestId: value.id, decision: 'APPROVE', reviewRemark: null },
      admin,
    );

    expect(mocks.db.orderItemPlateDetail.update).toHaveBeenCalledWith({
      where: { id: 'plate-detail-1' },
      data: expect.objectContaining({
        isActive: false,
        removedById: admin.id,
        removedAt: expect.any(Date),
      }),
      select: { id: true },
    });
    expect(mocks.db.orderCustomerCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderId_businessKey: {
            orderId: 'order-1',
            businessKey: 'PLATE_DETAIL:plate-detail-1',
          },
        },
        data: expect.objectContaining({
          status: OrderCustomerChargeStatus.WAIVED,
          amount: '0.00',
          pricingSnapshot: expect.objectContaining({
            source: 'CHANGE_REQUEST_INVALIDATED_PLATE_DETAIL',
            previousAmount: '100',
          }),
        }),
      }),
    );
    expect(mocks.db.orderCustomerCharge.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderId_businessKey: {
            orderId: 'order-1',
            businessKey: PENDING_PLATE_BUSINESS_KEY,
          },
        },
      }),
    );
    expect(mocks.db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalAmount: '1308.00' }),
      }),
    );
  });

  it('包装组袋数与金额来自同一次纯引擎结果', async () => {
    const value = request({ order: {
      ...request().order,
      packagingAmount: new Decimal(10), processingAmount: new Decimal(1010),
      totalAmount: new Decimal(1018),
      packagingGroups: [{
        id: 'group-1', sequence: 1, name: '单款入袋',
        mode: OrderPackagingMode.SINGLE_STYLE,
        actualBagCount: 100, unitPrice: new Decimal('0.1'), subtotal: new Decimal(10),
        suggestedSubtotal: new Decimal(10), pricingSnapshot: { engineVersion: 'OLD' },
        priceOverrideReason: null,
        lines: [{ orderItemId: 'item-1', unitsPerBag: 10 }],
      }],
    } });
    locate(value);
    await reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null }, admin);
    expect(mocks.db.orderPackagingGroup.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: expect.objectContaining({
        actualBagCount: 120, unitPrice: '0.1000', subtotal: '12.00',
        pricingSnapshot: expect.objectContaining({ source: 'CHANGE_REQUEST_PURE_REQUOTE' }),
      }),
    });
  });

  it('物流持久化与纯引擎金额不一致时失败关闭', async () => {
    const value = request();
    locate(value);
    mocks.finalizeCharges.mockResolvedValueOnce({
      priceBook: { ...priceVersion.logistics },
      charges: [], totalAmount: '99.00', requiresAdminConfirmation: false,
    });
    await expect(reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null }, admin))
      .rejects.toThrow(/金额与纯引擎输出不一致/);
    expect(mocks.appendRevision).not.toHaveBeenCalled();
  });

  it('内部改单使用同一引擎但关闭对客收费层', async () => {
    const value = request({ order: {
      ...request().order,
      settlementType: OrderSettlementType.INTERNAL_SALES,
      billingMode: OrderBillingMode.NO_CHARGE,
      status: OrderStatus.DRAFT,
      totalAmount: new Decimal(1000), customerCharges: [],
    } });
    locate(value);
    mocks.db.orderCustomerCharge.aggregate.mockResolvedValue({ _sum: { amount: null } });
    await reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null }, admin);
    expect(mocks.calculate).toHaveBeenCalledWith(mocks.db, expect.objectContaining({
      includeOrderCharges: false,
    }));
    expect(mocks.finalizeCharges).not.toHaveBeenCalled();
    expect(mocks.appendRevision).not.toHaveBeenCalled();
  });

  it('新增款式进入整单投影，不复制旧任务/人员分配', async () => {
    const value = request({ proposedChanges: { items: [{
      operation: 'ADD', templateItemId: 'item-1', name: '红包 B', quantity: 300,
      frontFoilColors: ['哑金'], backFoilColors: [],
    }] } });
    locate(value);
    mocks.db.orderItem.findMany.mockResolvedValue([
      { subtotal: new Decimal(1000) }, { subtotal: new Decimal(300) },
    ]);
    await reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null }, admin);
    const args = mocks.calculate.mock.calls[0]![1] as ServiceArgs;
    expect(args.facts.items.map((fact) => fact.itemKey)).toEqual(['item-1', 'ADD:1']);
    expect(mocks.db.orderItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: '红包 B', subtotal: '300.00' }),
    }));
    expect(mocks.db).not.toHaveProperty('productionTask');
  });

  it('仅改名不调引擎、不追加价格版本、不替换快照', async () => {
    const value = request({
      proposedChanges: { items: [{ operation: 'UPDATE', itemId: 'item-1', name: '新名' }] },
    });
    locate(value);
    mocks.db.orderItem.findMany.mockResolvedValue([{ subtotal: new Decimal(1000) }]);
    await reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null }, admin);
    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(mocks.appendRevision).not.toHaveBeenCalled();
    expect(mocks.db.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.not.objectContaining({ pricingSnapshot: expect.anything() }),
    });
  });

  it('人工/待定不能靠审核备注沿用旧价', async () => {
    const value = request();
    locate(value);
    mocks.calculate.mockRejectedValueOnce(new Error('MANUAL_PRICING_REQUIRED'));
    await expect(reviewOrderChangeRequest({
      requestId: value.id, decision: 'APPROVE', reviewRemark: '沿用旧价',
    }, admin)).rejects.toThrow(/MANUAL_PRICING_REQUIRED.*工厂确认环节完成核价/);
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });
});

describe('removed legacy chains', () => {
  it('不再引用旧报价器或写 ProductionTask', () => {
    const source = readFileSync(new URL('../change-request.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/productionTask\.(?:create|createMany|update|updateMany)/);
    expect(source).toContain('calculateCreateOrderQuoteFromCatalogInTx');
  });
});
