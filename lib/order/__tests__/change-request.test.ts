import Decimal from 'decimal.js';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderBillingMode,
  OrderChangeRequestType,
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
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    backgroundJob: { updateMany: vi.fn() },
    notificationLog: { updateMany: vi.fn() },
    order: { findUnique: vi.fn(), update: vi.fn() },
    orderItem: { update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    orderItemPlateDetail: { findMany: vi.fn(), update: vi.fn() },
    orderPackagingGroup: { update: vi.fn() },
    orderShipmentLine: { upsert: vi.fn(), create: vi.fn() },
    productionOperation: { updateMany: vi.fn() },
    productionProgressStep: { updateMany: vi.fn() },
    orderCustomerCharge: {
      aggregate: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    orderPrintJob: { findMany: vi.fn() },
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
    createPrint: vi.fn(),
    supersedePrint: vi.fn(),
    activateProduction: vi.fn(),
    dispatchNotification: vi.fn(),
    enqueueNotification: vi.fn(),
    getSetting: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('@/lib/order/create-order-quote-service', () => ({
  calculateCreateOrderQuoteFromCatalogInTx: mocks.calculate,
}));
vi.mock('@/lib/order/pricing-revision', () => ({
  appendOrderPricingRevisionInTx: mocks.appendRevision,
}));
vi.mock('@/lib/order/print-jobs', () => ({
  createOrderPrintRequestInTx: mocks.createPrint,
  supersedeOlderOrderPrintRequestsInTx: mocks.supersedePrint,
}));
vi.mock('@/lib/production/operation-materialization-service', () => ({
  activateProductionOperationsInTx: mocks.activateProduction,
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: mocks.dispatchNotification,
}));
vi.mock('@/lib/notification/transactional-outbox', () => ({
  enqueueNotificationInTransaction: mocks.enqueueNotification,
}));
vi.mock('@/lib/settings', () => ({ getSetting: mocks.getSetting }));
vi.mock('@/lib/price/order-charge-service', () => ({
  OrderCustomerChargeError: class OrderCustomerChargeError extends Error {},
  resolveExternalOrderChargesForFinalization: mocks.finalizeCharges,
}));

import {
  allocateCancellationProducedQuantity,
  cancellationReferenceFromCalculation,
  confirmOrderPricingAtCurrentPublishedVersionInTx,
  createOrderChangeRequest,
  isChangeRequestQuoteAutomaticallyApplicable,
  previewFactoryConfirmationPriceDiff,
  previewOrderChangeRequestPricing,
  reviewOrderChangeRequest,
  withdrawOrderChangeRequest,
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

function pureResult(
  args: ServiceArgs,
  options: { plateApplies?: boolean; atomicBundledPlate?: boolean } = {},
) {
  const plateApplies = options.plateApplies ?? true;
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
  const rawItems = canonicalItems.map((item, index) => {
    const hasAtomicBundle = options.atomicBundledPlate && index === 0;
    const amount = new Decimal(item.quantity)
      .plus(hasAtomicBundle ? 200 : 0)
      .toFixed(2);
    return {
      itemKey: item.itemKey,
      fig: item.fig,
      status: 'QUOTED' as const,
      unitPrice: '1.0000',
      processingAmount: amount,
      amount,
      knownAmount: amount,
      lines: hasAtomicBundle
        ? [{
            layer: 'ITEM' as const,
            itemKey: item.itemKey,
            groupKey: null,
            code: 'PRINT_FOIL_PER_ORDER',
            label: '彩印单色烫金（含制版费）',
            status: 'QUOTED' as const,
            amount: '200.00',
            includedInKnownTotal: true,
            basis: { plateTreatment: 'INCLUDED_IN_ATOMIC_BUNDLE' },
            errors: [],
          }]
        : [],
      manualReasons: [],
      errors: [],
    };
  });
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
    snapshot: { ...CREATE_ORDER_GOLDEN_SNAPSHOT, priceVersion },
    quote: {
      priceVersion,
      status: plateApplies ? ('PARTIAL' as const) : ('QUOTED' as const),
      submittable: true,
      items: rawItems,
      packagingGroups: rawGroups,
      order: {
        // The real engine always keeps the aggregate order amount unknown
        // while the plate fee is pending. Only the known subtotal is usable.
        amount: plateApplies ? null : orderAmount,
        knownAmount: orderAmount,
        lines: [
          ...(args.includeOrderCharges ? [{
            layer: 'ORDER' as const,
            itemKey: null, groupKey: null, code: 'CARTON', label: '纸箱耗材',
            status: 'QUOTED' as const, amount: '5.00', includedInKnownTotal: true,
            basis: {}, errors: [],
          }] : []),
          ...shippingLines,
          ...(plateApplies ? [{
            layer: 'ORDER' as const,
            itemKey: null, groupKey: null, code: 'PLATE_FEE', label: '制版费',
            status: 'PENDING_AMOUNT' as const, amount: null,
            includedInKnownTotal: false,
            basis: { pricingPolicy: 'ADMIN_MANUAL_ONLY' }, errors: [],
          }] : []),
        ],
        errors: [],
      },
      total: plateApplies ? null : knownTotal,
      knownTotal,
      excludedManualItemKeys: [],
      pendingLineCodes: plateApplies ? ['PLATE_FEE'] : [],
      manualReasons: [],
      pendingReasons: plateApplies
        ? [{ code: 'PLATE_AMOUNT_PENDING' as const, message: '制版费待定' }]
        : [],
      errors: [],
    },
    processing: {
      items: rawItems.map((item, index) => ({
        components: [],
        suggestedUnitPrice: '1.0000',
        suggestedFixedFee:
          options.atomicBundledPlate && index === 0 ? '200.00' : '0.00',
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

function manualItemResult(args: ServiceArgs, manualIndex = 0) {
  const base = pureResult(args, { plateApplies: false });
  const manualItem = base.quote.items[manualIndex];
  if (!manualItem) throw new Error('测试缺少待人工核价款式');
  const reason = {
    code: 'PRINT_PRICE_NOT_FOUND' as const,
    message: '彩印基础价需人工确认',
    itemKey: manualItem.itemKey,
  };
  return {
    ...base,
    quote: {
      ...base.quote,
      status: 'MANUAL_PRICING_REQUIRED' as const,
      total: null,
      items: base.quote.items.map((candidate, index) =>
        index === manualIndex
          ? {
              ...candidate,
              status: 'MANUAL_PRICING_REQUIRED' as const,
              unitPrice: null,
              processingAmount: null,
              amount: null,
              knownAmount: '0.00',
              manualReasons: [
                { code: reason.code, message: reason.message },
              ],
            }
          : candidate,
      ),
      excludedManualItemKeys: [manualItem.itemKey],
      manualReasons: [reason],
    },
    processing: {
      ...base.processing,
      items: base.processing.items.map((candidate, index) =>
        index === manualIndex
          ? {
              ...candidate,
              suggestedUnitPrice: null,
              suggestedFixedFee: null,
              suggestedSubtotal: null,
              complete: false,
              errors: [reason.message],
            }
          : candidate,
      ),
    },
  };
}

function manualPrintFoilResult(args: ServiceArgs) {
  const base = manualItemResult(args);
  const manual = base.quote.manualReasons[0]!;
  const reason = {
    ...manual,
    code: 'PRINT_FOIL_MANUAL_PRICE_INCLUDES_PLATE' as const,
    message: '彩印烫金整款人工价必须包含制版费',
  };
  return {
    ...base,
    quote: {
      ...base.quote,
      items: base.quote.items.map((item, index) =>
        index === 0
          ? {
              ...item,
              manualReasons: [
                { code: reason.code, message: reason.message },
              ],
            }
          : item,
      ),
      manualReasons: [reason],
    },
    processing: {
      ...base.processing,
      items: base.processing.items.map((item, index) =>
        index === 0 ? { ...item, errors: [reason.message] } : item,
      ),
    },
  };
}

function manualPackagingResult(args: ServiceArgs, groupKey: string) {
  const base = pureResult(args, { plateApplies: false });
  const rawGroups = base.quote.packagingGroups.map((group) =>
    group.groupKey === groupKey
      ? {
          ...group,
          status: 'PENDING_AMOUNT' as const,
          bagCount: null,
          amount: null,
          knownAmount: '0.00',
          line: {
            ...group.line,
            status: 'PENDING_AMOUNT' as const,
            amount: null,
            includedInKnownTotal: false,
          },
        }
      : group,
  );
  return {
    ...base,
    quote: {
      ...base.quote,
      status: 'PARTIAL' as const,
      total: null,
      packagingGroups: rawGroups,
      pendingLineCodes: [`${groupKey}:BAGGING`],
      pendingReasons: [{
        code: 'BAGGING_INPUT_PENDING' as const,
        message: '入袋金额待定',
        groupKey,
      }],
    },
    processing: {
      ...base.processing,
      packaging: {
        ...base.processing.packaging,
        groups: base.processing.packaging.groups.map((group) =>
          group.groupKey === groupKey
            ? {
                ...group,
                complete: false,
                suggestedUnitPrice: null,
                suggestedSubtotal: null,
                errors: ['入袋金额待人工核价'],
              }
            : group,
        ),
        suggestedTotal: null,
        requiresAdminConfirmation: true,
      },
    },
  };
}

function pendingShippingResult(args: ServiceArgs, shipmentKey: string) {
  const base = pureResult(args, { plateApplies: false });
  return {
    ...base,
    quote: {
      ...base.quote,
      status: 'PARTIAL' as const,
      total: null,
      order: {
        ...base.quote.order,
        amount: null,
        lines: base.quote.order.lines.map((line) =>
          line.code === `SHIPPING:${shipmentKey}`
            ? {
                ...line,
                status: 'PENDING_AMOUNT' as const,
                amount: null,
                includedInKnownTotal: false,
              }
            : line,
        ),
      },
      pendingLineCodes: [`SHIPPING:${shipmentKey}`],
      pendingReasons: [{
        code: 'FREIGHT_QUOTE_PENDING' as const,
        message: '快递费待定',
        shipmentKey,
      }],
    },
  };
}

function realEngineResult(args: ServiceArgs) {
  const input = {
    items: args.facts.items.map((candidate, index) =>
      createGoldenOrderItem({
        itemKey: candidate.itemKey,
        fig: index + 1,
        quantity: candidate.quantity,
      }),
    ),
    packagingGroups: args.facts.packagingGroups,
    isSfCollect: args.facts.isSfCollect,
    shipments: args.facts.shipments.map((shipment) => ({
      shipmentKey: shipment.shipmentKey,
      province: shipment.province,
      trustedBillableWeightKg: shipment.trustedFulfilmentWeightKg,
      itemQuantities: shipment.itemQuantities,
    })),
    includeOrderCharges: args.includeOrderCharges,
  };
  const quote = calculateCreateOrderQuote(
    input,
    CREATE_ORDER_GOLDEN_SNAPSHOT,
  );
  return {
    input,
    snapshot: CREATE_ORDER_GOLDEN_SNAPSHOT,
    quote,
    processing: presentCreateOrderProcessingQuote({ input, quote }),
  };
}

describe('isChangeRequestQuoteAutomaticallyApplicable', () => {
  it('真实纯引擎的彩印含版费原子套餐是完整可应用报价', () => {
    const input = createGoldenOrderInput([
      createGoldenOrderItem({
        craft: 'PRINT',
        paperType: '铜版纸',
        paperWeightGsm: 200,
        specification: '大号封',
        frontColors: ['哑金'],
        backColors: [],
        printFoilMode: 'PARTIAL',
      }),
    ]);
    const quote = calculateCreateOrderQuote(input, CREATE_ORDER_GOLDEN_SNAPSHOT);
    const processing = presentCreateOrderProcessingQuote({ input, quote });

    expect(quote).toMatchObject({
      status: 'QUOTED',
      pendingLineCodes: [],
      manualReasons: [],
    });
    expect(quote.order.lines.map((line) => line.code)).not.toContain('PLATE_FEE');
    expect(
      isChangeRequestQuoteAutomaticallyApplicable({ quote, processing }),
    ).toBe(true);
  });

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

function adminConfirmedSnapshot(
  actual: Record<string, unknown> = {},
) {
  return {
    source: 'ADMIN_SNAPSHOT_CONFIRMATION',
    previousPriceRevision: 0,
    status: 'ADMIN_CONFIRMED',
    actual: {
      ...actual,
      provisional: false,
      requiresAdminConfirmation: false,
      automatic: false,
    },
    confirmation: {
      actorId: 'admin-1',
      confirmedAt: '2026-09-02T02:00:00.000Z',
    },
  };
}

function plainPrintItem(overrides: Record<string, unknown> = {}) {
  return item({
    productId: 'product-print',
    pricingRoute: OrderItemPricingRoute.COLOR_PRINT,
    paperType: '铜版纸',
    paperWeightGsm: 200,
    crafts: ['craft-print'],
    frontFoilColors: [],
    backFoilColors: [],
    foilColors: [],
    foilTechnique: OrderFoilTechnique.NONE,
    hasLocalFoil: false,
    printColors: ['CMYK'],
    isDoubleSided: false,
    isDoubleColor: false,
    ...overrides,
  });
}

function bundledPrintItem(overrides: Record<string, unknown> = {}) {
  return plainPrintItem({
    crafts: ['craft-print-foil'],
    frontFoilColors: ['哑金'],
    foilColors: ['哑金'],
    foilTechnique: OrderFoilTechnique.FLAT,
    hasLocalFoil: true,
    ...overrides,
  });
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1', orderId: 'order-1', requesterId: 'sales-1', baseRevision: 2,
    baseWorkOrderVersion: null,
    type: OrderChangeRequestType.MODIFY,
    status: OrderChangeRequestStatus.PENDING, reason: '客户变更',
    proposedChanges: { items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 }] },
    requester: { id: 'sales-1', displayName: '销售', role: Role.SALES },
    order: {
      id: 'order-1', orderNo: 'GD-260828-001', submitterId: 'sales-1', submitterRole: Role.SALES,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      billingMode: OrderBillingMode.CHARGE, revision: 2, workOrderVersion: 1,
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
          status: OrderCustomerChargeStatus.ESTIMATED,
          amount: new Decimal(3), pricingSnapshot: {}, overrideReason: null,
          category: { code: 'SHIPPING_FEE' },
        },
        {
          id: 'packing-1', shipmentId: 'shipment-1',
          businessKey: 'SHIPMENT:1:PACKING_MATERIAL', priceBookId: 'old-logistics',
          status: OrderCustomerChargeStatus.ESTIMATED,
          amount: new Decimal(5), pricingSnapshot: {}, overrideReason: null,
          category: { code: 'PACKING_MATERIAL' },
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

function locateCancellation(value: ReturnType<typeof request>) {
  mocks.db.orderChangeRequest.findUnique
    .mockResolvedValueOnce({
      orderId: value.orderId,
      type: OrderChangeRequestType.CANCEL,
    })
    .mockResolvedValueOnce(value);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSetting.mockResolvedValue({ enabled: true });
  mocks.enqueueNotification.mockResolvedValue(false);
  mocks.dispatchNotification.mockResolvedValue(undefined);
  mocks.db.$executeRaw.mockResolvedValue(undefined);
  mocks.db.$queryRaw.mockResolvedValue([{ now: new Date('2026-09-02T02:00:00.000Z') }]);
  mocks.db.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db),
  );
  mocks.calculate.mockImplementation(
    async (_tx: unknown, args: ServiceArgs) => pureResult(args),
  );
  mocks.finalizeCharges.mockImplementation(
    async (
      _tx: unknown,
      input: {
        shipments: Array<{
          shipmentKey: string;
          shippingFee: string | null;
          packingMaterialFee: string | null;
          overrideReason: string | null;
        }>;
      },
    ) => {
      const charges = input.shipments.flatMap((shipment, index) => [
        {
          shipmentKey: shipment.shipmentKey, categoryCode: 'SHIPPING_FEE',
          categoryId: 'shipping-category', priceBookId: priceVersion.logistics.id,
          sourceRuleId: 'shipping-rule', businessKey: `SHIPMENT:${shipment.shipmentKey}:SHIPPING_FEE`,
          status: 'ESTIMATED', description: '快递费', quantity: '1', unit: 'kg',
          suggestedAmount: '3.00', amount: shipment.shippingFee ?? '3.00',
          pricingSnapshot: {}, overrideReason: shipment.overrideReason,
        },
        {
          shipmentKey: shipment.shipmentKey, categoryCode: 'PACKING_MATERIAL',
          categoryId: 'packing-category', priceBookId: priceVersion.logistics.id,
          sourceRuleId: 'packing-rule', businessKey: `SHIPMENT:${shipment.shipmentKey}:PACKING_MATERIAL`,
          status: 'ESTIMATED', description: '纸箱耗材', quantity: '1200', unit: '个',
          suggestedAmount: index === 0 ? '5.00' : '0.00',
          amount:
            shipment.packingMaterialFee ?? (index === 0 ? '5.00' : '0.00'),
          pricingSnapshot: {}, overrideReason: shipment.overrideReason,
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
  mocks.createPrint.mockResolvedValue({
    jobId: 'reprint-v3',
    idempotentReplay: false,
  });
  mocks.supersedePrint.mockResolvedValue({ requestJobIds: [] });
  mocks.activateProduction.mockResolvedValue({
    orderId: 'order-1',
    orderStatus: OrderStatus.RELEASED,
    operationIds: ['operation-v-next'],
    operationsCreated: 1,
    progressStepIds: [],
    progressStepsCreated: 0,
    idempotentReplay: false,
  });
  mocks.db.orderPrintJob.findMany.mockResolvedValue([]);
  mocks.db.backgroundJob.updateMany.mockResolvedValue({ count: 0 });
  mocks.db.notificationLog.updateMany.mockResolvedValue({ count: 0 });
  mocks.db.orderItem.findMany.mockResolvedValue([{ subtotal: new Decimal(1200) }]);
  mocks.db.orderItemPlateDetail.findMany.mockResolvedValue([]);
  mocks.db.orderCustomerCharge.findUnique.mockResolvedValue(null);
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
      status: OrderStatus.SUBMITTED, revision: 2, workOrderVersion: 1,
      items: [item()],
      changeRequests: [], packagingGroups: [], productionOperations: [],
    });
    mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'request-1' });
    await expect(createOrderChangeRequest({
      orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
      reason: '改数量',
      items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 }],
    }, sales)).resolves.toEqual({ id: 'request-1' });
    expect(mocks.db.order.update).not.toHaveBeenCalled();
    expect(mocks.db.orderChangeRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          baseRevision: 2,
          baseWorkOrderVersion: 1,
          beforeSnapshot: expect.objectContaining({
            revision: 2,
            workOrderVersion: 1,
          }),
        }),
      }),
    );
    expect(mocks.db.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        operatorId: 'sales-1',
        action: 'CHANGE_REQUEST_CREATED',
        changedFields: expect.objectContaining({
          requestId: 'request-1',
          requestType: OrderChangeRequestType.MODIFY,
        }),
      }),
    });
    expect(mocks.enqueueNotification).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      'ORDER_CHANGE_REQUESTED',
      {
        orderId: 'order-1',
        orderNo: 'GD-1',
        summary: '销售已提交修改申请，待工厂确认',
        deepLink: '/orders#wo=GD-1',
      },
      { dedupeKey: 'notification:ORDER_CHANGE_REQUESTED:request-1' },
    );
    expect(mocks.dispatchNotification).toHaveBeenCalledExactlyOnceWith(
      'ORDER_CHANGE_REQUESTED',
      expect.objectContaining({ orderNo: 'GD-1' }),
      { dedupeKey: 'notification:ORDER_CHANGE_REQUESTED:request-1' },
    );
  });

  it.each([
    {
      label: '业务版本',
      expectedRevision: 1,
      expectedWorkOrderVersion: 3,
    },
    {
      label: '纸质工单版本',
      expectedRevision: 2,
      expectedWorkOrderVersion: 2,
    },
  ])('在工单锁内拒绝过期的$label快照', async ({
    expectedRevision,
    expectedWorkOrderVersion,
  }) => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'GD-1', submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED, revision: 2, workOrderVersion: 3,
      items: [item()], changeRequests: [], packagingGroups: [],
      productionOperations: [],
    });

    await expect(createOrderChangeRequest({
      orderId: 'order-1',
      expectedRevision,
      expectedWorkOrderVersion,
      reason: '改数量',
      items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 }],
    }, sales)).rejects.toThrow(/工单版本已更新.*请刷新后重新提交/u);
    expect(mocks.db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.db.orderChangeRequest.create).not.toHaveBeenCalled();
  });

  it('拒绝与当前款式语义相同的 UPDATE', async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'GD-1', submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED, revision: 2, workOrderVersion: 1,
      items: [item()], changeRequests: [], packagingGroups: [],
      productionOperations: [],
    });

    await expect(createOrderChangeRequest({
      orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
      reason: '重复提交',
      items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 1_000 }],
    }, sales)).rejects.toThrow(/没有实际变化/u);
    expect(mocks.db.orderChangeRequest.create).not.toHaveBeenCalled();
  });

  it('持久模式在申请事务内落 outbox，且不持久自由文本原因或金额', async () => {
    mocks.enqueueNotification.mockResolvedValue(true);
    mocks.db.order.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'GD-1', submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED, revision: 2, workOrderVersion: 1,
      items: [item()],
      changeRequests: [], packagingGroups: [], productionOperations: [],
    });
    mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'request-1' });

    await createOrderChangeRequest({
      orderId: 'order-1',
      expectedRevision: 2,
      expectedWorkOrderVersion: 1,
      reason: '客户说价格改成 9999 元，电话 13800000000',
      items: [{ operation: 'UPDATE', itemId: 'item-1', name: '新名' }],
    }, sales);

    const payload = mocks.enqueueNotification.mock.calls[0]?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(payload).toEqual({
      orderId: 'order-1',
      orderNo: 'GD-1',
      summary: '销售已提交修改申请，待工厂确认',
      deepLink: '/orders#wo=GD-1',
    });
    expect(JSON.stringify(payload)).not.toContain('9999');
    expect(JSON.stringify(payload)).not.toContain('13800000000');
    expect(mocks.dispatchNotification).not.toHaveBeenCalled();
  });

  it('通知开关关闭时仍提交申请，但不写 outbox', async () => {
    mocks.getSetting.mockResolvedValue({ enabled: false });
    mocks.db.order.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'GD-1', submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED, revision: 2, workOrderVersion: 1,
      items: [item()],
      changeRequests: [], packagingGroups: [], productionOperations: [],
    });
    mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'request-off' });

    await expect(createOrderChangeRequest({
      orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
      reason: '改名',
      items: [{ operation: 'UPDATE', itemId: 'item-1', name: '新名' }],
    }, sales)).resolves.toEqual({ id: 'request-off' });
    expect(mocks.enqueueNotification).not.toHaveBeenCalled();
    expect(mocks.dispatchNotification).not.toHaveBeenCalled();
  });

  it('已有新工序/报工时阻断生产事实变更，名称修改仍可提交', async () => {
    const order = {
      id: 'order-1', orderNo: 'GD-1', submitterId: 'sales-1',
      status: OrderStatus.IN_PRODUCTION, revision: 2, workOrderVersion: 1,
      items: [item()],
      changeRequests: [], packagingGroups: [],
      productionOperations: [{ id: 'op-1', reports: [{ id: 'report-1' }] }],
    };
    mocks.db.order.findUnique.mockResolvedValue(order);
    await expect(createOrderChangeRequest({
      orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
      reason: '改数量',
      items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 }],
    }, sales)).rejects.toThrow(/已有新报工记录/);

    mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'request-name' });
    await expect(createOrderChangeRequest({
      orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
      reason: '改名',
      items: [{ operation: 'UPDATE', itemId: 'item-1', name: '新名' }],
    }, sales)).resolves.toEqual({ id: 'request-name' });
  });

  it('allows the submitter to request CANCEL after confirmation without mutating production', async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: 'GD-1',
      submitterId: 'sales-1',
      status: OrderStatus.RELEASED,
      revision: 4,
      workOrderVersion: 4,
      items: [item()],
      changeRequests: [],
      packagingGroups: [],
      productionOperations: [
        { id: 'op-v1', reports: [{ id: 'report-v1' }] },
      ],
    });
    mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'cancel-1' });

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          expectedRevision: 4,
          expectedWorkOrderVersion: 4,
          type: 'CANCEL',
          reason: '客户终止项目',
          items: [],
        },
        sales,
      ),
    ).resolves.toEqual({ id: 'cancel-1' });
    expect(mocks.db.order.update).not.toHaveBeenCalled();
    expect(mocks.db.productionOperation.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.orderChangeRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: OrderChangeRequestType.CANCEL,
          modifyKind: null,
          baseRevision: 4,
          baseWorkOrderVersion: 4,
        }),
      }),
    );
  });
});

describe('withdrawOrderChangeRequest', () => {
  it('lets only the requester withdraw a pending request and writes an audit log', async () => {
    mocks.db.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce({
        id: 'request-1',
        orderId: 'order-1',
        requesterId: 'sales-1',
        status: OrderChangeRequestStatus.PENDING,
        type: OrderChangeRequestType.CANCEL,
      });
    mocks.db.orderChangeRequest.update.mockResolvedValueOnce({
      id: 'request-1',
      status: OrderChangeRequestStatus.WITHDRAWN,
    });

    await expect(
      withdrawOrderChangeRequest({ requestId: 'request-1' }, sales),
    ).resolves.toMatchObject({ status: OrderChangeRequestStatus.WITHDRAWN });
    expect(mocks.db.orderChangeRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: expect.objectContaining({
        status: OrderChangeRequestStatus.WITHDRAWN,
        reviewedById: 'sales-1',
        reviewRemark: '申请人撤回',
      }),
    });
    expect(mocks.db.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CHANGE_REQUEST_WITHDRAWN',
        changedFields: expect.objectContaining({
          requestId: 'request-1',
          requestType: OrderChangeRequestType.CANCEL,
        }),
      }),
    });
  });

  it('rejects withdrawal by a different sales account', async () => {
    mocks.db.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce({
        id: 'request-1',
        orderId: 'order-1',
        requesterId: 'sales-other',
        status: OrderChangeRequestStatus.PENDING,
        type: OrderChangeRequestType.MODIFY,
      });

    await expect(
      withdrawOrderChangeRequest({ requestId: 'request-1' }, sales),
    ).rejects.toThrow(/只能撤回自己/);
    expect(mocks.db.orderChangeRequest.update).not.toHaveBeenCalled();
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

  it('内部非生产态预览与批准一致：旧制版 aggregate 归入重算而不保留', async () => {
    const value = request({
      order: {
        ...request().order,
        settlementType: OrderSettlementType.INTERNAL_SALES,
        billingMode: OrderBillingMode.CHARGE,
        status: OrderStatus.DRAFT,
        processingAmount: new Decimal('1000.00'),
        totalAmount: new Decimal('1100.00'),
        customerCharges: [
          {
            id: 'plate-old',
            shipmentId: null,
            businessKey: PENDING_PLATE_BUSINESS_KEY,
            priceBookId: null,
            amount: new Decimal('100.00'),
            overrideReason: '历史人工核价',
            category: { code: 'PLATE_MAKING_FEE' },
          },
        ],
      },
    });
    locate(value);

    await expect(previewOrderChangeRequestPricing(value.id, admin)).resolves
      .toMatchObject({
        oldTotal: '1100.00',
        newTotal: '1200.00',
        delta: '100.00',
      });
  });

  it('已确认生产版本预览保留已发生制版费', async () => {
    const value = request({
      order: {
        ...request().order,
        status: OrderStatus.CONFIRMED,
        processingAmount: new Decimal('1000.00'),
        totalAmount: new Decimal('1108.00'),
        customerCharges: [
          ...request().order.customerCharges,
          {
            id: 'plate-final',
            shipmentId: null,
            businessKey: 'PLATE_DETAIL:already-consumed',
            priceBookId: null,
            amount: new Decimal('100.00'),
            overrideReason: '已发生制版费',
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

  it('生产版本仅命中含版费原子套餐时，若仍有非零独立版费则预览失败关闭', async () => {
    const value = request({
      order: {
        ...request().order,
        status: OrderStatus.CONFIRMED,
        customerCharges: [
          ...request().order.customerCharges,
          {
            id: 'plate-final',
            shipmentId: null,
            businessKey: PENDING_PLATE_BUSINESS_KEY,
            priceBookId: null,
            amount: new Decimal('100.00'),
            overrideReason: '已发生制版费',
            category: { code: 'PLATE_MAKING_FEE' },
          },
        ],
      },
    });
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, { plateApplies: false, atomicBundledPlate: true }),
    );
    await expect(previewOrderChangeRequestPricing(value.id, admin)).rejects
      .toThrow(/含版费彩印烫金原子套餐.*重复收费风险/u);
  });

  it('生产版本的混合订单缺少版费款式归属时失败关闭', async () => {
    const value = request({
      order: {
        ...request().order,
        status: OrderStatus.CONFIRMED,
        customerCharges: [
          ...request().order.customerCharges,
          {
            id: 'plate-final',
            shipmentId: null,
            businessKey: PENDING_PLATE_BUSINESS_KEY,
            priceBookId: null,
            amount: new Decimal('100.00'),
            overrideReason: '普通烫金已发生制版费',
            category: { code: 'PLATE_MAKING_FEE' },
          },
        ],
      },
    });
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, { plateApplies: true, atomicBundledPlate: true }),
    );

    await expect(previewOrderChangeRequestPricing(value.id, admin)).rejects
      .toThrow(/含版费彩印烫金原子套餐.*重复收费风险/u);
  });

  it('生产版本存在待定历史独立版费且新价命中原子套餐时失败关闭', async () => {
    const value = request({
      order: {
        ...request().order,
        status: OrderStatus.CONFIRMED,
        customerCharges: [
          ...request().order.customerCharges,
          {
            id: 'plate-pending',
            shipmentId: null,
            businessKey: PENDING_PLATE_BUSINESS_KEY,
            priceBookId: null,
            status: OrderCustomerChargeStatus.PENDING_AMOUNT,
            amount: null,
            pricingSnapshot: {},
            overrideReason: null,
            category: { code: 'PLATE_MAKING_FEE' },
          },
        ],
      },
    });
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, { plateApplies: true, atomicBundledPlate: true }),
    );

    await expect(previewOrderChangeRequestPricing(value.id, admin)).rejects
      .toThrow(/待定或非零的独立制版费.*重复收费风险/u);
  });

  it('历史生产中工单预览价格修改时直接失败关闭', async () => {
    const value = request({
      order: {
        ...request().order,
        status: OrderStatus.IN_PRODUCTION,
      },
    });
    locate(value);

    await expect(previewOrderChangeRequestPricing(value.id, admin))
      .rejects.toThrow(/历史“生产中”.*请新建工单/u);
    expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: '新增普通烫金款',
      change: {
        operation: 'ADD' as const,
        templateItemId: 'item-1',
        name: '红包 B',
        quantity: 300,
        frontFoilColors: ['亮金'],
        backFoilColors: [],
      },
    },
    {
      label: '更换普通烫金颜色',
      change: {
        operation: 'UPDATE' as const,
        itemId: 'item-1',
        frontFoilColors: ['亮金'],
        backFoilColors: [],
      },
    },
  ])('生产版本 $label 时不沿用历史版费', async ({ change }) => {
    const value = request({
      proposedChanges: { items: [change] },
      order: { ...request().order, status: OrderStatus.CONFIRMED },
    });
    locate(value);

    await expect(previewOrderChangeRequestPricing(value.id, admin)).rejects
      .toThrow(/生产版本新增、移除或变更.*不能自动替换或重新计价/u);
    expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it.each([
    OrderStatus.CONFIRMED,
    OrderStatus.RELEASED,
    OrderStatus.FOILING,
    OrderStatus.PACKING,
  ])('生产状态 %s 的彩印烫金改色或移除均失败关闭', async (status) => {
    for (const frontFoilColors of [['亮金'], []] as const) {
      vi.clearAllMocks();
      mocks.db.$transaction.mockImplementation(
        async (callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db),
      );
      const value = request({
        proposedChanges: {
          items: [{
            operation: 'UPDATE',
            itemId: 'item-1',
            frontFoilColors,
            backFoilColors: [],
          }],
        },
        order: {
          ...request().order,
          status,
          items: [bundledPrintItem()],
        },
      });
      locate(value);

      await expect(previewOrderChangeRequestPricing(value.id, admin)).rejects
        .toThrow(
          /生产版本新增、移除或变更.*不能自动替换或重新计价|计价事实不合法/u,
        );
      expect(mocks.calculate).not.toHaveBeenCalled();
    }
  });

  it('生产状态的彩印烫金仅改数量仍按新原子套餐预览', async () => {
    const value = request({
      proposedChanges: {
        items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 }],
      },
      order: {
        ...request().order,
        status: OrderStatus.RELEASED,
        items: [bundledPrintItem()],
      },
    });
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, { plateApplies: false, atomicBundledPlate: true }),
    );

    await expect(previewOrderChangeRequestPricing(value.id, admin)).resolves
      .toMatchObject({ newTotal: '1408.00' });
  });

  it('查不到价时失败关闭并指向工厂核价', async () => {
    const value = request();
    locate(value);
    mocks.calculate.mockRejectedValueOnce(new Error('查不到价'));
    await expect(previewOrderChangeRequestPricing(value.id, admin))
      .rejects.toThrow(/查不到价.*工厂确认环节完成核价/);
  });
});

describe('confirmOrderPricingAtCurrentPublishedVersionInTx', () => {
  it('首次工厂确认按当前发布双价表重算，保留原 quoted 指针', async () => {
    const quotedFee = new Decimal('1008.00');
    mocks.db.orderItem.findMany.mockResolvedValueOnce([
      { subtotal: new Decimal('1000.00') },
    ]);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, { plateApplies: false }),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...request().order,
      quotedFee,
      quotedPricingRevisionId: 'quoted-revision-v1',
      confirmedFee: null,
      settledFee: null,
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      confirmedFee: '1008.00',
      pricingRevisionId: 'pricing-revision-6',
      versions: priceVersion,
    });

    expect(mocks.appendRevision).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        status: 'ADMIN_CONFIRMED',
        source: 'FACTORY_CONFIRM_CURRENT_PUBLISHED',
        orderFeeSnapshot: {
          quotedFee,
          confirmedFee: '1008.00',
          settledFee: null,
        },
        metadata: expect.objectContaining({
          quotedPricingRevisionId: 'quoted-revision-v1',
          preservedQuotedFee: '1008.00',
          confirmedFee: '1008.00',
        }),
      }),
    );
    expect(mocks.db.orderPriceVersionLock.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          purpose: 'PROCESSING',
          priceBookId: priceVersion.processing.id,
        }),
        expect.objectContaining({
          purpose: 'LOGISTICS',
          priceBookId: priceVersion.logistics.id,
        }),
      ],
    });
    expect(mocks.db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: '1008.00',
          confirmedFee: '1008.00',
        }),
      }),
    );
    expect(
      mocks.db.order.update.mock.calls.some(
        ([call]) => call.data?.quotedFee !== undefined,
      ),
    ).toBe(false);
  });

  it('工厂确认保留管理员已锁定的历史人工报价款式', async () => {
    mocks.db.orderItem.findMany.mockResolvedValueOnce([
      { subtotal: new Decimal('1000.00') },
    ]);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => manualItemResult(args),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...request().order,
      items: [
        item({
          pricingRoute: OrderItemPricingRoute.MANUAL_QUOTE,
          pricingSnapshot: {
            ...adminConfirmedSnapshot(),
            input: {
              pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
            },
          },
        }),
      ],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      confirmedFee: '1008.00',
      pricingRevisionId: 'pricing-revision-6',
    });

    expect(mocks.calculate).toHaveBeenCalledOnce();
    expect(mocks.calculate).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        facts: expect.objectContaining({
          items: [
            expect.objectContaining({
              pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
            }),
          ],
        }),
      }),
    );
    expect(mocks.db.orderItem.update).not.toHaveBeenCalled();
  });

  it('工厂确认拒绝尚未管理员锁定的当前计价路线人工款式', async () => {
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => manualItemResult(args),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...request().order,
      items: [
        plainPrintItem({
          pricingSnapshot: {
            status: 'MANUAL_PRICING_REQUIRED',
            complete: false,
            actual: { requiresAdminConfirmation: true },
          },
        }),
      ],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).rejects.toThrow(/仍需人工核价|需要人工核价/u);
    expect(mocks.db.orderItem.update).not.toHaveBeenCalled();
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });

  it('工厂确认保留已人工确认的包装组金额', async () => {
    const group = {
      id: 'group-1',
      sequence: 1,
      name: '单款装',
      mode: OrderPackagingMode.SINGLE_STYLE,
      actualBagCount: 100,
      unitPrice: new Decimal('0.2500'),
      subtotal: new Decimal('25.00'),
      suggestedSubtotal: null,
      pricingSnapshot: adminConfirmedSnapshot({
        unitPrice: '0.2500',
        subtotal: '25.00',
      }),
      priceOverrideReason: '人工确认入袋费',
      lines: [{ orderItemId: 'item-1', unitsPerBag: 10 }],
    };
    mocks.db.orderItem.findMany.mockResolvedValueOnce([
      { subtotal: new Decimal('1000.00') },
    ]);
    mocks.db.orderCustomerCharge.aggregate.mockResolvedValueOnce({
      _sum: { amount: new Decimal('8.00') },
    });
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        manualPackagingResult(args, group.id),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...request().order,
      packagingAmount: new Decimal('25.00'),
      packagingGroups: [group],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ confirmedFee: '1033.00' });

    expect(mocks.db.orderPackagingGroup.update).not.toHaveBeenCalled();
    expect(mocks.db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ packagingAmount: '25.00' }),
      }),
    );
  });

  it('工厂确认保留已人工确认的快递费，仅刷新自动耗材费', async () => {
    const order = request().order;
    const trustedShipping = {
      ...order.customerCharges[0]!,
      amount: new Decimal('9.00'),
      overrideReason: '物流商人工报价',
      pricingSnapshot: adminConfirmedSnapshot({ amount: '9.00' }),
    };
    mocks.db.orderItem.findMany.mockResolvedValueOnce([
      { subtotal: new Decimal('1000.00') },
    ]);
    mocks.db.orderCustomerCharge.aggregate.mockResolvedValueOnce({
      _sum: { amount: new Decimal('14.00') },
    });
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => pendingShippingResult(args, '1'),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...order,
      customerCharges: [trustedShipping, order.customerCharges[1]!],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ confirmedFee: '1014.00' });

    expect(mocks.finalizeCharges).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        shipments: [expect.objectContaining({ shippingFee: '9.00' })],
      }),
      priceVersion.logistics.id,
      expect.any(Date),
    );
    expect(mocks.db.orderCustomerCharge.update).toHaveBeenCalledTimes(1);
    expect(mocks.db.orderCustomerCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'packing-1' } }),
    );
  });

  it('当前混合单仅为普通烫金保留人工版费，不与彩印原子套餐叠加', async () => {
    const order = request().order;
    const plateCharge = {
      id: 'plate-confirmed',
      shipmentId: null,
      businessKey: PENDING_PLATE_BUSINESS_KEY,
      priceBookId: null,
      status: OrderCustomerChargeStatus.ESTIMATED,
      amount: new Decimal('100.00'),
      pricingSnapshot: adminConfirmedSnapshot({ amount: '100.00' }),
      overrideReason: '普通烫金制版费人工确认',
      category: { code: 'PLATE_MAKING_FEE' },
    };
    mocks.db.orderItem.findMany.mockResolvedValueOnce([
      { subtotal: new Decimal('1200.00') },
      { subtotal: new Decimal('500.00') },
    ]);
    mocks.db.orderCustomerCharge.aggregate.mockResolvedValueOnce({
      _sum: { amount: new Decimal('108.00') },
    });
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, { plateApplies: true, atomicBundledPlate: true }),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...order,
      items: [
        bundledPrintItem(),
        item({
          id: 'item-2',
          sequence: 2,
          fig: 2,
          name: '普通烫金款',
          quantity: 500,
          subtotal: new Decimal('500.00'),
          shipmentLines: [{
            quantity: 500,
            shipment: { id: 'shipment-1', sequence: 1 },
          }],
        }),
      ],
      customerCharges: [...order.customerCharges, plateCharge],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ confirmedFee: '1808.00' });
    expect(
      mocks.db.orderCustomerCharge.update.mock.calls.some(
        ([call]) => call.where?.id === plateCharge.id,
      ),
    ).toBe(false);
  });

  it('当前单仅命中彩印含版费原子套餐时拒绝叠加历史独立版费', async () => {
    const order = request().order;
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, { plateApplies: false, atomicBundledPlate: true }),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...order,
      customerCharges: [
        ...order.customerCharges,
        {
          id: 'plate-old',
          shipmentId: null,
          businessKey: PENDING_PLATE_BUSINESS_KEY,
          priceBookId: null,
          status: OrderCustomerChargeStatus.ESTIMATED,
          amount: new Decimal('100.00'),
          pricingSnapshot: adminConfirmedSnapshot({ amount: '100.00' }),
          overrideReason: '历史独立版费',
          category: { code: 'PLATE_MAKING_FEE' },
        },
      ],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).rejects.toThrow(/含版费彩印烫金原子套餐.*重复收费风险/u);
    expect(mocks.db.orderItem.update).not.toHaveBeenCalled();
  });

  it('工厂确认允许可信逐款明细覆盖订单级待定版费', async () => {
    const order = request().order;
    const aggregate = {
      id: 'plate-aggregate',
      shipmentId: null,
      businessKey: PENDING_PLATE_BUSINESS_KEY,
      priceBookId: null,
      status: OrderCustomerChargeStatus.WAIVED,
      amount: new Decimal('0.00'),
      pricingSnapshot: {
        source: 'PLATE_DETAIL_BREAKDOWN_SUPERSEDES_AGGREGATE',
      },
      overrideReason: '逐款制版明细替代订单级金额',
      category: { code: 'PLATE_MAKING_FEE' },
    };
    const detail = {
      id: 'plate-detail-charge',
      shipmentId: null,
      businessKey: 'PLATE_DETAIL:plate-1',
      priceBookId: null,
      status: OrderCustomerChargeStatus.FINAL,
      amount: new Decimal('100.00'),
      pricingSnapshot: {
        source: 'ORDER_ITEM_PLATE_DETAIL',
        plateDetailId: 'plate-1',
        orderItemId: 'item-1',
        actual: { quantity: 2, unitPrice: '50.00', amount: '100.00' },
      },
      overrideReason: '管理员确认逐款制版成本',
      category: { code: 'PLATE_MAKING_FEE' },
    };
    mocks.db.orderItem.findMany.mockResolvedValueOnce([
      { subtotal: new Decimal('1000.00') },
    ]);
    mocks.db.orderCustomerCharge.aggregate.mockResolvedValueOnce({
      _sum: { amount: new Decimal('108.00') },
    });
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...order,
      customerCharges: [...order.customerCharges, aggregate, detail],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ confirmedFee: '1108.00' });
    expect(
      mocks.db.orderCustomerCharge.update.mock.calls.some(
        ([call]) => call.where?.id === detail.id,
      ),
    ).toBe(false);
  });

  it('彩印烫金整款人工价与历史独立版费重叠时失败关闭', async () => {
    const order = request().order;
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => manualPrintFoilResult(args),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...order,
      items: [
        bundledPrintItem({
          pricingSnapshot: adminConfirmedSnapshot({
            unitPrice: '1.0000',
            fixedFee: '0.00',
            subtotal: '1000.00',
          }),
        }),
      ],
      customerCharges: [
        ...order.customerCharges,
        {
          id: 'plate-old',
          shipmentId: null,
          businessKey: PENDING_PLATE_BUSINESS_KEY,
          priceBookId: null,
          status: OrderCustomerChargeStatus.ESTIMATED,
          amount: new Decimal('100.00'),
          pricingSnapshot: adminConfirmedSnapshot({ amount: '100.00' }),
          overrideReason: '历史独立版费',
          category: { code: 'PLATE_MAKING_FEE' },
        },
      ],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).rejects.toThrow(/含版费彩印烫金原子套餐.*重复收费风险/u);
    expect(mocks.db.orderItem.update).not.toHaveBeenCalled();
  });

  it('工厂确认仍拒绝未经管理员锁定的历史人工报价款式', async () => {
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...request().order,
      items: [
        item({
          pricingRoute: OrderItemPricingRoute.MANUAL_QUOTE,
          pricingSnapshot: { source: 'LEGACY_MANUAL_QUOTE' },
        }),
      ],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).rejects.toThrow(/历史人工报价路线/u);

    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(mocks.db.orderItem.update).not.toHaveBeenCalled();
  });
});

describe('previewFactoryConfirmationPriceDiff', () => {
  it('价差预览与确认使用同一套人工快照保留规则', async () => {
    const order = request().order;
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => manualItemResult(args),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...order,
      items: [
        plainPrintItem({
          pricingSnapshot: adminConfirmedSnapshot({
            unitPrice: '1.0000',
            fixedFee: '0.00',
            subtotal: '1000.00',
          }),
        }),
      ],
      customerCharges: order.customerCharges.map((charge) => ({
        ...charge,
        pricingSnapshot: adminConfirmedSnapshot({
          amount: charge.amount?.toFixed(2),
        }),
      })),
      quotedPricingRevision: null,
    });

    await expect(
      previewFactoryConfirmationPriceDiff(
        'order-1',
        admin,
        new Date('2026-09-02T02:00:00.000Z'),
      ),
    ).resolves.toMatchObject({
      quoted: { amount: '1008.00' },
      current: { amount: '1008.00' },
    });
    expect(mocks.db.orderItem.update).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.update).not.toHaveBeenCalled();
  });
});

describe('cancellation settlement reference', () => {
  it('按最大余数法稳定分摊整单已产数量', () => {
    expect(
      allocateCancellationProducedQuantity(
        [
          { id: 'item-1', sequence: 1, quantity: 600 },
          { id: 'item-2', sequence: 2, quantity: 400 },
        ],
        501,
      ),
    ).toEqual([
      { orderItemId: 'item-1', producedQty: 301 },
      { orderItemId: 'item-2', producedQty: 200 },
    ]);
  });

  it('保留机烫固定费、按已产总量跨纸箱档且始终排除运费', () => {
    const calculateAt = (quantity: number) =>
      realEngineResult({
        now: new Date('2026-09-02T02:00:00.000Z'),
        includeOrderCharges: true,
        facts: {
          isSfCollect: false,
          items: [{ itemKey: 'item-1', quantity }],
          packagingGroups: [
            {
              groupKey: 'bag-1',
              mode: OrderPackagingMode.SINGLE_STYLE,
              items: [{ itemKey: 'item-1', unitsPerBag: 10 }],
            },
          ],
          shipments: [
            {
              shipmentKey: 'primary',
              province: '广东',
              trustedFulfilmentWeightKg: null,
              itemQuantities: { 'item-1': quantity },
            },
          ],
        },
      });

    const at500 = cancellationReferenceFromCalculation({
      calculation: calculateAt(500),
      preservedManualCharges: '0',
      allocation: [{ orderItemId: 'item-1', producedQty: 500 }],
    });
    const at501 = cancellationReferenceFromCalculation({
      calculation: calculateAt(501),
      preservedManualCharges: '0',
      allocation: [{ orderItemId: 'item-1', producedQty: 501 }],
    });

    expect(at500).toMatchObject({
      referenceSettleFee: '111.00',
      components: {
        itemProcessing: '105.00',
        bagging: '5.00',
        carton: '1.00',
        preservedManualCharges: '0.00',
        shipping: '0.00',
      },
    });
    expect(at501).toMatchObject({
      referenceSettleFee: '113.23',
      components: {
        itemProcessing: '105.13',
        bagging: '5.10',
        carton: '3.00',
        preservedManualCharges: '0.00',
        shipping: '0.00',
      },
    });
  });

  it('管理员调整最终结算价时要求原因并审计参考价、最终价与差额', async () => {
    const value = request({
      type: OrderChangeRequestType.CANCEL,
      proposedChanges: { items: [] },
      order: {
        ...request().order,
        status: OrderStatus.RELEASED,
        workOrderVersion: 2,
        settledFee: null,
        productionWorkOrderProgress: [
          {
            workOrderVersion: 1,
            stage: 'FOILING',
            workOrderProgressQuantity: new Decimal(900),
          },
          {
            workOrderVersion: 2,
            stage: 'FOILING',
            workOrderProgressQuantity: new Decimal(500),
          },
        ],
        productionProgressSteps: [],
        outsourceOrders: [],
      },
    });
    locateCancellation(value);

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: '客户确认取消',
          producedQty: 500,
          settleFee: '510.00',
          settleFeeAdjustmentReason: '已发生额外制版损耗',
        },
        admin,
      ),
    ).resolves.toEqual({ id: 'request-1' });

    expect(mocks.db.$executeRaw).toHaveBeenCalledTimes(2);
    expect(
      (mocks.db.$executeRaw.mock.calls[0]?.[0] as TemplateStringsArray).join(
        '?',
      ),
    ).toContain('pg_advisory_xact_lock_shared');
    expect(mocks.db.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        status: OrderStatus.CANCELLED,
        settledFee: '510.00',
        settledAt: new Date('2026-09-02T02:00:00.000Z'),
        settlementContractVersion: 2,
      }),
      select: { id: true },
    });
    expect(mocks.db.backgroundJob.updateMany).toHaveBeenCalledWith({
      where: {
        dedupeKey: 'notification:ORDER_COMPLETED:order-1:v2',
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
        finishedAt: new Date('2026-09-02T02:00:00.000Z'),
        lockedBy: null,
        lockedAt: null,
        heartbeatAt: null,
        lastErrorCode: 'OrderCancelledBeforeCompletionNotification',
      },
    });
    expect(mocks.db.notificationLog.updateMany).toHaveBeenCalledWith({
      where: {
        deliveryKey: 'notification:ORDER_COMPLETED:order-1:v2',
        status: 'RETRYING',
      },
      data: {
        status: 'FAILED',
        errorMessage: 'notification superseded before webhook send',
        sentAt: null,
        deliveryAttemptId: null,
        deliveryJobAttempt: null,
        deliveryStateVersion: { increment: 1 },
        lastAttemptAt: new Date('2026-09-02T02:00:00.000Z'),
      },
    });
    expect(mocks.db.orderChangeRequest.update).toHaveBeenCalledWith({
      where: { id: value.id },
      data: expect.objectContaining({
        status: OrderChangeRequestStatus.APPROVED,
        workOrderVersionAfter: 2,
      }),
    });
    expect(mocks.db.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CHANGE_REQUEST_CANCEL_APPROVED',
        remark: '已发生额外制版损耗',
        changedFields: expect.objectContaining({
          referenceSettleFee: { before: null, after: '505.00' },
          settledFee: { before: null, after: '510.00' },
          settlementDelta: { before: null, after: '5.00' },
          settlementAdjustmentReason: {
            before: null,
            after: '已发生额外制版损耗',
          },
          calculationComponents: {
            before: null,
            after: expect.objectContaining({
              itemProcessing: '500.00',
              carton: '5.00',
              shipping: '0.00',
            }),
          },
        }),
      }),
    });
  });

  it('最终结算价偏离参考价但未留调整原因时失败关闭', async () => {
    const value = request({
      type: OrderChangeRequestType.CANCEL,
      proposedChanges: { items: [] },
      order: {
        ...request().order,
        status: OrderStatus.RELEASED,
        workOrderVersion: 2,
        settledFee: null,
        productionWorkOrderProgress: [],
        productionProgressSteps: [],
        outsourceOrders: [],
      },
    });
    locateCancellation(value);

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          producedQty: 500,
          settleFee: '510.00',
        },
        admin,
      ),
    ).rejects.toThrow(/调整参考结算金额必须填写原因/);
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });
});

describe('reviewOrderChangeRequest', () => {
  it('persists DENIED with a mandatory reason and writes the rejection audit', async () => {
    const value = request();
    locate(value);

    await reviewOrderChangeRequest(
      {
        requestId: value.id,
        decision: 'DENY',
        reviewRemark: '客户说明不完整',
      },
      admin,
    );

    expect(mocks.db.orderChangeRequest.update).toHaveBeenCalledWith({
      where: { id: value.id },
      data: expect.objectContaining({
        status: OrderChangeRequestStatus.DENIED,
        denyReason: '客户说明不完整',
        reviewedById: admin.id,
      }),
    });
    expect(mocks.db.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CHANGE_REQUEST_DENIED',
        changedFields: expect.objectContaining({
          requestId: value.id,
          requestType: OrderChangeRequestType.MODIFY,
          status: {
            before: OrderChangeRequestStatus.PENDING,
            after: OrderChangeRequestStatus.DENIED,
          },
        }),
        remark: '客户说明不完整',
      }),
    });
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });

  it('已确认的 MODIFY 保留 quoted 快照并锁定新 confirmedFee/双价表/纸质版本', async () => {
    const quotedFee = new Decimal('1008.00');
    const value = request({
      order: {
        ...request().order,
        status: OrderStatus.CONFIRMED,
        workOrderVersion: 2,
        scheduledAt: new Date('2026-09-01T01:00:00.000Z'),
        quotedFee,
        confirmedFee: new Decimal('1008.00'),
        settledFee: null,
      },
    });
    locate(value);
    mocks.db.orderItemPlateDetail.findMany.mockResolvedValueOnce([
      { id: 'already-consumed-plate', amount: new Decimal('100.00') },
    ]);

    await reviewOrderChangeRequest(
      { requestId: value.id, decision: 'APPROVE', reviewRemark: '确认改量' },
      admin,
    );

    expect(mocks.appendRevision).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        status: 'ADMIN_CONFIRMED',
        source: 'CHANGE_REQUEST_APPROVED_CURRENT_PUBLISHED',
        orderFeeSnapshot: {
          quotedFee,
          confirmedFee: '1208.00',
          settledFee: null,
        },
        metadata: expect.objectContaining({
          workOrderVersion: 3,
          confirmedFee: '1208.00',
          quotedFeeCompleteness:
            OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
          pureQuote: expect.objectContaining({
            status: 'PARTIAL',
            pendingLineCodes: ['PLATE_FEE'],
          }),
        }),
      }),
    );
    expect(mocks.db.orderPriceVersionLock.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          purpose: 'PROCESSING',
          priceBookId: priceVersion.processing.id,
        }),
        expect.objectContaining({
          purpose: 'LOGISTICS',
          priceBookId: priceVersion.logistics.id,
        }),
      ],
    });
    expect(mocks.db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workOrderVersion: 3,
          scheduledAt: new Date('2026-09-02T02:00:00.000Z'),
          completedAt: null,
        }),
      }),
    );
    expect(mocks.db.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { confirmedFee: '1208.00', settledFee: null },
    });
    expect(mocks.db.orderChangeRequest.update).toHaveBeenCalledWith({
      where: { id: value.id },
      data: expect.objectContaining({
        status: OrderChangeRequestStatus.APPROVED,
        workOrderVersionAfter: 3,
      }),
    });
    expect(
      mocks.db.order.update.mock.calls.some(
        ([call]) => call.data?.quotedFee !== undefined,
      ),
    ).toBe(false);
    expect(mocks.createPrint).not.toHaveBeenCalled();
    expect(mocks.db.orderItemPlateDetail.findMany).not.toHaveBeenCalled();
    expect(mocks.db.orderItemPlateDetail.update).not.toHaveBeenCalled();
    expect(mocks.db.customerChargeCategory.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.upsert).not.toHaveBeenCalled();
  });

  it('生产版本的含版费原子套餐与旧独立版费重叠时拒绝批准', async () => {
    const value = request({
      order: {
        ...request().order,
        status: OrderStatus.CONFIRMED,
        customerCharges: [
          ...request().order.customerCharges,
          {
            id: 'plate-final',
            shipmentId: null,
            businessKey: PENDING_PLATE_BUSINESS_KEY,
            priceBookId: null,
            amount: new Decimal('100.00'),
            overrideReason: '已发生制版费',
            category: { code: 'PLATE_MAKING_FEE' },
          },
        ],
      },
    });
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, { plateApplies: false, atomicBundledPlate: true }),
    );

    await expect(
      reviewOrderChangeRequest(
        { requestId: value.id, decision: 'APPROVE', reviewRemark: null },
        admin,
      ),
    ).rejects.toThrow(/含版费彩印烫金原子套餐.*重复收费风险/u);
    expect(mocks.db.order.update).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.update).not.toHaveBeenCalled();
  });

  it('生产版本变更普通烫金事实时拒绝批准，不沿用历史版费', async () => {
    const value = request({
      proposedChanges: {
        items: [{
          operation: 'UPDATE',
          itemId: 'item-1',
          frontFoilColors: ['亮金'],
          backFoilColors: [],
        }],
      },
      order: { ...request().order, status: OrderStatus.CONFIRMED },
    });
    locate(value);

    await expect(
      reviewOrderChangeRequest(
        { requestId: value.id, decision: 'APPROVE', reviewRemark: null },
        admin,
      ),
    ).rejects.toThrow(
      /生产版本新增、移除或变更.*不能自动替换或重新计价/u,
    );
    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(mocks.db.order.update).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.update).not.toHaveBeenCalled();
  });

  it('已下发 MODIFY 在同一事务升版、记录旧打印作废证据并创建 REPRINT', async () => {
    const value = request({
      order: {
        ...request().order,
        status: OrderStatus.RELEASED,
        workOrderVersion: 4,
        scheduledAt: new Date('2026-08-31T03:00:00.000Z'),
        completedAt: new Date('2026-09-01T08:00:00.000Z'),
        settledFee: null,
        productionOperations: [
          { id: 'operation-v4', reports: [{ id: 'report-v4' }] },
        ],
      },
    });
    locate(value);
    mocks.supersedePrint.mockResolvedValueOnce({
      requestJobIds: ['old-print-v4'],
    });

    await reviewOrderChangeRequest(
      { requestId: value.id, decision: 'APPROVE', reviewRemark: null },
      admin,
    );

    expect(mocks.createPrint).toHaveBeenCalledWith(
      mocks.db,
      {
        orderId: 'order-1',
        workOrderVersion: 5,
        printKind: 'REPRINT',
        reason: '修改申请批准，旧版纸质工单作废',
        idempotencyKey: 'change:request-1:reprint:v5',
      },
      admin,
    );
    expect(mocks.supersedePrint).toHaveBeenCalledWith(
      mocks.db,
      {
        orderId: 'order-1',
        currentWorkOrderVersion: 5,
        reasonKey: 'change:request-1:supersede',
      },
      admin,
    );
    expect(mocks.activateProduction).toHaveBeenCalledWith(
      mocks.db,
      'order-1',
      admin,
      new Date('2026-09-02T02:00:00.000Z'),
      {
        targetStatus: OrderStatus.RELEASED,
        allowVersionRematerialization: true,
      },
    );
    expect(mocks.db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workOrderVersion: 5,
          completedAt: null,
        }),
      }),
    );
    expect(mocks.db.backgroundJob.updateMany).toHaveBeenCalledWith({
      where: {
        dedupeKey: 'notification:ORDER_COMPLETED:order-1:v4',
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
        finishedAt: new Date('2026-09-02T02:00:00.000Z'),
        lockedBy: null,
        lockedAt: null,
        heartbeatAt: null,
        lastErrorCode: 'SupersededWorkOrderVersion',
      },
    });
    expect(mocks.db.notificationLog.updateMany).toHaveBeenCalledWith({
      where: {
        deliveryKey: 'notification:ORDER_COMPLETED:order-1:v4',
        status: 'RETRYING',
      },
      data: {
        status: 'FAILED',
        errorMessage: 'notification superseded before webhook send',
        sentAt: null,
        deliveryAttemptId: null,
        deliveryJobAttempt: null,
        deliveryStateVersion: { increment: 1 },
        lastAttemptAt: new Date('2026-09-02T02:00:00.000Z'),
      },
    });
    expect(mocks.db.orderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changedFields: expect.objectContaining({
            workOrderVersion: { before: 4, after: 5 },
            scheduledAt: {
              before: '2026-08-31T03:00:00.000Z',
              after: '2026-09-02T02:00:00.000Z',
            },
            supersededPrintJobs: expect.objectContaining({
              before: ['old-print-v4'],
              after: [],
            }),
            reprintJob: { before: null, after: 'reprint-v3' },
          }),
        }),
      }),
    );
  });

  it('revision 变化时标记 STALE，不调引擎', async () => {
    const value = request({ baseRevision: 1, order: { ...request().order, revision: 2 } });
    locate(value);
    await reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null }, admin);
    expect(mocks.db.orderChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: OrderChangeRequestStatus.STALE }),
    }));
    expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it('纸质工单版本变化时标记 STALE，不更新工单或重打', async () => {
    const value = request({
      baseWorkOrderVersion: 2,
      order: { ...request().order, workOrderVersion: 3 },
    });
    locate(value);

    await reviewOrderChangeRequest(
      { requestId: value.id, decision: 'APPROVE', reviewRemark: null },
      admin,
    );

    expect(mocks.db.orderChangeRequest.update).toHaveBeenCalledWith({
      where: { id: value.id },
      data: expect.objectContaining({
        status: OrderChangeRequestStatus.STALE,
        reviewRemark: expect.stringMatching(/纸质工单版本 2 → 3/u),
      }),
    });
    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(mocks.db.order.update).not.toHaveBeenCalled();
    expect(mocks.createPrint).not.toHaveBeenCalled();
    expect(mocks.supersedePrint).not.toHaveBeenCalled();
  });

  it('工单自然完工但双版本未变化时标记 STALE，不更新工单或重打', async () => {
    const value = request({
      baseRevision: 2,
      baseWorkOrderVersion: 1,
      order: {
        ...request().order,
        status: OrderStatus.COMPLETED,
        revision: 2,
        workOrderVersion: 1,
      },
    });
    locate(value);

    await reviewOrderChangeRequest(
      { requestId: value.id, decision: 'APPROVE', reviewRemark: null },
      admin,
    );

    expect(mocks.db.orderChangeRequest.update).toHaveBeenCalledWith({
      where: { id: value.id },
      data: expect.objectContaining({
        status: OrderChangeRequestStatus.STALE,
        reviewedById: admin.id,
        reviewRemark: expect.stringMatching(/不再允许修改.*自动失效/u),
      }),
    });
    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(mocks.db.order.update).not.toHaveBeenCalled();
    expect(mocks.createPrint).not.toHaveBeenCalled();
    expect(mocks.supersedePrint).not.toHaveBeenCalled();
  });

  it('历史 no-op 申请安全标记 STALE，不升版或重打', async () => {
    const value = request({
      proposedChanges: {
        items: [
          { operation: 'UPDATE', itemId: 'item-1', quantity: 1_000 },
        ],
      },
    });
    locate(value);

    await reviewOrderChangeRequest(
      { requestId: value.id, decision: 'APPROVE', reviewRemark: null },
      admin,
    );

    expect(mocks.db.orderChangeRequest.update).toHaveBeenCalledWith({
      where: { id: value.id },
      data: expect.objectContaining({
        status: OrderChangeRequestStatus.STALE,
        reviewRemark: expect.stringMatching(/没有可应用的实际变化/u),
      }),
    });
    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(mocks.db.orderItem.update).not.toHaveBeenCalled();
    expect(mocks.db.order.update).not.toHaveBeenCalled();
    expect(mocks.appendRevision).not.toHaveBeenCalled();
    expect(mocks.createPrint).not.toHaveBeenCalled();
    expect(mocks.supersedePrint).not.toHaveBeenCalled();
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

  it('真实纯引擎仅剩制版费待定时仍可批准外部销售改单', async () => {
    const value = request({
      order: {
        ...request().order,
        packagingGroups: [
          {
            id: 'group-real-engine',
            sequence: 1,
            name: '单款入袋',
            mode: OrderPackagingMode.SINGLE_STYLE,
            actualBagCount: 100,
            unitPrice: new Decimal('0.1'),
            subtotal: new Decimal(10),
            suggestedSubtotal: new Decimal(10),
            pricingSnapshot: { engineVersion: 'OLD' },
            priceOverrideReason: null,
            lines: [{ orderItemId: 'item-1', unitsPerBag: 10 }],
          },
        ],
      },
    });
    locate(value);
    const state: {
      calculation: ReturnType<typeof realEngineResult> | null;
    } = { calculation: null };
    mocks.calculate.mockImplementationOnce(async (_tx, args: ServiceArgs) => {
      state.calculation = realEngineResult(args);
      return state.calculation;
    });
    mocks.db.orderItem.findMany.mockImplementationOnce(async () => {
      if (!state.calculation) throw new Error('预期先完成纯引擎计算');
      return state.calculation.quote.items.map((quotedItem) => {
        if (!quotedItem.amount) throw new Error('黄金款式应有完整金额');
        return { subtotal: new Decimal(quotedItem.amount) };
      });
    });
    mocks.finalizeCharges.mockImplementationOnce(async () => {
      if (!state.calculation) throw new Error('预期先完成纯引擎计算');
      const shipping = state.calculation.quote.order.lines.find((line) =>
        line.code.startsWith('SHIPPING:'),
      );
      const carton = state.calculation.quote.order.lines.find(
        (line) => line.code === 'CARTON',
      );
      if (!shipping?.amount || !carton?.amount) {
        throw new Error('黄金价目应生成完整物流已知项');
      }
      const charges = [
        {
          shipmentKey: shipping.code.slice('SHIPPING:'.length),
          categoryCode: 'SHIPPING_FEE',
          categoryId: 'shipping-category',
          priceBookId: CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion.logistics.id,
          sourceRuleId: 'shipping-rule',
          businessKey: 'SHIPMENT:1:SHIPPING_FEE',
          status: 'ESTIMATED',
          description: '快递费',
          quantity: '1',
          unit: 'kg',
          suggestedAmount: shipping.amount,
          amount: shipping.amount,
          pricingSnapshot: {},
          overrideReason: null,
        },
        {
          shipmentKey: shipping.code.slice('SHIPPING:'.length),
          categoryCode: 'PACKING_MATERIAL',
          categoryId: 'packing-category',
          priceBookId: CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion.logistics.id,
          sourceRuleId: 'packing-rule',
          businessKey: 'SHIPMENT:1:PACKING_MATERIAL',
          status: 'ESTIMATED',
          description: '纸箱耗材',
          quantity: '1200',
          unit: '个',
          suggestedAmount: carton.amount,
          amount: carton.amount,
          pricingSnapshot: {},
          overrideReason: null,
        },
      ];
      return {
        priceBook: {
          ...CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion.logistics,
          name: '物流价目簿',
          sourceName: 'golden',
          policy: {},
        },
        charges,
        totalAmount: state.calculation.quote.order.knownAmount,
        requiresAdminConfirmation: false,
      };
    });

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
        },
        admin,
      ),
    ).resolves.toEqual({ id: 'request-1' });

    expect(state.calculation?.quote.order).toMatchObject({
      amount: null,
      lines: expect.arrayContaining([
        expect.objectContaining({
          code: 'PLATE_FEE',
          status: 'PENDING_AMOUNT',
          amount: null,
        }),
      ]),
    });
    expect(mocks.appendRevision).toHaveBeenCalledTimes(1);
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
      .rejects.toThrow(/物流分项与纯引擎输出不一致/);
    expect(mocks.appendRevision).not.toHaveBeenCalled();
  });

  it.each([
    OrderSettlementType.INTERNAL_SALES,
    OrderSettlementType.FACTORY_DIRECT,
  ])('%s 改单关闭对客物流层，但同步制版 pending 与价格修订', async (settlementType) => {
    const value = request({ order: {
      ...request().order,
      settlementType,
      billingMode: OrderBillingMode.CHARGE,
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
    expect(mocks.db.customerChargeCategory.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.db.orderCustomerCharge.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.appendRevision).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        status: 'PENDING_ADMIN_CONFIRMATION',
        source: 'CHANGE_REQUEST_APPLIED_PENDING',
      }),
    );
    expect(mocks.appendRevision.mock.calls[0]?.[1]).not.toHaveProperty(
      'orderFeeSnapshot',
    );
    expect(mocks.db.orderPriceVersionLock.createMany).toHaveBeenCalledTimes(1);
  });

  it('外部销售纯彩印无烫金改单不查制版类目，并自动确认完整报价', async () => {
    const value = request({
      order: {
        ...request().order,
        pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
        confirmedFee: null,
        settledFee: null,
        items: [plainPrintItem()],
      },
    });
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, { plateApplies: false }),
    );

    await reviewOrderChangeRequest(
      { requestId: value.id, decision: 'APPROVE', reviewRemark: null },
      admin,
    );

    expect(mocks.db.orderItemPlateDetail.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.orderCustomerCharge.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.db.customerChargeCategory.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.upsert).not.toHaveBeenCalled();
    expect(mocks.appendRevision).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        status: 'AUTO_CONFIRMED',
        source: 'CHANGE_REQUEST_APPLIED_AUTO_CONFIRMED',
        orderFeeSnapshot: {
          quotedFee: '1208.00',
          confirmedFee: null,
          settledFee: null,
        },
        metadata: expect.objectContaining({
          quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
          pureQuote: expect.objectContaining({
            status: 'QUOTED',
            pendingLineCodes: [],
          }),
        }),
      }),
    );
    expect(mocks.db.order.update).toHaveBeenLastCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        quotedFee: '1208.00',
        quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
        confirmedFee: null,
      }),
    });
    expect(mocks.db.orderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'CHANGE_REQUEST_APPROVED',
          changedFields: expect.objectContaining({
            pricingStatus: {
              before: 'PENDING_ADMIN_CONFIRMATION',
              after: 'AUTO_CONFIRMED',
            },
          }),
        }),
      }),
    );
  });

  it('非生产态彩印含版费原子套餐改单可直接批准为 AUTO，不查独立制版类目', async () => {
    const value = request({
      order: {
        ...request().order,
        pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
        confirmedFee: null,
        settledFee: null,
        items: [bundledPrintItem()],
      },
    });
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, { plateApplies: false, atomicBundledPlate: true }),
    );
    mocks.db.orderItem.findMany.mockResolvedValueOnce([
      { subtotal: new Decimal('1400.00') },
    ]);

    await reviewOrderChangeRequest(
      { requestId: value.id, decision: 'APPROVE', reviewRemark: null },
      admin,
    );

    expect(mocks.db.customerChargeCategory.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.upsert).not.toHaveBeenCalled();
    expect(mocks.appendRevision).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        status: 'AUTO_CONFIRMED',
        source: 'CHANGE_REQUEST_APPLIED_AUTO_CONFIRMED',
        metadata: expect.objectContaining({
          quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
          pureQuote: expect.objectContaining({
            status: 'QUOTED',
            pendingLineCodes: [],
          }),
        }),
      }),
    );
  });

  it('无烫金改单将历史 aggregate 审计豁免，不删除也不改写旧快照', async () => {
    const previousSnapshot = {
      source: 'ADMIN_CONFIRMED_PLATE',
      actual: { amount: '100.00' },
    };
    const existingPlate = {
      id: 'plate-existing',
      status: OrderCustomerChargeStatus.FINAL,
      amount: new Decimal('100.00'),
      pricingSnapshot: previousSnapshot,
    };
    const value = request({
      order: {
        ...request().order,
        totalAmount: new Decimal('1108.00'),
        items: [plainPrintItem()],
        customerCharges: [
          ...request().order.customerCharges,
          {
            ...existingPlate,
            shipmentId: null,
            businessKey: PENDING_PLATE_BUSINESS_KEY,
            priceBookId: null,
            overrideReason: '历史人工确认',
            category: { code: 'PLATE_MAKING_FEE' },
          },
        ],
      },
    });
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, { plateApplies: false }),
    );
    mocks.db.orderCustomerCharge.findUnique.mockResolvedValueOnce(existingPlate);

    await reviewOrderChangeRequest(
      { requestId: value.id, decision: 'APPROVE', reviewRemark: null },
      admin,
    );

    expect(mocks.db.orderCustomerCharge.update).toHaveBeenCalledWith({
      where: { id: 'plate-existing' },
      data: expect.objectContaining({
        status: OrderCustomerChargeStatus.WAIVED,
        amount: '0.00',
        finalizedById: admin.id,
        finalizedAt: expect.any(Date),
        pricingSnapshot: expect.objectContaining({
          source: 'CHANGE_REQUEST_PLATE_NOT_APPLICABLE',
          previousStatus: OrderCustomerChargeStatus.FINAL,
          previousAmount: '100',
          previousSnapshot,
        }),
      }),
      select: { id: true },
    });
    expect(mocks.db.customerChargeCategory.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.upsert).not.toHaveBeenCalled();
  });

  it('历史生产中工单的价格事实修改失败关闭，不重写已发生制版费', async () => {
    const value = request({
      order: {
        ...request().order,
        status: OrderStatus.IN_PRODUCTION,
      },
    });
    locate(value);

    await expect(
      reviewOrderChangeRequest(
        { requestId: value.id, decision: 'APPROVE', reviewRemark: null },
        admin,
      ),
    ).rejects.toThrow(/历史“生产中”.*请新建工单/u);
    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(mocks.db.orderItemPlateDetail.findMany).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.upsert).not.toHaveBeenCalled();
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

  it('历史生产中工单仅改名仍允许，不调引擎或改写制版费', async () => {
    const value = request({
      order: {
        ...request().order,
        status: OrderStatus.IN_PRODUCTION,
      },
      proposedChanges: { items: [{ operation: 'UPDATE', itemId: 'item-1', name: '新名' }] },
    });
    locate(value);
    mocks.db.orderItem.findMany.mockResolvedValue([{ subtotal: new Decimal(1000) }]);
    await reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null }, admin);
    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(mocks.appendRevision).not.toHaveBeenCalled();
    expect(mocks.db.orderItemPlateDetail.findMany).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.upsert).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.update).not.toHaveBeenCalled();
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
