vi.mock('@/lib/order/production-readiness', () => ({ prepareOrderForProductionInTx: vi.fn().mockResolvedValue({ ready: true, status: 'CONFIRMED', issues: [] }) }));
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
  OrderItemQuoteDisposition,
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
import {
  buildTrustedAdminChargePricingSnapshot,
  buildTrustedAdminItemPricingSnapshot,
  buildTrustedAdminPackagingPricingSnapshot,
} from '../admin-pricing-snapshot';
import {
  createOrderChangeApprovalToken,
  type OrderChangeApprovalResolutionEvidence,
} from '../order-change-approval-token';
import { createOrderChangeRequestSchema } from '../../auth/schemas';
import { PENDING_PLATE_BUSINESS_KEY } from '../pending-plate-charge';

const mocks = vi.hoisted(() => {
  const db = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    backgroundJob: { updateMany: vi.fn() },
    notificationLog: { updateMany: vi.fn() },
    order: { findUnique: vi.fn(), update: vi.fn() },
    orderWorkflowDecision: { findFirst: vi.fn() },
    product: { findMany: vi.fn() },
    material: { findMany: vi.fn() },
    orderItem: { update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    orderItemPlateDetail: { findMany: vi.fn(), update: vi.fn() },
    orderPackagingGroup: { update: vi.fn() },
    orderPackagingGroupLine: { updateMany: vi.fn() },
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
  };
  return {
    db,
    completion: vi.fn().mockResolvedValue({ completed: false }),
    completionDispatch: vi.fn(),
    calculate: vi.fn(),
    admit: vi.fn(),
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
vi.mock('@/lib/order/blank-price-admission', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/order/blank-price-admission')>(),
  assertBlankPriceAdmissionInTx: mocks.admit,
}));
import { BlankPriceAdmissionError } from '../blank-price-admission';
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
vi.mock('@/lib/production/operation-materialization-service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/production/operation-materialization-service')>(),
  activateProductionOperationsInTx: mocks.activateProduction,
}));
vi.mock('@/lib/production-completion', () => ({
  maybeCompleteProductionOrder: mocks.completion,
  dispatchProductionCompletionNotification: mocks.completionDispatch,
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
  previewOrderCancellationSettlement,
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
const pureQuoteToken = `create-order-quote-v2:${'c'.repeat(64)}`;
const changedPureQuoteToken = `create-order-quote-v2:${'d'.repeat(64)}`;

function approvalQuoteToken(
  pendingChargeResolutions: readonly OrderChangeApprovalResolutionEvidence[] = [],
  overrides: Partial<{
    requestId: string;
    baseRevision: number;
    priceRevision: number;
    pureQuoteToken: string;
  }> = {},
): string {
  return createOrderChangeApprovalToken({
    requestId: overrides.requestId ?? 'request-1',
    baseRevision: overrides.baseRevision ?? 2,
    priceRevision: overrides.priceRevision ?? 5,
    pureQuoteToken: overrides.pureQuoteToken ?? pureQuoteToken,
    pendingChargeResolutions,
  });
}

const quoteToken = approvalQuoteToken();

type ServiceArgs = {
  now: Date;
  includeOrderCharges: boolean;
  facts: {
    isSfCollect: boolean;
    items: Array<{
      itemKey: string;
      productId?: string | null;
      pricingRoute?: OrderItemPricingRoute;
      productStructure?: OrderProductStructure;
      pricingGroup?: string | null;
      specification?: string | null;
      actualWidthMm?: Decimal | number | null;
      actualHeightMm?: Decimal | number | null;
      quantity: number;
    }>;
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
  options: {
    plateApplies?: boolean;
    atomicBundledPlate?: boolean;
    quoteToken?: string;
  } = {},
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
    quoteToken: options.quoteToken ?? pureQuoteToken,
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
  const pendingAmount = base.quote.order.lines.find(
    (line) => line.code === `SHIPPING:${shipmentKey}`,
  )?.amount;
  if (pendingAmount === null || pendingAmount === undefined) {
    throw new Error('测试缺少待定快递费');
  }
  const knownOrderAmount = new Decimal(base.quote.order.knownAmount)
    .minus(pendingAmount)
    .toFixed(2);
  const knownTotal = new Decimal(base.quote.knownTotal)
    .minus(pendingAmount)
    .toFixed(2);
  return {
    ...base,
    quote: {
      ...base.quote,
      status: 'PARTIAL' as const,
      total: null,
      knownTotal,
      order: {
        ...base.quote.order,
        amount: null,
        knownAmount: knownOrderAmount,
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
    quoteToken: pureQuoteToken,
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

  it('真实纯引擎默认零版费时允许完整自动计价', () => {
    const input = createGoldenOrderInput([
      createGoldenOrderItem({ quantity: 1_200 }),
    ]);
    const quote = calculateCreateOrderQuote(
      input,
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    const processing = presentCreateOrderProcessingQuote({ input, quote });

    expect(quote).toMatchObject({
      status: 'QUOTED',
      total: quote.knownTotal,
      pendingLineCodes: [],
      pendingReasons: [],
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
      expect.arrayContaining(['SHIPPING:primary']),
    );
    expect(
      isChangeRequestQuoteAutomaticallyApplicable({ quote, processing }),
    ).toBe(false);
  });
});

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1', orderId: 'order-1', sequence: 1, fig: 1, name: '红包 A', productId: 'product-1',
    pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL as OrderItemPricingRoute,
    craft: null,
    productStructure: OrderProductStructure.STANDARD_ENVELOPE,
    artworkVersion: null, plateGroupId: null, pricingGroup: 'MID', manualQuoteReason: null,
    quantity: 1_000, pack: null, specification: '中号封',
    actualWidthMm: new Decimal(80), actualHeightMm: new Decimal(115),
    paperType: '珠光艳闪', paperWeightGsm: 160, crafts: ['craft-1'],
    frontFoilColors: ['哑金'], backFoilColors: [], foilColors: ['哑金'],
    foilTechnique: OrderFoilTechnique.FLAT, hasLocalFoil: false,
    lamination: OrderLamination.NONE, printColors: [], printColorsKnown: true,
    isDoubleSided: false, isDoubleColor: false,
    unitPrice: new Decimal('1'), fixedFee: new Decimal(0), subtotal: new Decimal(1000),
    suggestedSubtotal: new Decimal(1000), pricingSnapshot: { engineVersion: 'OLD' },
    priceOverrideReason: null, quoteDisposition: OrderItemQuoteDisposition.PRICED, remark: null,
    tasks: [{ status: TaskStatus.PENDING }],
    shipmentLines: [{ quantity: 1_000, shipment: { id: 'shipment-1', sequence: 1 } }],
    ...overrides,
  };
}

function packagingGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'group-1',
    orderId: 'order-1',
    sequence: 1,
    name: '单款装',
    mode: OrderPackagingMode.SINGLE_STYLE,
    actualBagCount: 100,
    unitPrice: new Decimal('0.1000'),
    subtotal: new Decimal('10.00'),
    pricingSnapshot: {},
    priceOverrideReason: null,
    lines: [{ orderItemId: 'item-1', unitsPerBag: 10 }],
    ...overrides,
  };
}

function catalogProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-large',
    code: 'custom-large',
    name: '专版局部烫金大号封',
    category: 'CUSTOM_FLAT_FOIL',
    specification: '大号封90×165',
    paperType: null,
    paperMaterialId: null,
    weight: null,
    categoryNode: {
      path: 'product.custom_flat_foil',
      legacyCategory: 'CUSTOM_FLAT_FOIL',
    },
    ...overrides,
  };
}

function specificationChange() {
  return {
    operation: 'UPDATE' as const,
    itemId: 'item-1',
    targetProductId: 'product-large',
    specification: '大号封90×165',
  };
}

const EMPTY_CHARGE_BASIS = {
  sourceRuleId: null,
  quantity: null,
  unit: null,
  unitPrice: null,
  suggestedAmount: null,
  isAdjustment: false,
  approvalReference: null,
} as const;

function adminConfirmedSnapshot(
  actual: Record<string, unknown> = {},
) {
  const reason =
    typeof actual.overrideReason === 'string' && actual.overrideReason.trim()
      ? actual.overrideReason.trim()
      : null;
  return {
    source: 'ADMIN_SNAPSHOT_CONFIRMATION',
    status: 'ADMIN_CONFIRMED',
    previousPriceRevision: 5,
    actual: {
      ...actual,
      provisional: false,
      requiresAdminConfirmation: false,
      automatic: false,
    },
    confirmation: {
      actorId: 'admin-1',
      confirmedAt: '2026-09-02T02:00:00.000Z',
      reason,
    },
  };
}

function adminConfirmedItemSnapshot(
  itemFacts: Parameters<
    typeof buildTrustedAdminItemPricingSnapshot
  >[0]['item'],
) {
  return buildTrustedAdminItemPricingSnapshot({
    previous: null,
    now: new Date('2026-09-02T02:00:00.000Z'),
    actorId: admin.id,
    previousPriceRevision: 5,
    item: itemFacts,
  });
}

function adminConfirmedPackagingSnapshot(
  groupFacts: Parameters<
    typeof buildTrustedAdminPackagingPricingSnapshot
  >[0]['group'],
) {
  return buildTrustedAdminPackagingPricingSnapshot({
    previous: null,
    now: new Date('2026-09-02T02:00:00.000Z'),
    actorId: admin.id,
    previousPriceRevision: 5,
    group: groupFacts,
  });
}

function adminConfirmedChargeSnapshot(input: {
  orderId?: string;
  businessKey: string;
  shipmentId: string | null;
  categoryCode: string;
  status?: string;
  priceBookId?: string | null;
  sourceRuleId?: string | null;
  quantity?: Decimal.Value | null;
  unit?: string | null;
  unitPrice?: Decimal.Value | null;
  suggestedAmount?: Decimal.Value | null;
  amount: Decimal.Value;
  isAdjustment?: boolean;
  approvalReference?: string | null;
  overrideReason?: string | null;
}) {
  return buildTrustedAdminChargePricingSnapshot({
    previous: null,
    now: new Date('2026-09-02T02:00:00.000Z'),
    actorId: admin.id,
    previousPriceRevision: 5,
    charge: {
      orderId: input.orderId ?? 'order-1',
      businessKey: input.businessKey,
      shipmentId: input.shipmentId,
      categoryCode: input.categoryCode,
      status: input.status ?? OrderCustomerChargeStatus.ESTIMATED,
      priceBookId: input.priceBookId ?? null,
      sourceRuleId: input.sourceRuleId ?? null,
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
      unitPrice: input.unitPrice ?? null,
      suggestedAmount: input.suggestedAmount ?? null,
      amount: input.amount,
      isAdjustment: input.isAdjustment ?? false,
      approvalReference: input.approvalReference ?? null,
      overrideReason: input.overrideReason ?? null,
    },
  });
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
          id: 'shipping-1', orderId: 'order-1', shipmentId: 'shipment-1',
          ...EMPTY_CHARGE_BASIS,
          businessKey: 'SHIPMENT:1:SHIPPING_FEE', priceBookId: 'old-logistics',
          status: OrderCustomerChargeStatus.ESTIMATED,
          amount: new Decimal(3), pricingSnapshot: {}, overrideReason: null,
          category: { code: 'SHIPPING_FEE' },
        },
        {
          id: 'packing-1', orderId: 'order-1', shipmentId: 'shipment-1',
          ...EMPTY_CHARGE_BASIS,
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

function createRequestOrder(overrides: Record<string, unknown> = {}) {
  const base = request().order;
  return {
    ...base,
    orderNo: 'GD-1',
    status: OrderStatus.SUBMITTED,
    revision: 2,
    workOrderVersion: 1,
    items: [item()],
    changeRequests: [],
    packagingGroups: [],
    productionOperations: [],
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

function pendingShippingResolution(
  overrides: Partial<{
    businessKey: string;
    shipmentId: string;
    expectedSequence: number;
    expectedProjectedQuantity: number;
    expectedDestinationProvince: string | null;
    amount: string;
    reason: string;
  }> = {},
) {
  return {
    businessKey: 'SHIPMENT:1:SHIPPING_FEE',
    shipmentId: 'shipment-1',
    expectedSequence: 1,
    expectedProjectedQuantity: 1_200,
    expectedDestinationProvince: '广东',
    amount: '12.34',
    reason: '超出价表重量范围，按承运方报价',
    ...overrides,
  };
}

function expectNoApprovalMutation(): void {
  for (const mutation of [
    mocks.db.order.update,
    mocks.db.orderItem.update,
    mocks.db.orderItem.create,
    mocks.db.orderItemPlateDetail.update,
    mocks.db.orderPackagingGroup.update,
    mocks.db.orderShipmentLine.upsert,
    mocks.db.orderShipmentLine.create,
    mocks.db.orderCustomerCharge.update,
    mocks.db.orderCustomerCharge.upsert,
    mocks.db.orderPriceVersionLock.createMany,
    mocks.db.productionOperation.updateMany,
    mocks.db.productionProgressStep.updateMany,
    mocks.db.orderChangeRequest.update,
    mocks.db.orderLog.create,
    mocks.db.backgroundJob.updateMany,
    mocks.db.notificationLog.updateMany,
    mocks.appendRevision,
    mocks.createPrint,
    mocks.supersedePrint,
  ]) {
    expect(mutation).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.admit.mockResolvedValue(undefined);
  mocks.completion.mockResolvedValue({ completed: false });
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
  mocks.db.product.findMany.mockResolvedValue([]);
  mocks.db.material.findMany.mockResolvedValue([]);
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
  it('只改交期保存真实日期提案和原值，未审批前不写原单', async () => {
    mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'due-date-request' });
    const oldDate = new Date('2026-09-10T00:00:00Z');
    mocks.db.order.findUnique.mockResolvedValue(createRequestOrder({ promisedDate: oldDate }));
    const payload = createOrderChangeRequestSchema.parse({
      orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
      type: 'MODIFY', modifyKind: 'DUE_DATE', reason: '客户确认延期', items: [], promisedDate: '2026-09-12',
    });
    await createOrderChangeRequest(payload, sales);
    expect(mocks.db.orderChangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      proposedChanges: expect.objectContaining({ items: [], promisedDate: '2026-09-12' }),
      beforeSnapshot: expect.objectContaining({ promisedDate: '2026-09-10' }),
    }) }));
    expect(mocks.db.order.update).not.toHaveBeenCalled();
    expect(createOrderChangeRequestSchema.safeParse({ ...payload, promisedDate: '2026-02-30' }).success).toBe(false);
  });
  it('无实际交期变化且没有款式修改时拒绝空申请', async () => {
    mocks.db.order.findUnique.mockResolvedValue(createRequestOrder({ promisedDate: null }));
    await expect(createOrderChangeRequest({ orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
      type: 'MODIFY', modifyKind: 'DUE_DATE', reason: '没有变化', items: [], promisedDate: null }, sales)).rejects.toThrow(/实际/);
    expect(mocks.db.orderChangeRequest.create).not.toHaveBeenCalled();
  });

  it.each([OrderStatus.PENDING_FACTORY, OrderStatus.REJECTED, OrderStatus.DRAFT])(
    '管理员可为 %s 工单提交修改提案但不能直接改写款式和费用',
    async (status) => {
      mocks.db.order.findUnique.mockResolvedValue({
        ...createRequestOrder(),
        status,
      });
      mocks.db.orderChangeRequest.create.mockResolvedValue({
        id: 'admin-request',
      });
      await expect(
        createOrderChangeRequest(
          {
            orderId: 'order-1',
            expectedRevision: 2,
            expectedWorkOrderVersion: 1,
            type: 'MODIFY',
            modifyKind: 'OTHER',
            reason: '核对名称',
            items: [
              { operation: 'UPDATE', itemId: 'item-1', name: '修正款式名称' },
            ],
          },
          admin,
        ),
      ).resolves.toEqual({ id: 'admin-request' });
      expect(mocks.db.order.update).not.toHaveBeenCalled();
      expect(mocks.db.orderItem.update).not.toHaveBeenCalled();
      expect(mocks.db.orderChangeRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requesterId: admin.id,
            baseRevision: 2,
          }),
        }),
      );
    },
  );

  it('管理员的修改权限不能变成取消申请权限', async () => {
    mocks.db.order.findUnique.mockResolvedValue(createRequestOrder());
    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          expectedRevision: 2,
          expectedWorkOrderVersion: 1,
          type: 'CANCEL',
          reason: '取消',
          items: [],
        },
        admin,
      ),
    ).rejects.toThrow('当前账号无权');
    expect(mocks.db.orderChangeRequest.create).not.toHaveBeenCalled();
  });


  it('只保存提案，不改写工单或历史快照', async () => {
    mocks.db.order.findUnique.mockResolvedValue(createRequestOrder());
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

  it('提交规格变更时重新验证活动目录并仅保存目标产品与目录规格', async () => {
    mocks.db.order.findUnique.mockResolvedValue(createRequestOrder());
    mocks.db.product.findMany.mockResolvedValue([catalogProduct()]);
    mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'request-spec' });

    await expect(createOrderChangeRequest({
      orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
      reason: '改成大号封',
      items: [specificationChange()],
    }, sales)).resolves.toEqual({ id: 'request-spec' });

    expect(mocks.db.product.findMany).toHaveBeenCalledTimes(1);
    const createCall = mocks.db.orderChangeRequest.create.mock.calls[0]?.[0];
    expect(createCall).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        proposedChanges: {
          items: [expect.objectContaining({
            operation: 'UPDATE',
            itemId: 'item-1',
            targetProductId: 'product-large',
            specification: '大号封90×165',
          })],
        },
      }),
    }));
    expect(JSON.stringify(createCall)).not.toContain('catalogIdentity');
    expect(mocks.db.orderItem.update).not.toHaveBeenCalled();
  });

  it('目标规格无加工价时在创建修改申请前零写入失败关闭', async () => {
    mocks.db.order.findUnique.mockResolvedValue(createRequestOrder());
    mocks.db.product.findMany.mockResolvedValue([catalogProduct()]);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => manualItemResult(args),
    );

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          expectedRevision: 2,
          expectedWorkOrderVersion: 1,
          reason: '改成大号封',
          items: [specificationChange()],
        },
        sales,
      ),
    ).rejects.toThrow(/修改后整单需要人工核价.*彩印基础价/u);

    expect(mocks.calculate).toHaveBeenCalledTimes(1);
    expect(mocks.db.orderChangeRequest.create).not.toHaveBeenCalled();
    expect(mocks.db.orderLog.create).not.toHaveBeenCalled();
    expect(mocks.enqueueNotification).not.toHaveBeenCalled();
    expect(mocks.dispatchNotification).not.toHaveBeenCalled();
  });

  it('修改后包装组无自动价时在创建申请前零写入失败关闭', async () => {
    const group = {
      id: 'group-1',
      sequence: 1,
      name: '单款装',
      mode: OrderPackagingMode.SINGLE_STYLE,
      actualBagCount: 100,
      unitPrice: new Decimal('0.1000'),
      subtotal: new Decimal('10.00'),
      pricingSnapshot: {},
      priceOverrideReason: null,
      lines: [{ orderItemId: 'item-1', unitsPerBag: 10 }],
    };
    mocks.db.order.findUnique.mockResolvedValue(
      createRequestOrder({ packagingGroups: [group] }),
    );
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        manualPackagingResult(args, group.id),
    );

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          expectedRevision: 2,
          expectedWorkOrderVersion: 1,
          reason: '改数量',
          items: [
            { operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 },
          ],
        },
        sales,
      ),
    ).rejects.toThrow(/修改后整单需要人工核价.*入袋金额/u);

    expect(mocks.db.orderChangeRequest.create).not.toHaveBeenCalled();
    expect(mocks.db.orderLog.create).not.toHaveBeenCalled();
    expect(mocks.enqueueNotification).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: '物流费',
      calculation: (args: ServiceArgs) => pendingShippingResult(args, '1'),
    },
    {
      label: '制版费',
      calculation: (args: ServiceArgs) => pureResult(args),
    },
  ])('仅$label待定时允许创建修改申请', async ({ calculation }) => {
    mocks.db.order.findUnique.mockResolvedValue(createRequestOrder());
    mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'request-1' });
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => calculation(args),
    );

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          expectedRevision: 2,
          expectedWorkOrderVersion: 1,
          reason: '改数量',
          items: [
            { operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 },
          ],
        },
        sales,
      ),
    ).resolves.toEqual({ id: 'request-1' });

    expect(mocks.calculate).toHaveBeenCalledTimes(1);
    expect(mocks.db.orderChangeRequest.create).toHaveBeenCalledTimes(1);
  });

  it('真实引擎仅因整单超量产生待核物流费时仍允许创建修改申请', async () => {
    const state: { calculation: ReturnType<typeof realEngineResult> | null } = {
      calculation: null,
    };
    mocks.db.order.findUnique.mockResolvedValue(
      createRequestOrder({ packagingGroups: [packagingGroup()] }),
    );
    mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'request-1' });
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => {
        state.calculation = realEngineResult(args);
        return state.calculation;
      },
    );

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          expectedRevision: 2,
          expectedWorkOrderVersion: 1,
          reason: '整单改为 3000 个',
          items: [
            { operation: 'UPDATE', itemId: 'item-1', quantity: 3_000 },
          ],
        },
        sales,
      ),
    ).resolves.toEqual({ id: 'request-1' });

    expect(state.calculation?.quote).toMatchObject({
      status: 'PARTIAL',
      submittable: true,
      pendingLineCodes: expect.arrayContaining(['SHIPPING:1']),
      pendingReasons: expect.arrayContaining([
        expect.objectContaining({ code: 'FREIGHT_QUOTE_PENDING' }),
      ]),
    });
    expect(state.calculation?.quote.errors).toContain(
      '发货记录 1·快递费：整单总数量超过 2000 个，改走物流，运费待定',
    );
    expect(mocks.db.orderChangeRequest.create).toHaveBeenCalledTimes(1);
  });

  it('目标产品关联纸张不存在时不创建规格变更申请', async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'GD-1', submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED, revision: 2, workOrderVersion: 1,
      items: [item()], changeRequests: [], shipments: [], packagingGroups: [],
      productionOperations: [],
    });
    mocks.db.product.findMany.mockResolvedValue([
      catalogProduct({ paperMaterialId: 'paper-missing' }),
    ]);
    mocks.db.material.findMany.mockResolvedValue([]);

    await expect(createOrderChangeRequest({
      orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
      reason: '改规格',
      items: [specificationChange()],
    }, sales)).rejects.toThrow(/关联的纸张不存在/u);

    expect(mocks.db.material.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['paper-missing'] },
        category: 'PAPER',
      },
      select: { id: true, isActive: true, outOfStock: true },
    });
    expect(mocks.db.orderChangeRequest.create).not.toHaveBeenCalled();
    expect(mocks.db.orderLog.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: '目标产品已停用或删除',
      products: [],
      change: specificationChange(),
      error: /目标报价产品不存在/u,
    },
    {
      label: '目标产品计价路线不兼容',
      products: [catalogProduct({ category: 'COLOR_PRINT' })],
      change: specificationChange(),
      error: /计价路线不一致/u,
    },
    {
      label: '提交规格被篡改',
      products: [catalogProduct()],
      change: { ...specificationChange(), specification: '中号封80×115' },
      error: /规格不属于选中的报价产品/u,
    },
  ])('$label 时不创建申请或审计记录', async ({
    products,
    change,
    error,
  }) => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'GD-1', submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED, revision: 2, workOrderVersion: 1,
      items: [item()], changeRequests: [], shipments: [], packagingGroups: [],
      productionOperations: [],
    });
    mocks.db.product.findMany.mockResolvedValue(products);

    await expect(createOrderChangeRequest({
      orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
      reason: '改规格',
      items: [change],
    }, sales)).rejects.toThrow(error);

    expect(mocks.db.product.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.orderChangeRequest.create).not.toHaveBeenCalled();
    expect(mocks.db.orderLog.create).not.toHaveBeenCalled();
    expect(mocks.db.orderItem.update).not.toHaveBeenCalled();
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
      items: [item()], changeRequests: [], shipments: [], packagingGroups: [],
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
      items: [item()], changeRequests: [], shipments: [], packagingGroups: [],
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
      changeRequests: [], shipments: [], packagingGroups: [], productionOperations: [],
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
    expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it('通知开关关闭时仍提交申请，但不写 outbox', async () => {
    mocks.getSetting.mockResolvedValue({ enabled: false });
    mocks.db.order.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'GD-1', submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED, revision: 2, workOrderVersion: 1,
      items: [item()],
      changeRequests: [], shipments: [], packagingGroups: [], productionOperations: [],
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
      changeRequests: [], shipments: [], packagingGroups: [],
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
      changeRequests: [], shipments: [],
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
    expect(mocks.calculate).not.toHaveBeenCalled();
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

  describe('已有地址发货的待发货工单', () => {
    const partlyShipped = () => [
      { id: 'shipment-1', sequence: 1, destinationProvince: '广东', weightKg: new Decimal('2.000'), status: 'SHIPPED' },
      { id: 'shipment-2', sequence: 2, destinationProvince: '湖南', weightKg: null, status: 'PLANNED' },
    ];
    const packingOrder = () => createRequestOrder({
      status: OrderStatus.PACKING,
      promisedDate: new Date('2026-09-10T00:00:00Z'),
      shipments: partlyShipped(),
    });

    it('拒绝取消申请，不写申请记录', async () => {
      mocks.db.order.findUnique.mockResolvedValue(packingOrder());
      mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'cancel-1' });
      await expect(createOrderChangeRequest({
        orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
        type: 'CANCEL', reason: '客户不要剩余的货', items: [],
      }, sales)).rejects.toThrow('工单已有地址发货，不能申请取消');
      expect(mocks.db.orderChangeRequest.create).not.toHaveBeenCalled();
      expect(mocks.db.orderLog.create).not.toHaveBeenCalled();
    });

    it.each([
      { label: '改数量', items: [{ operation: 'UPDATE' as const, itemId: 'item-1', quantity: 1_200 }] },
      { label: '改名称', items: [{ operation: 'UPDATE' as const, itemId: 'item-1', name: '改名红包' }] },
    ])('$label申请被拒，已发货地址的分货不能被改写', async ({ items }) => {
      mocks.db.order.findUnique.mockResolvedValue(packingOrder());
      mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'modify-1' });
      await expect(createOrderChangeRequest({
        orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
        type: 'MODIFY', modifyKind: 'OTHER', reason: '客户加量', items,
      }, sales)).rejects.toThrow('工单已有地址发货，只能申请修改交期');
      expect(mocks.calculate).not.toHaveBeenCalled();
      expect(mocks.db.orderChangeRequest.create).not.toHaveBeenCalled();
    });

    it('只改交期仍可提交，并按发货状态读取地址', async () => {
      mocks.db.order.findUnique.mockResolvedValue(packingOrder());
      mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'due-date-request' });
      await expect(createOrderChangeRequest(createOrderChangeRequestSchema.parse({
        orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
        type: 'MODIFY', modifyKind: 'DUE_DATE', reason: '剩余地址延期', items: [], promisedDate: '2026-09-12',
      }), sales)).resolves.toEqual({ id: 'due-date-request' });
      expect(mocks.db.order.findUnique).toHaveBeenCalledWith(expect.objectContaining({
        select: expect.objectContaining({
          shipments: expect.objectContaining({ select: expect.objectContaining({ status: true }) }),
        }),
      }));
    });
  });
});

describe('withdrawOrderChangeRequest', () => {
  it.each([true, false])(
    '管理员只能撤回自己提交的待审修改：本人 %s',
    async (own) => {
      mocks.db.orderChangeRequest.findUnique
        .mockResolvedValueOnce({ orderId: 'order-1' })
        .mockResolvedValueOnce({
          id: 'request-1',
          orderId: 'order-1',
          requesterId: own ? admin.id : 'sales-1',
          status: OrderChangeRequestStatus.PENDING,
          type: OrderChangeRequestType.MODIFY,
        });
      mocks.db.orderChangeRequest.update.mockResolvedValueOnce({
        id: 'request-1',
        status: OrderChangeRequestStatus.WITHDRAWN,
      });
      const result = withdrawOrderChangeRequest(
        { requestId: 'request-1' },
        admin,
      );
      if (own)
        await expect(result).resolves.toMatchObject({
          status: OrderChangeRequestStatus.WITHDRAWN,
        });
      else {
        await expect(result).rejects.toThrow('只能撤回自己');
        expect(mocks.db.orderChangeRequest.update).not.toHaveBeenCalled();
      }
    },
  );


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
  it('预览规格变更时重验目录并用目标产品的完整身份报价', async () => {
    const value = request({
      proposedChanges: { items: [specificationChange()] },
    });
    locate(value);
    mocks.db.product.findMany.mockResolvedValue([catalogProduct()]);

    await expect(
      previewOrderChangeRequestPricing(value.id, admin),
    ).resolves.toMatchObject({
      complete: true,
      items: [expect.objectContaining({
        previousSpecification: '中号封',
        specification: '大号封90×165',
        previousFrontFoilColors: ['哑金'],
        frontFoilColors: ['哑金'],
        previousBackFoilColors: [],
        backFoilColors: [],
      })],
    });

    expect(mocks.db.product.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.calculate).toHaveBeenCalledTimes(1);
    const quoteArgs = mocks.calculate.mock.calls[0]?.[1] as ServiceArgs;
    expect(quoteArgs.facts.items).toContainEqual(expect.objectContaining({
      itemKey: 'item-1',
      productId: 'product-large',
      pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
      productStructure: OrderProductStructure.STANDARD_ENVELOPE,
      pricingGroup: 'LARGE',
      specification: '大号封90×165',
      actualWidthMm: 90,
      actualHeightMm: 165,
      quantity: 1_000,
    }));
    expectNoApprovalMutation();
  });

  it('预览同时返回正反面烫金的变更前后事实', async () => {
    const value = request({
      proposedChanges: {
        items: [{
          operation: 'UPDATE',
          itemId: 'item-1',
          frontFoilColors: ['亮金'],
          backFoilColors: ['红金'],
        }],
      },
    });
    locate(value);

    await expect(
      previewOrderChangeRequestPricing(value.id, admin),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({
        previousFrontFoilColors: ['哑金'],
        frontFoilColors: ['亮金'],
        previousBackFoilColors: [],
        backFoilColors: ['红金'],
      })],
    });

    expectNoApprovalMutation();
  });

  it('预览时目标产品关联纸张已停用则失败关闭', async () => {
    const value = request({
      proposedChanges: { items: [specificationChange()] },
    });
    locate(value);
    mocks.db.product.findMany.mockResolvedValue([
      catalogProduct({ paperMaterialId: 'paper-inactive' }),
    ]);
    mocks.db.material.findMany.mockResolvedValue([{
      id: 'paper-inactive',
      isActive: false,
      outOfStock: false,
    }]);

    await expect(
      previewOrderChangeRequestPricing(value.id, admin),
    ).rejects.toThrow(/关联的纸张已停用或缺货/u);

    expect(mocks.calculate).not.toHaveBeenCalled();
    expectNoApprovalMutation();
  });

  it('快递费超出自动价表时返回可人工解决的逐票事实', async () => {
    const value = request();
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pendingShippingResult(args, '1'),
    );

    const result = await previewOrderChangeRequestPricing(value.id, admin);

    expect(result).toMatchObject({
      requestId: value.id,
      priceRevision: 5,
      quoteToken,
      complete: false,
      newTotal: null,
      delta: null,
      pendingCharges: [
        {
          businessKey: 'SHIPMENT:1:SHIPPING_FEE',
          categoryCode: 'SHIPPING_FEE',
          shipmentId: 'shipment-1',
          shipmentSequence: 1,
          destinationProvince: '广东',
          projectedQuantity: 1_200,
          description: '快递费',
          amount: null,
          reason: null,
        },
      ],
    });
    expect(result.pendingCharges[0]?.errors).toEqual([]);
    expectNoApprovalMutation();
  });

  it('真实引擎的整单 3000 个预览保留待核物流错误并返回人工收费入口', async () => {
    const value = request({
      order: {
        ...request().order,
        packagingAmount: new Decimal('10.00'),
        totalAmount: new Decimal('1018.00'),
        packagingGroups: [packagingGroup()],
      },
      proposedChanges: {
        items: [
          { operation: 'UPDATE', itemId: 'item-1', quantity: 3_000 },
        ],
      },
    });
    locate(value);
    const state: { calculation: ReturnType<typeof realEngineResult> | null } = {
      calculation: null,
    };
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => {
        state.calculation = realEngineResult(args);
        return state.calculation;
      },
    );

    const result = await previewOrderChangeRequestPricing(value.id, admin);

    expect(state.calculation?.quote.errors).toContain(
      '发货记录 1·快递费：整单总数量超过 2000 个，改走物流，运费待定',
    );
    expect(result).toMatchObject({
      quoteToken,
      complete: false,
      pendingCharges: [
        expect.objectContaining({
          businessKey: 'SHIPMENT:1:SHIPPING_FEE',
          shipmentId: 'shipment-1',
          shipmentSequence: 1,
          projectedQuantity: 3_000,
          amount: null,
        }),
      ],
    });
    expect(result.pendingCharges[0]?.errors).toContain(
      '整单总数量超过 2000 个，改走物流，运费待定',
    );
    expectNoApprovalMutation();
  });

  it('填入本次预览的人工快递费后返回完整新总额', async () => {
    const value = request();
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pendingShippingResult(args, '1'),
    );
    const resolution = pendingShippingResolution();

    const result = await previewOrderChangeRequestPricing(value.id, admin, {
      expectedPriceRevision: 5,
      pendingChargeResolutions: [resolution],
    });

    expect(result).toMatchObject({
      priceRevision: 5,
      quoteToken: approvalQuoteToken([resolution]),
      complete: true,
      oldTotal: '1008.00',
      newTotal: '1217.34',
      delta: '209.34',
      pendingCharges: [
        expect.objectContaining({
          businessKey: resolution.businessKey,
          categoryCode: 'SHIPPING_FEE',
          shipmentId: resolution.shipmentId,
          shipmentSequence: 1,
          destinationProvince: '广东',
          projectedQuantity: 1_200,
          amount: resolution.amount,
          reason: resolution.reason,
        }),
      ],
    });
    expectNoApprovalMutation();
  });

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
      quoteToken: null,
      newTotal: '1008.00',
      delta: '0.00',
      complete: true,
      items: [expect.objectContaining({
        previousFrontFoilColors: ['哑金'],
        frontFoilColors: ['哑金'],
        previousBackFoilColors: [],
        backFoilColors: [],
      })],
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
        totalExcludesPendingPlateFee: true,
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
            orderId: 'order-1',
            shipmentId: null,
            businessKey: PENDING_PLATE_BUSINESS_KEY,
            priceBookId: null,
            ...EMPTY_CHARGE_BASIS,
            status: OrderCustomerChargeStatus.ESTIMATED,
            amount: new Decimal('100.00'),
            overrideReason: '已发生制版费',
            pricingSnapshot: adminConfirmedChargeSnapshot({
              businessKey: PENDING_PLATE_BUSINESS_KEY,
              shipmentId: null,
              categoryCode: 'PLATE_MAKING_FEE',
              amount: '100.00',
              overrideReason: '已发生制版费',
            }),
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
        totalExcludesPendingPlateFee: false,
      });
  });

  it('生产版本预览在制版费待定且无可信历史覆盖时失败关闭', async () => {
    const value = request({
      order: { ...request().order, status: OrderStatus.CONFIRMED },
    });
    locate(value);

    await expect(previewOrderChangeRequestPricing(value.id, admin)).rejects
      .toThrow(/新报价仍需制版费.*没有可验证且排他/u);
    expectNoApprovalMutation();
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

  it('生产版本保持烫金颜色但更换产品与规格时也不沿用旧物理版', async () => {
    const value = request({
      proposedChanges: { items: [specificationChange()] },
      order: { ...request().order, status: OrderStatus.CONFIRMED },
    });
    locate(value);
    mocks.db.product.findMany.mockResolvedValue([catalogProduct()]);

    await expect(previewOrderChangeRequestPricing(value.id, admin)).rejects
      .toThrow(/生产版本新增、移除或变更.*制版事实/u);
    expect(mocks.calculate).not.toHaveBeenCalled();
    expectNoApprovalMutation();
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
  const quoteToken = pureQuoteToken;
  const changedQuoteToken = changedPureQuoteToken;

  it.each([
    { label: '缺少', expectedQuoteToken: undefined },
    { label: '已过期', expectedQuoteToken: changedQuoteToken },
  ])('工厂确认$label当前价凭证时在首写入前失败关闭', async ({
    expectedQuoteToken,
  }) => {
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, { plateApplies: false }),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce(request().order);

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        expectedQuoteToken,
        now: new Date('2026-09-02T02:00:00.000Z'),
      } as never),
    ).rejects.toThrow(/当前发布价或计价结果已变化/u);

    expect(mocks.calculate).toHaveBeenCalledTimes(1);
    expectNoApprovalMutation();
    expect(mocks.db.orderItem.findMany).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.aggregate).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: '物流 resolver 失败',
      arrange: () => {
        mocks.finalizeCharges.mockRejectedValueOnce(new Error('物流解析失败'));
      },
      message: /物流解析失败/u,
    },
    {
      label: '物流价目簿版本不一致',
      arrange: () => {
        mocks.finalizeCharges.mockResolvedValueOnce({
          priceBook: { ...priceVersion.logistics, id: 'stale-logistics' },
          charges: [],
          totalAmount: '8.00',
          requiresAdminConfirmation: false,
        });
      },
      message: /物流持久化与纯引擎价目簿版本不一致/u,
    },
    {
      label: '物流分项不一致',
      arrange: () => {
        mocks.finalizeCharges.mockResolvedValueOnce({
          priceBook: { ...priceVersion.logistics },
          charges: [],
          totalAmount: '8.00',
          requiresAdminConfirmation: false,
        });
      },
      message: /物流分项与纯引擎输出不一致/u,
    },
  ])('工厂确认在$label时首写入前失败关闭', async ({
    arrange,
    message,
  }) => {
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, { plateApplies: false }),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce(request().order);
    arrange();

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        expectedQuoteToken: quoteToken,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).rejects.toThrow(message);

    expectNoApprovalMutation();
    expect(mocks.db.orderItem.findMany).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.aggregate).not.toHaveBeenCalled();
  });

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
        expectedQuoteToken: quoteToken,
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
    const trustedItem = item({
      pricingRoute: OrderItemPricingRoute.MANUAL_QUOTE,
    });
    mocks.db.orderItem.findMany.mockResolvedValueOnce([
      { subtotal: new Decimal('1000.00') },
    ]);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => manualItemResult(args),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...request().order,
      items: [
        {
          ...trustedItem,
          pricingSnapshot: {
            ...adminConfirmedItemSnapshot(trustedItem),
            input: {
              pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
            },
          },
        },
      ],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        expectedQuoteToken: quoteToken,
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

  it('工厂确认在款式快照金额与实时行不一致时零写入失败关闭', async () => {
    const confirmedFacts = item({
      pricingRoute: OrderItemPricingRoute.MANUAL_QUOTE,
      priceOverrideReason: '特殊工艺人工核价',
    });
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => manualItemResult(args),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...request().order,
      items: [
        {
          ...confirmedFacts,
          subtotal: new Decimal('1001.00'),
          pricingSnapshot: {
            ...adminConfirmedItemSnapshot(confirmedFacts),
            input: {
              pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
            },
          },
        },
      ],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        expectedQuoteToken: quoteToken,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).rejects.toThrow(/仍需人工核价|需要人工核价/u);
    expectNoApprovalMutation();
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
        expectedQuoteToken: quoteToken,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).rejects.toThrow(/仍需人工核价|需要人工核价/u);
    expect(mocks.db.orderItem.update).not.toHaveBeenCalled();
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });

  it('工厂确认保留已人工确认的包装组金额', async () => {
    const groupFacts = packagingGroup({
      unitPrice: new Decimal('0.2500'),
      subtotal: new Decimal('25.00'),
      suggestedSubtotal: null,
      priceOverrideReason: '人工确认入袋费',
    });
    const group = {
      ...groupFacts,
      pricingSnapshot: adminConfirmedPackagingSnapshot(groupFacts),
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
        expectedQuoteToken: quoteToken,
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

  it('工厂确认在包装快照袋数与实时行不一致时零写入失败关闭', async () => {
    const confirmedFacts = packagingGroup({
      actualBagCount: 100,
      unitPrice: new Decimal('0.2500'),
      subtotal: new Decimal('25.00'),
      suggestedSubtotal: null,
      priceOverrideReason: '人工确认入袋费',
    });
    const group = {
      ...confirmedFacts,
      actualBagCount: 101,
      pricingSnapshot: adminConfirmedPackagingSnapshot(confirmedFacts),
    };
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
        expectedQuoteToken: quoteToken,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).rejects.toThrow(/仍需人工核价|需要人工核价/u);
    expectNoApprovalMutation();
  });

  it('工厂确认保留已人工确认的快递费，仅刷新自动耗材费', async () => {
    const order = request().order;
    const trustedShipping = {
      ...order.customerCharges[0]!,
      amount: new Decimal('9.00'),
      overrideReason: '物流商人工报价',
      pricingSnapshot: adminConfirmedChargeSnapshot({
        businessKey: 'SHIPMENT:1:SHIPPING_FEE',
        shipmentId: 'shipment-1',
        categoryCode: 'SHIPPING_FEE',
        priceBookId: 'old-logistics',
        amount: '9.00',
        overrideReason: '物流商人工报价',
      }),
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
        expectedQuoteToken: quoteToken,
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
    expect(mocks.db.orderCustomerCharge.update).toHaveBeenCalledTimes(2);
    expect(mocks.db.orderCustomerCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shipping-1' },
        data: expect.objectContaining({
          priceBookId: priceVersion.logistics.id,
          amount: '9.00',
          status: OrderCustomerChargeStatus.ESTIMATED,
          overrideReason: '物流商人工报价',
          finalizedById: null,
          finalizedAt: null,
          pricingSnapshot: expect.objectContaining({
            source: 'ADMIN_SNAPSHOT_CONFIRMATION',
            actual: expect.objectContaining({
              orderId: 'order-1',
              businessKey: 'SHIPMENT:1:SHIPPING_FEE',
              shipmentId: 'shipment-1',
              categoryCode: 'SHIPPING_FEE',
              status: OrderCustomerChargeStatus.ESTIMATED,
              priceBookId: priceVersion.logistics.id,
              sourceRuleId: 'shipping-rule',
              quantity: '1.000',
              unit: 'kg',
              unitPrice: null,
              suggestedAmount: '3.00',
              amount: '9.00',
              isAdjustment: false,
              approvalReference: null,
              overrideReason: '物流商人工报价',
            }),
          }),
        }),
      }),
    );
    expect(mocks.db.orderCustomerCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'packing-1' } }),
    );
  });

  it('真实引擎整单超量时，工厂确认允许已有可信快递费和制版费覆盖待核行', async () => {
    const order = request().order;
    const shipping = {
      ...order.customerCharges[0]!,
      amount: new Decimal('9.00'),
      overrideReason: '物流商人工报价',
      pricingSnapshot: adminConfirmedChargeSnapshot({
        businessKey: 'SHIPMENT:1:SHIPPING_FEE',
        shipmentId: 'shipment-1',
        categoryCode: 'SHIPPING_FEE',
        priceBookId: 'old-logistics',
        amount: '9.00',
        overrideReason: '物流商人工报价',
      }),
    };
    const plate = {
      id: 'plate-confirmed',
      orderId: 'order-1',
      shipmentId: null,
      businessKey: PENDING_PLATE_BUSINESS_KEY,
      priceBookId: null,
      ...EMPTY_CHARGE_BASIS,
      status: OrderCustomerChargeStatus.ESTIMATED,
      amount: new Decimal('100.00'),
      pricingSnapshot: adminConfirmedChargeSnapshot({
        businessKey: PENDING_PLATE_BUSINESS_KEY,
        shipmentId: null,
        categoryCode: 'PLATE_MAKING_FEE',
        amount: '100.00',
        overrideReason: '制版费人工确认',
      }),
      overrideReason: '制版费人工确认',
      category: { code: 'PLATE_MAKING_FEE' },
    };
    const largeItem = item({
      quantity: 3_000,
      subtotal: new Decimal('3000.00'),
      shipmentLines: [
        {
          quantity: 3_000,
          shipment: { id: 'shipment-1', sequence: 1 },
        },
      ],
    });
    mocks.db.orderItem.findMany.mockResolvedValueOnce([
      { subtotal: new Decimal('3000.00') },
    ]);
    mocks.db.orderCustomerCharge.aggregate.mockResolvedValueOnce({
      _sum: { amount: new Decimal('114.00') },
    });
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => realEngineResult(args),
    );
    mocks.finalizeCharges.mockResolvedValueOnce({
      priceBook: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion.logistics,
        name: '物流价目簿',
        sourceName: 'rules.md',
        policy: {},
      },
      charges: [
        {
          shipmentKey: '1',
          categoryCode: 'SHIPPING_FEE',
          categoryId: 'shipping-category',
          priceBookId:
            CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion.logistics.id,
          sourceRuleId: null,
          businessKey: 'SHIPMENT:1:SHIPPING_FEE',
          status: OrderCustomerChargeStatus.ESTIMATED,
          description: '物流运费待定',
          quantity: '3000',
          unit: '个',
          suggestedAmount: null,
          amount: '9.00',
          pricingSnapshot: {},
          overrideReason: '物流商人工报价',
        },
        {
          shipmentKey: '1',
          categoryCode: 'PACKING_MATERIAL',
          categoryId: 'packing-category',
          priceBookId:
            CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion.logistics.id,
          sourceRuleId: 'carton-rule',
          businessKey: 'SHIPMENT:1:PACKING_MATERIAL',
          status: OrderCustomerChargeStatus.ESTIMATED,
          description: '纸箱耗材',
          quantity: '3000',
          unit: '个',
          suggestedAmount: '7.00',
          amount: '7.00',
          pricingSnapshot: {},
          overrideReason: null,
        },
      ],
      totalAmount: '16.00',
      requiresAdminConfirmation: false,
    });
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...order,
      items: [largeItem],
      packagingAmount: new Decimal('30.00'),
      packagingGroups: [
        packagingGroup({
          actualBagCount: 300,
          subtotal: new Decimal('30.00'),
        }),
      ],
      customerCharges: [shipping, order.customerCharges[1]!, plate],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        expectedQuoteToken: quoteToken,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ confirmedFee: '3144.00' });

    const calculation = (await mocks.calculate.mock.results[0]!
      .value) as ReturnType<typeof realEngineResult>;
    expect(calculation.quote.errors).toContain(
      '发货记录 1·快递费：整单总数量超过 2000 个，改走物流，运费待定',
    );
    expect(mocks.db.order.update).toHaveBeenCalled();
  });

  it.each([
    {
      label: '缺少可信快递费覆盖',
      trustedShipping: false,
      shipmentId: 'shipment-1',
      error: /整单需要人工核价/u,
    },
    {
      label: '可信快递费错链到其他发货记录',
      trustedShipping: true,
      shipmentId: 'shipment-other',
      error: /收费明细.*与收货地址.*不一致/u,
    },
  ])('真实引擎整单超量但$label时在首写入前失败关闭', async ({
    trustedShipping,
    shipmentId,
    error,
  }) => {
    const order = request().order;
    const shipping = {
      ...order.customerCharges[0]!,
      shipmentId,
      amount: new Decimal('9.00'),
      overrideReason: trustedShipping ? '物流商人工报价' : null,
      pricingSnapshot: trustedShipping
        ? adminConfirmedChargeSnapshot({
            businessKey: 'SHIPMENT:1:SHIPPING_FEE',
            shipmentId,
            categoryCode: 'SHIPPING_FEE',
            priceBookId: 'old-logistics',
            amount: '9.00',
            overrideReason: '物流商人工报价',
          })
        : {},
    };
    const plate = {
      id: 'plate-confirmed',
      orderId: 'order-1',
      shipmentId: null,
      businessKey: PENDING_PLATE_BUSINESS_KEY,
      priceBookId: null,
      ...EMPTY_CHARGE_BASIS,
      status: OrderCustomerChargeStatus.ESTIMATED,
      amount: new Decimal('100.00'),
      pricingSnapshot: adminConfirmedChargeSnapshot({
        businessKey: PENDING_PLATE_BUSINESS_KEY,
        shipmentId: null,
        categoryCode: 'PLATE_MAKING_FEE',
        amount: '100.00',
        overrideReason: '制版费人工确认',
      }),
      overrideReason: '制版费人工确认',
      category: { code: 'PLATE_MAKING_FEE' },
    };
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => realEngineResult(args),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...order,
      items: [
        item({
          quantity: 3_000,
          subtotal: new Decimal('3000.00'),
          shipmentLines: [
            {
              quantity: 3_000,
              shipment: { id: 'shipment-1', sequence: 1 },
            },
          ],
        }),
      ],
      packagingAmount: new Decimal('30.00'),
      packagingGroups: [
        packagingGroup({
          actualBagCount: 300,
          subtotal: new Decimal('30.00'),
        }),
      ],
      customerCharges: [shipping, order.customerCharges[1]!, plate],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        expectedQuoteToken: quoteToken,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).rejects.toThrow(error);

    expectNoApprovalMutation();
    expect(mocks.db.orderItem.findMany).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.aggregate).not.toHaveBeenCalled();
    expect(mocks.finalizeCharges).not.toHaveBeenCalled();
  });

  it('当前混合单仅为普通烫金保留人工版费，不与彩印原子套餐叠加', async () => {
    const order = request().order;
    const plateCharge = {
      id: 'plate-confirmed',
      orderId: 'order-1',
      shipmentId: null,
      businessKey: PENDING_PLATE_BUSINESS_KEY,
      priceBookId: null,
      ...EMPTY_CHARGE_BASIS,
      status: OrderCustomerChargeStatus.ESTIMATED,
      amount: new Decimal('100.00'),
      pricingSnapshot: adminConfirmedChargeSnapshot({
        businessKey: PENDING_PLATE_BUSINESS_KEY,
        shipmentId: null,
        categoryCode: 'PLATE_MAKING_FEE',
        amount: '100.00',
        overrideReason: '普通烫金制版费人工确认',
      }),
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
        expectedQuoteToken: quoteToken,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ confirmedFee: '1808.00' });
    expect(
      mocks.db.orderCustomerCharge.update.mock.calls.some(
        ([call]) => call.where?.id === plateCharge.id,
      ),
    ).toBe(false);
  });

  it('待定版费同时存在两条活跃管理员确认收费时零写入失败关闭', async () => {
    const order = request().order;
    const aggregatePlateCharge = {
      id: 'plate-confirmed',
      orderId: 'order-1',
      shipmentId: null,
      businessKey: PENDING_PLATE_BUSINESS_KEY,
      priceBookId: null,
      ...EMPTY_CHARGE_BASIS,
      status: OrderCustomerChargeStatus.ESTIMATED,
      amount: new Decimal('100.00'),
      pricingSnapshot: adminConfirmedChargeSnapshot({
        businessKey: PENDING_PLATE_BUSINESS_KEY,
        shipmentId: null,
        categoryCode: 'PLATE_MAKING_FEE',
        amount: '100.00',
        overrideReason: '普通烫金制版费人工确认',
      }),
      overrideReason: '普通烫金制版费人工确认',
      category: { code: 'PLATE_MAKING_FEE' },
    };
    const duplicatePlateCharge = {
      id: 'plate-duplicate',
      orderId: 'order-1',
      shipmentId: null,
      businessKey: 'LEGACY:PLATE_MAKING_FEE:DUPLICATE',
      priceBookId: null,
      ...EMPTY_CHARGE_BASIS,
      status: OrderCustomerChargeStatus.ESTIMATED,
      amount: new Decimal('25.00'),
      pricingSnapshot: adminConfirmedChargeSnapshot({
        businessKey: 'LEGACY:PLATE_MAKING_FEE:DUPLICATE',
        shipmentId: null,
        categoryCode: 'PLATE_MAKING_FEE',
        amount: '25.00',
        overrideReason: '历史重复导入版费',
      }),
      overrideReason: '历史重复导入版费',
      category: { code: 'PLATE_MAKING_FEE' },
    };
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
      customerCharges: [
        ...order.customerCharges,
        aggregatePlateCharge,
        duplicatePlateCharge,
      ],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        expectedQuoteToken: quoteToken,
        now: new Date('2026-09-02T02:00:00.000Z'),
      }),
    ).rejects.toThrow(/整单需要人工核价/u);
    expectNoApprovalMutation();
    expect(mocks.db.orderItem.findMany).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.aggregate).not.toHaveBeenCalled();
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
          orderId: 'order-1',
          shipmentId: null,
          businessKey: PENDING_PLATE_BUSINESS_KEY,
          priceBookId: null,
          ...EMPTY_CHARGE_BASIS,
          status: OrderCustomerChargeStatus.ESTIMATED,
          amount: new Decimal('100.00'),
          pricingSnapshot: adminConfirmedChargeSnapshot({
            businessKey: PENDING_PLATE_BUSINESS_KEY,
            shipmentId: null,
            categoryCode: 'PLATE_MAKING_FEE',
            amount: '100.00',
            overrideReason: '历史独立版费',
          }),
          overrideReason: '历史独立版费',
          category: { code: 'PLATE_MAKING_FEE' },
        },
      ],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        expectedQuoteToken: quoteToken,
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
        expectedQuoteToken: quoteToken,
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
    const confirmedItem = bundledPrintItem();
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => manualPrintFoilResult(args),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...order,
      items: [
        {
          ...confirmedItem,
          pricingSnapshot: adminConfirmedItemSnapshot(confirmedItem),
        },
      ],
      customerCharges: [
        ...order.customerCharges,
        {
          id: 'plate-old',
          orderId: 'order-1',
          shipmentId: null,
          businessKey: PENDING_PLATE_BUSINESS_KEY,
          priceBookId: null,
          ...EMPTY_CHARGE_BASIS,
          status: OrderCustomerChargeStatus.ESTIMATED,
          amount: new Decimal('100.00'),
          pricingSnapshot: adminConfirmedChargeSnapshot({
            businessKey: PENDING_PLATE_BUSINESS_KEY,
            shipmentId: null,
            categoryCode: 'PLATE_MAKING_FEE',
            amount: '100.00',
            overrideReason: '历史独立版费',
          }),
          overrideReason: '历史独立版费',
          category: { code: 'PLATE_MAKING_FEE' },
        },
      ],
    });

    await expect(
      confirmOrderPricingAtCurrentPublishedVersionInTx(mocks.db as never, {
        orderId: 'order-1',
        actorId: admin.id,
        expectedQuoteToken: quoteToken,
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
        expectedQuoteToken: quoteToken,
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
    const confirmedItem = plainPrintItem();
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => manualItemResult(args),
    );
    mocks.db.order.findUnique.mockResolvedValueOnce({
      ...order,
      items: [
        {
          ...confirmedItem,
          pricingSnapshot: adminConfirmedItemSnapshot(confirmedItem),
        },
      ],
      customerCharges: order.customerCharges.map((charge) => ({
        ...charge,
        pricingSnapshot: adminConfirmedChargeSnapshot({
          businessKey: charge.businessKey,
          shipmentId: charge.shipmentId,
          categoryCode: charge.category.code,
          priceBookId: charge.priceBookId,
          sourceRuleId: charge.sourceRuleId,
          quantity: charge.quantity,
          unit: charge.unit,
          unitPrice: charge.unitPrice,
          suggestedAmount: charge.suggestedAmount,
          amount: charge.amount ?? '0.00',
          isAdjustment: charge.isAdjustment,
          approvalReference: charge.approvalReference,
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
      quoteToken: pureQuoteToken,
    });
    expect(mocks.db.orderItem.update).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.update).not.toHaveBeenCalled();
  });
});

describe('cancellation settlement reference', () => {
  function readyCancellationRequest() {
    return request({ type: OrderChangeRequestType.CANCEL, proposedChanges: { items: [] }, order: {
      ...request().order, status: OrderStatus.RELEASED, workOrderVersion: 2, settledFee: null,
      productionWorkOrderProgress: [], productionProgressSteps: [], outsourceOrders: [],
    } });
  }
  it('取消审批必须携带最新预览凭证，零产量也不能省略', async () => {
    const value = readyCancellationRequest();
    locateCancellation(value);
    await expect(reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null,
      producedQty: 0, settleFee: '0.00',
    }, admin)).rejects.toThrow('批准取消前必须先计算并确认最新参考结算价');
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });
  it('发布规则变化但价格修订号未变时也拒绝旧取消参考价', async () => {
    const value = readyCancellationRequest();
    locateCancellation(value);
    const preview = await previewOrderCancellationSettlement({ requestId: value.id, producedQty: 500 }, admin);
    mocks.calculate.mockImplementation(async (_tx: unknown, args: ServiceArgs) => {
      const result = pureResult(args);
      return { ...result, quote: { ...result.quote, priceVersion: { ...priceVersion,
        processing: { ...priceVersion.processing, version: 99 },
      } } };
    });
    locateCancellation(value);
    await expect(reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null,
      producedQty: 500, settleFee: '510.00', settleFeeAdjustmentReason: '旧调整原因',
      expectedPriceRevision: preview.priceRevision, expectedQuoteToken: preview.quoteToken,
    }, admin)).rejects.toThrow('参考结算价已变化');
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });
  it('材料补核后重新计算可批准，旧预览不会阻断新预览', async () => {
    const value = readyCancellationRequest();
    locateCancellation(value);
    const before = await previewOrderCancellationSettlement({ requestId: value.id, producedQty: 0 }, admin);
    value.order.priceRevision += 1;
    locateCancellation(value);
    const latest = await previewOrderCancellationSettlement({ requestId: value.id, producedQty: 0 }, admin);
    expect(latest.priceRevision).toBe(before.priceRevision + 1);
    expect(latest.quoteToken).not.toBe(before.quoteToken);
    locateCancellation(value);
    await expect(reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null,
      producedQty: 0, settleFee: '0.00', expectedPriceRevision: latest.priceRevision, expectedQuoteToken: latest.quoteToken,
    }, admin)).resolves.toEqual({ id: 'request-1' });
    expect(mocks.db.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ settledFee: '0.00' }) }));
  });
  it('材料补核后即使已有调整原因也拒绝旧价格版本的取消审批', async () => {
    const value = request({ type: OrderChangeRequestType.CANCEL, proposedChanges: { items: [] }, order: {
      ...request().order, status: OrderStatus.RELEASED, priceRevision: 6,
      workOrderVersion: 2, settledFee: null, productionWorkOrderProgress: [],
      productionProgressSteps: [], outsourceOrders: [],
    } });
    locateCancellation(value);
    await expect(reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null,
      expectedPriceRevision: 5, expectedQuoteToken: quoteToken, producedQty: 500,
      settleFee: '510.00', settleFeeAdjustmentReason: '旧预览下已核对的五元调整',
    }, admin)).rejects.toThrow('材料单价或价格版本已变化');
    expect(mocks.db.order.update).not.toHaveBeenCalled();
    expect(mocks.db.productionOperation.updateMany).not.toHaveBeenCalled();
  });
  it('取消结算的已产数量包含新版承接进度，不重复计算旧版', async () => {
    const value = request({
      type: OrderChangeRequestType.CANCEL,
      proposedChanges: { items: [] },
      order: {
        ...request().order,
        status: OrderStatus.FOILING,
        workOrderVersion: 2,
        productionOperations: [
          { id: 'old-op', status: 'COMPLETED', workOrderVersion: 1, operationType: 'PARTIAL', carriedWorkOrderProgressQty: new Decimal(900) },
          { id: 'current-op', status: 'IN_PROGRESS', workOrderVersion: 2, operationType: 'PARTIAL', carriedWorkOrderProgressQty: new Decimal(300) },
        ],
        productionWorkOrderProgress: [
          { workOrderVersion: 1, stage: 'FOILING', workOrderProgressQuantity: new Decimal(900) },
          { workOrderVersion: 2, stage: 'FOILING', workOrderProgressQuantity: new Decimal(200) },
        ],
        productionProgressSteps: [],
        outsourceOrders: [],
      },
    });
    locateCancellation(value);
    await expect(reviewOrderChangeRequest({
      requestId: value.id, decision: 'APPROVE', reviewRemark: null,
      producedQty: 499, settleFee: '505.00',
    }, admin)).rejects.toThrow('已产数量不能小于已登记生产 500');
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });

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
    const preview = await previewOrderCancellationSettlement({ requestId: value.id, producedQty: 500 }, admin);
    mocks.db.$executeRaw.mockClear();
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
          expectedPriceRevision: preview.priceRevision,
          expectedQuoteToken: preview.quoteToken,
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
    const preview = await previewOrderCancellationSettlement({ requestId: value.id, producedQty: 500 }, admin);
    locateCancellation(value);

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          producedQty: 500,
          settleFee: '510.00',
          expectedPriceRevision: preview.priceRevision,
          expectedQuoteToken: preview.quoteToken,
        },
        admin,
      ),
    ).rejects.toThrow(/调整参考结算金额必须填写原因/);
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });

  it('已有地址发货的待发货工单不能预览或批准取消，仍可驳回', async () => {
    const value = request({ type: OrderChangeRequestType.CANCEL, proposedChanges: { items: [] }, order: {
      ...request().order, status: OrderStatus.PACKING, workOrderVersion: 2, settledFee: null,
      productionWorkOrderProgress: [], productionProgressSteps: [], outsourceOrders: [],
      shipments: [
        { id: 'shipment-1', sequence: 1, destinationProvince: '广东', weightKg: new Decimal('2.000'), status: 'SHIPPED' },
        { id: 'shipment-2', sequence: 2, destinationProvince: '湖南', weightKg: null, status: 'PLANNED' },
      ],
    } });
    locateCancellation(value);
    // 已有地址发货即正常收费：连取消结算参考价都不给出。
    await expect(previewOrderCancellationSettlement({ requestId: value.id, producedQty: 0 }, admin))
      .rejects.toThrow('工单已有地址发货，不能批准取消，请驳回该申请');
    locateCancellation(value);
    await expect(reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null,
      producedQty: 0, settleFee: '0.00', expectedPriceRevision: value.order.priceRevision, expectedQuoteToken: 'stale-token',
    }, admin)).rejects.toThrow('工单已有地址发货，不能批准取消，请驳回该申请');
    expect(mocks.db.order.update).not.toHaveBeenCalled();
    expect(mocks.db.productionOperation.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.orderChangeRequest.update).not.toHaveBeenCalled();

    locateCancellation(value);
    await reviewOrderChangeRequest({ requestId: value.id, decision: 'DENY', reviewRemark: '已有地址发货' }, admin);
    expect(mocks.db.orderChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: OrderChangeRequestStatus.DENIED }),
    }));
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });
});

describe('reviewOrderChangeRequest', () => {
  it.each([
    OrderSettlementType.EXTERNAL_SALES,
  ])('%s 纯交期批准保留历史金额，不从不完整明细重建费用或业绩', async (settlementType) => {
    const value = request({
      proposedChanges: { items: [], promisedDate: '2026-09-20' },
      order: {
        ...request().order,
        settlementType,
        promisedDate: null,
        items: [],
        shipments: [],
        customerCharges: [],
        processingAmount: new Decimal('2800.00'),
        totalAmount: new Decimal('3000.00'),
        quotedFee: new Decimal('2900.00'),
        quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
        quotedPricingRevisionId: 'historical-quote',
        confirmedFee: new Decimal('3000.00'),
        settledFee: null,
      },
    });
    locate(value);
    await expect(previewOrderChangeRequestPricing(value.id, admin)).resolves.toMatchObject({
      oldTotal: '3000.00',
      newTotal: '3000.00',
      delta: '0.00',
      quoteToken: null,
    });
    locate(value);
    mocks.db.orderItem.findMany.mockResolvedValue([]);
    mocks.db.orderCustomerCharge.aggregate.mockResolvedValue({ _sum: { amount: null } });

    await reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', expectedPriceRevision: 5, reviewRemark: null }, admin);

    expect(mocks.db.order.update).toHaveBeenCalledWith({
      where: { id: value.orderId },
      data: { revision: 3, promisedDate: new Date('2026-09-20T00:00:00Z') },
    });
    expect(mocks.db.orderItem.findMany).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.aggregate).not.toHaveBeenCalled();
    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(mocks.appendRevision).not.toHaveBeenCalled();
    expect(mocks.db.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CHANGE_REQUEST_APPROVED',
        changedFields: expect.objectContaining({
          processingAmount: { before: '2800', after: '2800.00' },
          totalAmount: { before: '3000', after: '3000.00' },
        }),
      }),
    });
  });
  it.each(['2026-09-20', null])('交期提案 %s 的预览与审批一致，不重新计价或要求配送信息', async (promisedDate) => {
    const value = request({ proposedChanges: { items: [], promisedDate },
      order: { ...request().order, promisedDate: new Date('2026-09-10T00:00:00Z'), shipments: [] } });
    locate(value);
    await expect(previewOrderChangeRequestPricing(value.id, admin)).resolves.toMatchObject({
      promisedDateChange: { before: '2026-09-10', after: promisedDate }, newTotal: '1008.00', quoteToken: null,
    });
    locate(value);
    mocks.db.orderItem.findMany.mockResolvedValue([{ subtotal: new Decimal(1000) }]);
    await reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', expectedPriceRevision: 5, reviewRemark: null }, admin);
    expect(mocks.db.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      promisedDate: promisedDate ? new Date(`${promisedDate}T00:00:00Z`) : null, revision: 3,
    }) }));
    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(mocks.appendRevision).not.toHaveBeenCalled();
  });
  it.each([false, true])('生产中仅改交期仍升版；暂停=%s 时保持暂停，未暂停时重新检查完工', async (paused) => {
    const value = request({ baseWorkOrderVersion: 2, proposedChanges: { items: [], promisedDate: '2026-09-20' },
      order: { ...request().order, status: paused ? OrderStatus.ON_HOLD : OrderStatus.FOILING, workOrderVersion: 2, promisedDate: null } });
    locate(value);
    mocks.db.orderWorkflowDecision.findFirst.mockResolvedValue({ fromStatus: OrderStatus.FOILING });
    mocks.db.orderItem.findMany.mockResolvedValue([{ subtotal: new Decimal(1000) }]);
    await reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', expectedPriceRevision: 5, reviewRemark: null }, admin);
    expect(mocks.activateProduction).toHaveBeenCalledWith(mocks.db, 'order-1', admin, expect.any(Date), {
      targetStatus: paused ? OrderStatus.ON_HOLD : OrderStatus.FOILING, allowVersionRematerialization: true,
    });
    expect(mocks.db.orderChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', workOrderVersionAfter: 3 }) }));
    expect(mocks.completion).toHaveBeenCalledTimes(paused ? 0 : 1);
  });

  it.each([false, true])('待下发工单批准改单升版但不提前写下发时间 scheduledAt；暂停=%s', async (paused) => {
    const value = request({ baseWorkOrderVersion: 2, proposedChanges: { items: [], promisedDate: '2026-09-20' },
      order: { ...request().order, status: paused ? OrderStatus.ON_HOLD : OrderStatus.CONFIRMED, workOrderVersion: 2, promisedDate: null, scheduledAt: null } });
    locate(value);
    mocks.db.orderWorkflowDecision.findFirst.mockResolvedValue({ fromStatus: OrderStatus.CONFIRMED });
    mocks.db.orderItem.findMany.mockResolvedValue([{ subtotal: new Decimal(1000) }]);
    await reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', expectedPriceRevision: 5, reviewRemark: null }, admin);
    expect(mocks.db.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({ workOrderVersion: 3, completedAt: null }),
    });
    // 下发（CONFIRMED → RELEASED）才是当前代次的停滞计时起点。
    expect(mocks.db.order.update.mock.calls.some(([call]) => call.data !== undefined && 'scheduledAt' in call.data)).toBe(false);
    expect(mocks.activateProduction).not.toHaveBeenCalled();
    const approvedLog = mocks.db.orderLog.create.mock.calls
      .map(([call]) => call.data)
      .find((data) => data.action === 'CHANGE_REQUEST_APPROVED');
    expect(approvedLog?.changedFields).toMatchObject({ workOrderVersion: { before: 2, after: 3 } });
    expect(approvedLog?.changedFields).not.toHaveProperty('scheduledAt');
  });

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

  describe('已有地址发货的待发货工单', () => {
    const partlyShipped = () => [
      { id: 'shipment-1', sequence: 1, destinationProvince: '广东', weightKg: new Decimal('2.000'), status: 'SHIPPED' },
      { id: 'shipment-2', sequence: 2, destinationProvince: '湖南', weightKg: null, status: 'PLANNED' },
    ];

    it('批准改数量失败关闭，不改写已发货地址的分货和物流', async () => {
      const base = request().order;
      const value = request({ order: {
        ...base, status: OrderStatus.PACKING, shipments: partlyShipped(),
        items: [plainPrintItem({ shipmentLines: [
          { quantity: 600, shipment: { id: 'shipment-1', sequence: 1 } },
          { quantity: 400, shipment: { id: 'shipment-2', sequence: 2 } },
        ] })],
        customerCharges: [...base.customerCharges, ...base.customerCharges.map((charge) => ({
          ...charge, id: `${charge.id}-2`, shipmentId: 'shipment-2',
          businessKey: charge.businessKey.replace('SHIPMENT:1:', 'SHIPMENT:2:'),
        }))],
      } });
      locate(value);
      mocks.calculate.mockImplementationOnce(
        async (_tx: unknown, args: ServiceArgs) => pureResult(args, { plateApplies: false }),
      );
      await expect(reviewOrderChangeRequest({
        requestId: value.id, decision: 'APPROVE', reviewRemark: null,
        expectedPriceRevision: 5, expectedQuoteToken: quoteToken,
      }, admin)).rejects.toThrow('工单已有地址发货，不能批准款式或数量修改，请驳回该申请');
      expect(mocks.calculate).not.toHaveBeenCalled();
      expectNoApprovalMutation();
    });

    it('改款式数量的计价预览同样拒绝，不给出新报价', async () => {
      const value = request({ order: { ...request().order, status: OrderStatus.PACKING, shipments: partlyShipped() } });
      locate(value);
      await expect(previewOrderChangeRequestPricing(value.id, admin))
        .rejects.toThrow('工单已有地址发货，不能批准款式或数量修改，请驳回该申请');
      expect(mocks.calculate).not.toHaveBeenCalled();
      expect(mocks.db.orderChangeRequest.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({
        include: expect.objectContaining({ order: expect.objectContaining({ include: expect.objectContaining({
          shipments: expect.objectContaining({ select: expect.objectContaining({ status: true }) }),
        }) }) }),
      }));
    });

    it('只改交期的计价预览仍然放行', async () => {
      const value = request({ proposedChanges: { items: [], promisedDate: '2026-09-20' },
        order: { ...request().order, status: OrderStatus.PACKING, promisedDate: null, shipments: partlyShipped() } });
      locate(value);
      await expect(previewOrderChangeRequestPricing(value.id, admin)).resolves.toMatchObject({ complete: true });
    });

    it('只改交期仍可批准，并按发货状态读取地址', async () => {
      const value = request({ proposedChanges: { items: [], promisedDate: '2026-09-20' },
        order: { ...request().order, status: OrderStatus.PACKING, promisedDate: null, shipments: partlyShipped() } });
      locate(value);
      mocks.db.orderItem.findMany.mockResolvedValue([{ subtotal: new Decimal(1000) }]);
      await reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', expectedPriceRevision: 5, reviewRemark: null }, admin);
      expect(mocks.db.orderChangeRequest.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({
        include: expect.objectContaining({ order: expect.objectContaining({ include: expect.objectContaining({
          shipments: expect.objectContaining({ select: expect.objectContaining({ status: true }) }),
        }) }) }),
      }));
      expect(mocks.db.orderShipmentLine.upsert).not.toHaveBeenCalled();
      expect(mocks.db.orderChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED' }),
      }));
    });
  });

  it.each([
    {
      label: '缺少计价凭证',
      expectedQuoteToken: undefined,
      calculatedQuoteToken: pureQuoteToken,
    },
    {
      label: '价目或计价结果已变化',
      expectedQuoteToken: quoteToken,
      calculatedQuoteToken: changedPureQuoteToken,
    },
  ])('$label时批准失败关闭且零写入', async ({
    expectedQuoteToken,
    calculatedQuoteToken,
  }) => {
    const value = request();
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pureResult(args, {
          plateApplies: false,
          quoteToken: calculatedQuoteToken,
        }),
    );

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          expectedPriceRevision: 5,
          expectedQuoteToken,
        },
        admin,
      ),
    ).rejects.toThrow(/价格规则.*计价结果.*已变化/u);

    expect(mocks.calculate).toHaveBeenCalledTimes(1);
    expectNoApprovalMutation();
  });

  it('多款修改在首写前验完所有多地址数量下限', async () => {
    const second = item({
      id: 'item-2',
      sequence: 2,
      name: '红包 B',
      quantity: 500,
      shipmentLines: [
        {
          quantity: 100,
          shipment: { id: 'shipment-1', sequence: 1 },
        },
        {
          quantity: 400,
          shipment: { id: 'shipment-2', sequence: 2 },
        },
      ],
    });
    const value = request({
      proposedChanges: {
        items: [
          { operation: 'UPDATE', itemId: 'item-1', quantity: 1_200 },
          { operation: 'UPDATE', itemId: 'item-2', quantity: 399 },
        ],
      },
      order: {
        ...request().order,
        items: [item(), second],
        shipments: [
          {
            id: 'shipment-1',
            sequence: 1,
            destinationProvince: '广东',
            weightKg: null,
          },
          {
            id: 'shipment-2',
            sequence: 2,
            destinationProvince: '湖南',
            weightKg: null,
          },
        ],
      },
    });
    locate(value);

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          expectedPriceRevision: 5,
          expectedQuoteToken: quoteToken,
        },
        admin,
      ),
    ).rejects.toThrow(/新数量不能少于多地址已分配数量 400/u);

    expect(mocks.calculate).not.toHaveBeenCalled();
    expectNoApprovalMutation();
  });

  it('批准规格变更时在锁内重验目录并原子更新完整产品身份', async () => {
    const value = request({
      proposedChanges: { items: [specificationChange()] },
    });
    locate(value);
    mocks.db.product.findMany.mockResolvedValue([catalogProduct()]);
    mocks.db.orderItem.findMany.mockResolvedValue([
      { subtotal: new Decimal(1_000) },
    ]);

    await expect(reviewOrderChangeRequest(
      {
        requestId: value.id,
        decision: 'APPROVE',
        reviewRemark: '确认目录规格',
        expectedPriceRevision: 5,
        expectedQuoteToken: quoteToken,
      },
      admin,
    )).resolves.toEqual({ id: 'request-1' });

    expect(mocks.db.product.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.calculate).toHaveBeenCalledTimes(1);
    const quoteArgs = mocks.calculate.mock.calls[0]?.[1] as ServiceArgs;
    expect(quoteArgs.facts.items).toContainEqual(expect.objectContaining({
      itemKey: 'item-1',
      productId: 'product-large',
      pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
      productStructure: OrderProductStructure.STANDARD_ENVELOPE,
      pricingGroup: 'LARGE',
      specification: '大号封90×165',
      actualWidthMm: 90,
      actualHeightMm: 165,
    }));
    expect(mocks.db.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        productId: 'product-large',
        specification: '大号封90×165',
        productStructure: OrderProductStructure.STANDARD_ENVELOPE,
        actualWidthMm: 90,
        actualHeightMm: 165,
        pricingGroup: 'LARGE',
        unitPrice: expect.any(String),
        subtotal: expect.any(String),
        pricingSnapshot: expect.any(Object),
      }),
    });
  });

  it.each([
    {
      label: '更新款式',
      source: item({
        productId: 'product-large',
        specification: '大号封',
        pricingGroup: 'MID',
        actualWidthMm: new Decimal(80),
        actualHeightMm: new Decimal(115),
      }),
      change: {
        operation: 'UPDATE' as const,
        itemId: 'item-1',
        name: '红包 A 新版',
        targetProductId: 'product-large',
        specification: '大号封',
      },
      itemKey: 'item-1',
      mutation: 'update' as const,
    },
    {
      label: '新增款式',
      source: item(),
      change: {
        operation: 'ADD' as const,
        templateItemId: 'item-1',
        name: '红包 B',
        quantity: 300,
        targetProductId: 'product-large',
        specification: '大号封',
        frontFoilColors: ['哑金'],
        backFoilColors: [],
      },
      itemKey: 'ADD:1',
      mutation: 'create' as const,
    },
  ])('无尺寸目录身份在$label的预览、凭证重算与落库中保持一致', async ({
    source,
    change,
    itemKey,
    mutation,
  }) => {
    const baseOrder = request().order;
    const value = request({
      order: { ...baseOrder, items: [source] },
      proposedChanges: { items: [change] },
    });
    mocks.db.product.findMany.mockResolvedValue([
      catalogProduct({ specification: '大号封' }),
    ]);
    locate(value);

    const preview = await previewOrderChangeRequestPricing(value.id, admin);

    expect(preview.quoteToken).toBe(quoteToken);
    expect(mocks.calculate).toHaveBeenCalledTimes(1);
    expect(
      (mocks.calculate.mock.calls[0]?.[1] as ServiceArgs).facts.items,
    ).toContainEqual(
      expect.objectContaining({
        itemKey,
        productId: 'product-large',
        productStructure: OrderProductStructure.STANDARD_ENVELOPE,
        pricingGroup: 'LARGE',
        specification: '大号封',
        actualWidthMm: null,
        actualHeightMm: null,
      }),
    );

    locate(value);
    mocks.db.orderItem.findMany.mockResolvedValue(
      mutation === 'create'
        ? [
            { subtotal: new Decimal(1_000) },
            { subtotal: new Decimal(300) },
          ]
        : [{ subtotal: new Decimal(1_000) }],
    );
    await reviewOrderChangeRequest(
      {
        requestId: value.id,
        decision: 'APPROVE',
        reviewRemark: '确认无尺寸目录规格',
        expectedPriceRevision: 5,
        expectedQuoteToken: preview.quoteToken ?? undefined,
      },
      admin,
    );

    expect(mocks.calculate).toHaveBeenCalledTimes(2);
    expect(
      (mocks.calculate.mock.calls[1]?.[1] as ServiceArgs).facts.items,
    ).toContainEqual(
      expect.objectContaining({
        itemKey,
        actualWidthMm: null,
        actualHeightMm: null,
      }),
    );
    const write =
      mutation === 'create'
        ? mocks.db.orderItem.create.mock.calls.at(-1)?.[0]
        : mocks.db.orderItem.update.mock.calls.find(
            ([call]) => call.where?.id === 'item-1',
          )?.[0];
    expect(write).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'product-large',
          productStructure: OrderProductStructure.STANDARD_ENVELOPE,
          pricingGroup: 'LARGE',
          specification: '大号封',
          actualWidthMm: null,
          actualHeightMm: null,
        }),
      }),
    );
  });

  it('批准时目标产品关联纸张已缺货则事务零写入', async () => {
    const value = request({
      proposedChanges: { items: [specificationChange()] },
    });
    locate(value);
    mocks.db.product.findMany.mockResolvedValue([
      catalogProduct({ paperMaterialId: 'paper-out-of-stock' }),
    ]);
    mocks.db.material.findMany.mockResolvedValue([{
      id: 'paper-out-of-stock',
      isActive: true,
      outOfStock: true,
    }]);

    await expect(reviewOrderChangeRequest(
      {
        requestId: value.id,
        decision: 'APPROVE',
        reviewRemark: null,
        expectedPriceRevision: 5,
      },
      admin,
    )).rejects.toThrow(/关联的纸张已停用或缺货/u);

    expect(mocks.calculate).not.toHaveBeenCalled();
    expectNoApprovalMutation();
  });

  it.each([
    {
      label: '目标产品审批前已停用或删除',
      products: [],
      change: specificationChange(),
      error: /目标报价产品不存在/u,
    },
    {
      label: '目标产品审批前变为不兼容路线',
      products: [catalogProduct({ category: 'COLOR_PRINT' })],
      change: specificationChange(),
      error: /计价路线不一致/u,
    },
    {
      label: '待审规格与目标产品目录不一致',
      products: [catalogProduct()],
      change: { ...specificationChange(), specification: '中号封80×115' },
      error: /规格不属于选中的报价产品/u,
    },
  ])('$label 时失败关闭且事务零写入', async ({ products, change, error }) => {
    const value = request({
      proposedChanges: { items: [change] },
    });
    locate(value);
    mocks.db.product.findMany.mockResolvedValue(products);

    await expect(reviewOrderChangeRequest(
      {
        requestId: value.id,
        decision: 'APPROVE',
        reviewRemark: null,
        expectedPriceRevision: 5,
      },
      admin,
    )).rejects.toThrow(error);

    expect(mocks.db.product.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.calculate).not.toHaveBeenCalled();
    expectNoApprovalMutation();
  });

  it('旧待审记录携带未变化规格但没有 targetProductId 时仍可批准', async () => {
    const value = request({
      proposedChanges: {
        items: [{
          operation: 'UPDATE',
          itemId: 'item-1',
          quantity: 1_200,
          specification: '中号封',
        }],
      },
    });
    locate(value);

    await expect(reviewOrderChangeRequest(
      {
        requestId: value.id,
        decision: 'APPROVE',
        reviewRemark: '兼容历史申请',
        expectedPriceRevision: 5,
        expectedQuoteToken: quoteToken,
      },
      admin,
    )).resolves.toEqual({ id: 'request-1' });

    expect(mocks.db.product.findMany).not.toHaveBeenCalled();
    const itemUpdate = mocks.db.orderItem.update.mock.calls[0]?.[0];
    expect(itemUpdate).toEqual({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        quantity: 1_200,
      }),
    });
    expect(itemUpdate?.data).not.toHaveProperty('specification');
  });

  it.each([
    {
      label: '缺少待核快递费',
      resolutions: [],
      error: /请补齐本次修改后的全部待核物流费/u,
    },
    {
      label: '伪造收费业务键',
      resolutions: [
        pendingShippingResolution({
          businessKey: 'SHIPMENT:9:SHIPPING_FEE',
        }),
      ],
      error: /不是本次预览的待核物流费/u,
    },
    {
      label: '伪造发货记录标识',
      resolutions: [
        pendingShippingResolution({ shipmentId: 'shipment-forged' }),
      ],
      error: /计价事实已变化/u,
    },
    {
      label: '伪造发货记录序号',
      resolutions: [pendingShippingResolution({ expectedSequence: 2 })],
      error: /计价事实已变化/u,
    },
    {
      label: '伪造投影分货数量',
      resolutions: [
        pendingShippingResolution({ expectedProjectedQuantity: 1_199 }),
      ],
      error: /计价事实已变化/u,
    },
    {
      label: '伪造计费省份',
      resolutions: [
        pendingShippingResolution({ expectedDestinationProvince: '湖南' }),
      ],
      error: /计价事实已变化/u,
    },
  ])('批准时$label将失败关闭且零写入', async ({
    resolutions,
    error,
  }) => {
    const value = request();
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pendingShippingResult(args, '1'),
    );

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          expectedPriceRevision: 5,
          expectedQuoteToken: quoteToken,
          pendingChargeResolutions: [...resolutions],
        },
        admin,
      ),
    ).rejects.toThrow(error);

    expectNoApprovalMutation();
  });

  it('首次未补待核快递费的预览凭证不能直接批准', async () => {
    const value = request();
    mocks.calculate.mockImplementation(
      async (_tx: unknown, args: ServiceArgs) =>
        pendingShippingResult(args, '1'),
    );
    locate(value);

    const preview = await previewOrderChangeRequestPricing(value.id, admin);

    expect(preview).toMatchObject({
      complete: false,
      quoteToken: approvalQuoteToken(),
      pendingCharges: [expect.objectContaining({ amount: null })],
    });

    locate(value);
    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          expectedPriceRevision: 5,
          expectedQuoteToken: preview.quoteToken ?? undefined,
          pendingChargeResolutions: [],
        },
        admin,
      ),
    ).rejects.toThrow(/请补齐本次修改后的全部待核物流费/u);

    expectNoApprovalMutation();
  });

  it.each([
    {
      label: '金额',
      submitted: pendingShippingResolution({ amount: '99.99' }),
      error: /人工物流核价内容已变化/u,
    },
    {
      label: '定价依据',
      submitted: pendingShippingResolution({ reason: '改用另一承运方报价' }),
      error: /人工物流核价内容已变化/u,
    },
    {
      label: '投影分货数量',
      submitted: pendingShippingResolution({ expectedProjectedQuantity: 1_199 }),
      error: /计价事实已变化/u,
    },
  ])('补录预览后修改$label时旧凭证零写失效', async ({
    submitted,
    error,
  }) => {
    const value = request();
    const previewed = pendingShippingResolution();
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pendingShippingResult(args, '1'),
    );

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          expectedPriceRevision: 5,
          expectedQuoteToken: approvalQuoteToken([previewed]),
          pendingChargeResolutions: [submitted],
        },
        admin,
      ),
    ).rejects.toThrow(error);

    expectNoApprovalMutation();
  });

  it.each([
    {
      label: '未携带价格版本',
      expectedPriceRevision: undefined,
      error: /必须先生成并确认最新价格预览/u,
    },
    {
      label: '价格版本已过期',
      expectedPriceRevision: 4,
      error: /价格版本已从 v4 更新为 v5/u,
    },
  ])('批准待核快递费时$label将零写入失败', async ({
    expectedPriceRevision,
    error,
  }) => {
    const value = request();
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pendingShippingResult(args, '1'),
    );

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          expectedPriceRevision,
          pendingChargeResolutions: [pendingShippingResolution()],
        },
        admin,
      ),
    ).rejects.toThrow(error);

    expectNoApprovalMutation();
  });

  it('原子批准人工快递费并写入可信快照、价格版本与审计日志', async () => {
    const value = request({
      order: {
        ...request().order,
        pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
        quotedPricingRevisionId: 'quoted-revision-v1',
        confirmedFee: null,
        settledFee: null,
      },
    });
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) =>
        pendingShippingResult(args, '1'),
    );
    mocks.db.orderCustomerCharge.aggregate.mockResolvedValueOnce({
      _sum: { amount: new Decimal('17.34') },
    });
    const resolution = pendingShippingResolution();

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: '确认超重快递费',
          expectedPriceRevision: 5,
          expectedQuoteToken: approvalQuoteToken([resolution]),
          pendingChargeResolutions: [resolution],
        },
        admin,
      ),
    ).resolves.toEqual({ id: 'request-1' });

    expect(mocks.db.orderCustomerCharge.update).toHaveBeenCalledWith({
      where: { id: 'shipping-1' },
      data: expect.objectContaining({
        priceBookId: priceVersion.logistics.id,
        amount: '12.34',
        overrideReason: resolution.reason,
        finalizedById: null,
        finalizedAt: null,
        pricingSnapshot: expect.objectContaining({
          source: 'ADMIN_SNAPSHOT_CONFIRMATION',
          status: 'ADMIN_CONFIRMED',
          previousPriceRevision: 5,
          actual: expect.objectContaining({
            amount: '12.34',
            overrideReason: resolution.reason,
            provisional: false,
            requiresAdminConfirmation: false,
            automatic: false,
          }),
          confirmation: expect.objectContaining({
            actorId: admin.id,
            confirmedAt: '2026-09-02T02:00:00.000Z',
            reason: resolution.reason,
          }),
        }),
      }),
    });
    expect(mocks.appendRevision).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        status: 'ADMIN_CONFIRMED',
        source: 'CHANGE_REQUEST_APPLIED_ADMIN_CONFIRMED',
        expectedPriceRevision: 5,
        orderFeeSnapshot: {
          quotedFee: value.order.quotedFee,
          confirmedFee: '1217.34',
          settledFee: null,
        },
        metadata: expect.objectContaining({
          preservedQuotedFee: '1008.00',
          quotedPricingRevisionId: 'quoted-revision-v1',
          confirmedFee: '1217.34',
          quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
          pureQuote: expect.objectContaining({
            knownTotal: '1205.00',
            pendingLineCodes: ['SHIPPING:1'],
            resolvedPendingLineCodes: ['SHIPPING:1'],
            unresolvedPendingLineCodes: [],
          }),
          administratorResolvedCharges: [
            {
              businessKey: resolution.businessKey,
              shipmentId: resolution.shipmentId,
              amount: resolution.amount,
              reason: resolution.reason,
            },
          ],
        }),
      }),
    );
    expect(mocks.db.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        revision: 3,
        processingAmount: '1200.00',
        totalAmount: '1217.34',
      }),
    });
    expect(mocks.db.order.update).toHaveBeenLastCalledWith({
      where: { id: 'order-1' },
      data: {
        confirmedFee: '1217.34',
        settledFee: null,
      },
    });
    expect(mocks.db.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CHANGE_REQUEST_APPROVED',
        changedFields: expect.objectContaining({
          totalAmount: { before: '1008', after: '1217.34' },
          administratorResolvedCharges: [
            {
              businessKey: resolution.businessKey,
              shipmentId: resolution.shipmentId,
              amount: resolution.amount,
              reason: resolution.reason,
            },
          ],
        }),
      }),
    });
  });

  it('已确认的 MODIFY 保留 quoted 快照并锁定新 confirmedFee/双价表/纸质版本', async () => {
    const quotedFee = new Decimal('1008.00');
    const plateCharge = {
      id: 'plate-confirmed',
      orderId: 'order-1',
      shipmentId: null,
      businessKey: PENDING_PLATE_BUSINESS_KEY,
      priceBookId: null,
      ...EMPTY_CHARGE_BASIS,
      status: OrderCustomerChargeStatus.ESTIMATED,
      amount: new Decimal('100.00'),
      pricingSnapshot: adminConfirmedChargeSnapshot({
        businessKey: PENDING_PLATE_BUSINESS_KEY,
        shipmentId: null,
        categoryCode: 'PLATE_MAKING_FEE',
        amount: '100.00',
        overrideReason: '已发生制版费',
      }),
      overrideReason: '已发生制版费',
      category: { code: 'PLATE_MAKING_FEE' },
    };
    const value = request({
      order: {
        ...request().order,
        status: OrderStatus.CONFIRMED,
        workOrderVersion: 2,
        scheduledAt: new Date('2026-09-01T01:00:00.000Z'),
        quotedFee,
        confirmedFee: new Decimal('1108.00'),
        settledFee: null,
        totalAmount: new Decimal('1108.00'),
        customerCharges: [...request().order.customerCharges, plateCharge],
      },
    });
    locate(value);
    mocks.db.orderCustomerCharge.aggregate.mockResolvedValueOnce({
      _sum: { amount: new Decimal('108.00') },
    });

    await reviewOrderChangeRequest(
      {
        requestId: value.id,
        decision: 'APPROVE',
        reviewRemark: '确认改量',
        expectedPriceRevision: 5,
        expectedQuoteToken: quoteToken,
      },
      admin,
    );

    expect(mocks.appendRevision).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        status: 'ADMIN_CONFIRMED',
        source: 'CHANGE_REQUEST_APPROVED_CURRENT_PUBLISHED',
        orderFeeSnapshot: {
          quotedFee,
          confirmedFee: '1308.00',
          settledFee: null,
        },
        metadata: expect.objectContaining({
          workOrderVersion: 3,
          confirmedFee: '1308.00',
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
          completedAt: null,
        }),
      }),
    );
    // 尚未下发：审批不改写下发边界，保留原值，待真正下发时再定。
    expect(
      mocks.db.order.update.mock.calls.some(
        ([call]) => call.data !== undefined && 'scheduledAt' in call.data,
      ),
    ).toBe(false);
    expect(mocks.db.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { confirmedFee: '1308.00', settledFee: null },
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

  it('生产版本批准在制版费待定且无可信历史覆盖时零写入失败', async () => {
    const value = request({
      order: { ...request().order, status: OrderStatus.CONFIRMED },
    });
    locate(value);

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          expectedPriceRevision: 5,
          expectedQuoteToken: quoteToken,
          decision: 'APPROVE',
          reviewRemark: null,
        },
        admin,
      ),
    ).rejects.toThrow(/新报价仍需制版费.*没有可验证且排他/u);
    expectNoApprovalMutation();
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
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          expectedPriceRevision: 5,
          expectedQuoteToken: quoteToken,
        },
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
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          expectedPriceRevision: 5,
          expectedQuoteToken: quoteToken,
        },
        admin,
      ),
    ).rejects.toThrow(
      /生产版本新增、移除或变更.*不能自动替换或重新计价/u,
    );
    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(mocks.db.order.update).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.update).not.toHaveBeenCalled();
  });

  it('生产版本批准保持烫金颜色但更换产品与规格时零写入拒绝', async () => {
    const value = request({
      proposedChanges: { items: [specificationChange()] },
      order: { ...request().order, status: OrderStatus.CONFIRMED },
    });
    locate(value);
    mocks.db.product.findMany.mockResolvedValue([catalogProduct()]);

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          expectedPriceRevision: 5,
          decision: 'APPROVE',
          reviewRemark: null,
        },
        admin,
      ),
    ).rejects.toThrow(/生产版本新增、移除或变更.*制版事实/u);
    expect(mocks.calculate).not.toHaveBeenCalled();
    expectNoApprovalMutation();
  });

  it('已下发 MODIFY 在同一事务升版、记录旧打印作废证据并创建 REPRINT', async () => {
    const value = request({
      order: {
        ...request().order,
        status: OrderStatus.RELEASED,
        workOrderVersion: 4,
        scheduledAt: new Date('2026-08-31T03:00:00.000Z'),
        completedAt: new Date('2026-09-01T08:00:00.000Z'),
        confirmedFee: new Decimal('1108.00'),
        settledFee: null,
        totalAmount: new Decimal('1108.00'),
        customerCharges: [
          ...request().order.customerCharges,
          {
            id: 'plate-confirmed',
            orderId: 'order-1',
            shipmentId: null,
            businessKey: PENDING_PLATE_BUSINESS_KEY,
            priceBookId: null,
            ...EMPTY_CHARGE_BASIS,
            status: OrderCustomerChargeStatus.ESTIMATED,
            amount: new Decimal('100.00'),
            pricingSnapshot: adminConfirmedChargeSnapshot({
              businessKey: PENDING_PLATE_BUSINESS_KEY,
              shipmentId: null,
              categoryCode: 'PLATE_MAKING_FEE',
              amount: '100.00',
              overrideReason: '已发生制版费',
            }),
            overrideReason: '已发生制版费',
            category: { code: 'PLATE_MAKING_FEE' },
          },
        ],
        productionOperations: [
          { id: 'operation-v4', reports: [{ id: 'report-v4' }] },
        ],
      },
    });
    locate(value);
    mocks.db.orderCustomerCharge.aggregate.mockResolvedValueOnce({
      _sum: { amount: new Decimal('108.00') },
    });
    mocks.supersedePrint.mockResolvedValueOnce({
      requestJobIds: ['old-print-v4'],
    });

    await reviewOrderChangeRequest(
      {
        requestId: value.id,
        decision: 'APPROVE',
        reviewRemark: null,
        expectedPriceRevision: 5,
        expectedQuoteToken: quoteToken,
      },
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
          scheduledAt: new Date('2026-09-02T02:00:00.000Z'),
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
    await expect(reviewOrderChangeRequest({
      requestId: value.id,
      decision: 'APPROVE',
      reviewRemark: null,
      expectedPriceRevision: 5,
    }, admin))
      .rejects.toThrow(/已有新报工记录/);
    expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it('旧 task 只作历史 guard', async () => {
    const value = request({ order: {
      ...request().order,
      items: [item({ tasks: [{ status: TaskStatus.IN_PROGRESS }] })],
    } });
    locate(value);
    await expect(reviewOrderChangeRequest({
      requestId: value.id,
      decision: 'APPROVE',
      reviewRemark: null,
      expectedPriceRevision: 5,
      expectedQuoteToken: quoteToken,
    }, admin))
      .rejects.toThrow(/已有开工或完工记录.*不能再修改数量/);
  });

  it.each([0, 88])('真实纯引擎默认零版费重算，保留人工版费 %s 元并确认完整金额', async (manualPlateFee) => {
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
    if (manualPlateFee > 0) {
      const charge = { ...EMPTY_CHARGE_BASIS, id: 'manual-plate', orderId: 'order-1', shipmentId: null,
        businessKey: PENDING_PLATE_BUSINESS_KEY, priceBookId: null, status: OrderCustomerChargeStatus.ESTIMATED,
        amount: new Decimal(manualPlateFee), category: { code: 'PLATE_MAKING_FEE' }, pricingSnapshot: {}, overrideReason: '实际制版费',
      };
      Object.assign(value.order, { customerCharges: [...value.order.customerCharges, charge] });
      mocks.db.orderCustomerCharge.findUnique.mockResolvedValue(charge);
    }
    locate(value);
    const state: {
      calculation: ReturnType<typeof realEngineResult> | null;
    } = { calculation: null };
    mocks.calculate.mockImplementationOnce(async (_tx, args: ServiceArgs) => {
      state.calculation = realEngineResult(args);
      mocks.db.orderCustomerCharge.aggregate.mockResolvedValue({ _sum: { amount: new Decimal(state.calculation.quote.order.knownAmount).plus(manualPlateFee) } });
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
          expectedPriceRevision: 5,
          expectedQuoteToken: quoteToken,
        },
        admin,
      ),
    ).resolves.toEqual({ id: 'request-1' });

    expect(state.calculation?.quote.order).toMatchObject({
      amount: state.calculation?.quote.order.knownAmount,
      lines: expect.arrayContaining([
        expect.objectContaining({
          code: 'PLATE_FEE',
          status: 'QUOTED',
          amount: '0.00',
        }),
      ]),
    });
    expect(mocks.db.orderItemPlateDetail.update).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.update.mock.calls.some(([arg]) => arg.where.id === 'manual-plate')).toBe(false);
    const expectedTotal = new Decimal(state.calculation!.quote.knownTotal).plus(manualPlateFee).toFixed(2);
    expect(mocks.db.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalAmount: expectedTotal }) }));
    if (manualPlateFee) {
      expect(mocks.appendRevision).toHaveBeenCalledWith(mocks.db, expect.objectContaining({ orderFeeSnapshot: {
        quotedFee: value.order.quotedFee, confirmedFee: expectedTotal, settledFee: null,
      } }));
    }
    expect(mocks.appendRevision).toHaveBeenCalledTimes(1);
    expect(mocks.appendRevision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: manualPlateFee ? 'ADMIN_CONFIRMED' : 'AUTO_CONFIRMED' }));
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
    await reviewOrderChangeRequest({
      requestId: value.id,
      decision: 'APPROVE',
      reviewRemark: null,
      expectedPriceRevision: 5,
      expectedQuoteToken: quoteToken,
    }, admin);
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
            // A complete legacy marker without the new row-bound identity is
            // still untrusted and must be replaced by the pending plate exit.
            pricingSnapshot: adminConfirmedSnapshot(),
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
      {
        requestId: value.id,
        decision: 'APPROVE',
        reviewRemark: null,
        expectedPriceRevision: 5,
        expectedQuoteToken: quoteToken,
      },
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
            orderId: 'order-1',
            shipmentId: null,
            ...EMPTY_CHARGE_BASIS,
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
      {
        requestId: value.id,
        decision: 'APPROVE',
        reviewRemark: null,
        expectedPriceRevision: 5,
        expectedQuoteToken: quoteToken,
      },
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
        where: { id: 'plate-detail-charge' },
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

  it('存量制版明细缺少关联收费时在任何 MODIFY 写入前失败关闭', async () => {
    const value = request();
    locate(value);
    mocks.db.orderItemPlateDetail.findMany.mockResolvedValueOnce([
      { id: 'orphan-plate-detail', amount: new Decimal('20.00') },
    ]);

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          expectedPriceRevision: 5,
          expectedQuoteToken: quoteToken,
        },
        admin,
      ),
    ).rejects.toThrow(/制版明细 orphan-plate-detail 缺少唯一关联收费/u);

    expectNoApprovalMutation();
  });

  it.each([['0.00', true], ['0.02', false]] as const)('改单半分复算允许舍入、固定费偏差 %s 的结果为 %s', async (fixedFee, allowed) => {
    const value = request({ proposedChanges: { items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 751 }] } });
    locate(value);
    mocks.calculate.mockImplementation(async (_tx: unknown, args: ServiceArgs) => {
      const result = pureResult(args, { plateApplies: false });
      result.quote.items[0].amount = '244.08';
      result.processing.items[0] = { ...result.processing.items[0], suggestedUnitPrice: '0.3250', suggestedFixedFee: fixedFee, suggestedSubtotal: '244.08' };
      return result;
    });
    mocks.db.orderItem.findMany.mockResolvedValue([{ subtotal: new Decimal('244.08') }]);
    const call = reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null, expectedPriceRevision: 5, expectedQuoteToken: quoteToken }, admin);
    if (allowed) await expect(call).resolves.toBeDefined();
    else await expect(call).rejects.toThrow('纯引擎分项与小计无法对平');
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
    await reviewOrderChangeRequest({
      requestId: value.id,
      decision: 'APPROVE',
      reviewRemark: null,
      expectedPriceRevision: 5,
      expectedQuoteToken: quoteToken,
    }, admin);
    expect(mocks.db.orderPackagingGroup.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: expect.objectContaining({
        actualBagCount: 120, unitPrice: '0.1000', subtotal: '12.00',
        pricingSnapshot: expect.objectContaining({ source: 'CHANGE_REQUEST_PURE_REQUOTE' }),
      }),
    });
  });

  it('每包数量修改参与整单报价并与包装明细原子保存', async () => {
    const value = request({ proposedChanges: { items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 1200, pack: 20 }] }, order: {
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
    await reviewOrderChangeRequest({
      requestId: value.id,
      decision: 'APPROVE',
      reviewRemark: null,
      expectedPriceRevision: 5,
      expectedQuoteToken: quoteToken,
    }, admin);
    expect(mocks.calculate.mock.calls[0][1].facts.packagingGroups[0].items).toEqual([{ itemKey: 'item-1', unitsPerBag: 20 }]);
    expect(mocks.db.orderItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pack: 20, quoteDisposition: 'PRICED', quotedAmount: '1200.00', pricingSnapshot: expect.objectContaining({ version: 1, engineVersion: 'CREATE_ORDER_PURE_V1' }) }) }));
    expect(mocks.db.orderPackagingGroupLine.updateMany).toHaveBeenCalledWith({ where: { orderId: 'order-1', orderItemId: 'item-1' }, data: { unitsPerBag: 20 } });
    expect(mocks.db.orderPackagingGroup.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: expect.objectContaining({
        actualBagCount: 60, unitPrice: '0.1000', subtotal: '6.00',
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
    await expect(reviewOrderChangeRequest({
      requestId: value.id,
      decision: 'APPROVE',
      reviewRemark: null,
      expectedPriceRevision: 5,
      expectedQuoteToken: quoteToken,
    }, admin))
      .rejects.toThrow(/物流分项与纯引擎输出不一致/);
    expectNoApprovalMutation();
  });

  it('物流 resolver 失败时 MODIFY 在首写入前失败关闭', async () => {
    const value = request();
    locate(value);
    mocks.finalizeCharges.mockRejectedValueOnce(new Error('物流解析失败'));

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          expectedPriceRevision: 5,
          expectedQuoteToken: quoteToken,
        },
        admin,
      ),
    ).rejects.toThrow(/物流解析失败/u);

    expectNoApprovalMutation();
  });

  it('物流价目簿版本漂移时 MODIFY 在首写入前失败关闭', async () => {
    const value = request();
    locate(value);
    mocks.finalizeCharges.mockResolvedValueOnce({
      priceBook: { ...priceVersion.logistics, version: 99 },
      charges: [],
      totalAmount: '8.00',
      requiresAdminConfirmation: false,
    });

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          expectedPriceRevision: 5,
          expectedQuoteToken: quoteToken,
        },
        admin,
      ),
    ).rejects.toThrow(/物流持久化与纯引擎价目簿版本不一致/u);

    expectNoApprovalMutation();
  });

  it('收费业务键与发货记录错链时在写入前失败关闭', async () => {
    const current = request();
    const value = request({
      order: {
        ...current.order,
        customerCharges: current.order.customerCharges.map((charge) =>
          charge.businessKey === 'SHIPMENT:1:SHIPPING_FEE'
            ? { ...charge, shipmentId: 'shipment-forged' }
            : charge,
        ),
      },
    });
    locate(value);

    await expect(
      reviewOrderChangeRequest(
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          expectedPriceRevision: 5,
          expectedQuoteToken: quoteToken,
        },
        admin,
      ),
    ).rejects.toThrow(/与收货地址的业务键、类目或发货记录不一致/u);

    expectNoApprovalMutation();
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
      {
        requestId: value.id,
        decision: 'APPROVE',
        reviewRemark: null,
        expectedPriceRevision: 5,
        expectedQuoteToken: quoteToken,
      },
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
      {
        requestId: value.id,
        decision: 'APPROVE',
        reviewRemark: null,
        expectedPriceRevision: 5,
        expectedQuoteToken: quoteToken,
      },
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
      {
        requestId: value.id,
        decision: 'APPROVE',
        reviewRemark: null,
        expectedPriceRevision: 5,
        expectedQuoteToken: quoteToken,
      },
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
        {
          requestId: value.id,
          decision: 'APPROVE',
          reviewRemark: null,
          expectedPriceRevision: 5,
        },
        admin,
      ),
    ).rejects.toThrow(/历史“生产中”.*请新建工单/u);
    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(mocks.db.orderItemPlateDetail.findMany).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.upsert).not.toHaveBeenCalled();
  });

  it('ADD 空白封目标身份决定投影规格及写库金额，不继承模板', async () => {
    const value = request({
      order: { ...request().order, status: OrderStatus.DRAFT, items: [item({
        pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
        specification: '大号封', pricingGroup: 'LARGE', hasLocalFoil: true,
        actualWidthMm: new Decimal(90), actualHeightMm: new Decimal(170),
        unitPrice: new Decimal('0.13'), subtotal: new Decimal('130'),
      })] },
      proposedChanges: { items: [{
        operation: 'ADD', templateItemId: 'item-1', name: '目标中号封', quantity: 300,
        targetBlankIdentity: {
          paperType: '珠光艳闪', paperWeightGsm: 160, specification: '中号封80×115',
        },
      }] },
    });
    locate(value);
    // 隔离目录/包装服务，只按实际收到的规格返回不同价格，避免固定金额掩盖投影回归。
    mocks.calculate.mockImplementation(async (_tx: unknown, args: ServiceArgs) => {
      const result = pureResult(args, { plateApplies: false });
      result.processing.items = args.facts.items.map((fact, index) => {
        const rate = fact.specification === '中号封80×115' ? '0.12' : '0.13';
        return { ...result.processing.items[index]!, suggestedUnitPrice: rate,
          suggestedSubtotal: new Decimal(rate).times(fact.quantity).toFixed(2) };
      });
      result.quote.items = result.quote.items.map((quoted, index) => {
        const priced = result.processing.items[index]!;
        return { ...quoted, unitPrice: priced.suggestedUnitPrice,
          amount: priced.suggestedSubtotal, processingAmount: priced.suggestedSubtotal,
          knownAmount: priced.suggestedSubtotal };
      });
      result.quote.total = result.quote.knownTotal = result.quote.items.reduce(
        (sum, quoted) => sum.plus(quoted.amount), new Decimal(result.quote.order.knownAmount),
      ).toFixed(2);
      return result;
    });
    mocks.db.orderItem.findMany.mockResolvedValue([
      { subtotal: new Decimal('130') }, { subtotal: new Decimal('36') },
    ]);
    await reviewOrderChangeRequest({
      requestId: value.id, decision: 'APPROVE', reviewRemark: null,
      expectedPriceRevision: 5, expectedQuoteToken: quoteToken,
    }, admin);
    const args = mocks.calculate.mock.calls[0]![1] as ServiceArgs;
    expect(args.facts.items[1]).toMatchObject({
      itemKey: 'ADD:1', productId: null, specification: '中号封80×115',
      pricingGroup: 'MID', productStructure: OrderProductStructure.STANDARD_ENVELOPE,
      actualWidthMm: 80, actualHeightMm: 115, quantity: 300,
    });
    expect(mocks.db.orderItem.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      data: expect.objectContaining({
        name: '目标中号封', productId: null, specification: '中号封80×115',
        pricingGroup: 'MID', actualWidthMm: 80, actualHeightMm: 115,
        unitPrice: '0.12', subtotal: '36.00', suggestedSubtotal: '36.00',
      }),
    }));
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
    await reviewOrderChangeRequest({
      requestId: value.id,
      decision: 'APPROVE',
      reviewRemark: null,
      expectedPriceRevision: 5,
      expectedQuoteToken: quoteToken,
    }, admin);
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
    await reviewOrderChangeRequest({
      requestId: value.id,
      decision: 'APPROVE',
      reviewRemark: null,
      expectedPriceRevision: 5,
    }, admin);
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
      expectedPriceRevision: 5,
      expectedQuoteToken: quoteToken,
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


describe('new blank business cannot inherit historical sale permission', () => {
  const copiedItem = { operation: 'ADD' as const, templateItemId: 'item-1', name: '原样复制', quantity: 300 };
  it('checks changed dimensions even when the specification text is unchanged', async () => {
    const value = createRequestOrder({ items: [item({
      pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
      specification: '中号封80×115', actualWidthMm: new Decimal(81),
    })] });
    mocks.db.order.findUnique.mockResolvedValue(value);
    mocks.admit.mockRejectedValue(new BlankPriceAdmissionError('空白封未启用'));
    await expect(createOrderChangeRequest({
      orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1, reason: '恢复标准尺寸',
      items: [{ operation: 'UPDATE', itemId: 'item-1', targetBlankIdentity: {
        paperType: '珠光艳闪', paperWeightGsm: 160, specification: '中号封80×115',
      } }],
    }, sales)).rejects.toThrow('未启用');
    expect(mocks.admit).toHaveBeenCalledWith(mocks.db, [expect.objectContaining({
      specification: '中号封80×115', actualWidthMm: 80, actualHeightMm: 115,
    })], expect.any(Date));
    expect(mocks.db.orderChangeRequest.create).not.toHaveBeenCalled();
  });
  it('does not treat an equivalent specification alias as new business', async () => {
    const value = createRequestOrder({ items: [item({
      pricingRoute: OrderItemPricingRoute.STOCK_BLANK, specification: '中号封', hasLocalFoil: true,
    })] });
    mocks.db.order.findUnique.mockResolvedValue(value);
    mocks.db.orderChangeRequest.create.mockResolvedValue({ id: 'request-alias' });
    mocks.admit.mockRejectedValue(new BlankPriceAdmissionError('空白封未启用'));
    await expect(createOrderChangeRequest({
      orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1, reason: '更正数量',
      items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 1200, targetBlankIdentity: {
        paperType: '160g珠光艳闪', paperWeightGsm: 160, specification: '中号封80×115',
      } }],
    }, sales)).resolves.toEqual({ id: 'request-alias' });
    expect(mocks.admit).not.toHaveBeenCalled();
  });
  it('checks copied template text during application even without a target product', async () => {
    const value = createRequestOrder();
    value.items[0]!.pricingRoute = OrderItemPricingRoute.STOCK_BLANK;
    mocks.db.order.findUnique.mockResolvedValue(value);
    mocks.admit.mockRejectedValue(new BlankPriceAdmissionError('空白封未启用'));
    await expect(createOrderChangeRequest({ orderId: 'order-1', expectedRevision: 2,
      expectedWorkOrderVersion: 1, reason: '复制', items: [copiedItem] }, sales)).rejects.toThrow('未启用');
    expect(mocks.admit).toHaveBeenCalledWith(mocks.db, [expect.objectContaining({ pricingRoute: 'STOCK_BLANK', paperType: value.items[0]!.paperType })], expect.any(Date));
    expect(mocks.db.orderChangeRequest.create).not.toHaveBeenCalled();
  });
  it.each(['preview', 'approve'])('checks copied template again during %s', async (operation) => {
    const value = request({ proposedChanges: { items: [copiedItem] } });
    value.order.items[0]!.pricingRoute = OrderItemPricingRoute.STOCK_BLANK;
    locate(value);
    mocks.admit.mockRejectedValue(new BlankPriceAdmissionError('空白封未启用'));
    const result = operation === 'preview'
      ? previewOrderChangeRequestPricing(value.id, admin)
      : reviewOrderChangeRequest({ requestId: value.id, decision: 'APPROVE', reviewRemark: null,
          expectedPriceRevision: 5, expectedQuoteToken: quoteToken }, admin);
    await expect(result).rejects.toThrow('未启用');
    expect(mocks.db.orderItem.create).not.toHaveBeenCalled();
  });
});

// 外部销售工单的快递 / 耗材收费明细在提交时才由 finalizeExternalOrderQuoteInTx
// 权威生成；尚未提交的草稿没有这些行。草稿改数量 / 规格不能因此被拒绝，
// 已提交工单缺行时仍必须失败关闭。
describe('unsubmitted external-sales draft modification', () => {
  type Requester = { id: string; displayName: string; role: Role };
  const salesRequester: Requester = { id: 'sales-1', displayName: '销售', role: Role.SALES };
  const adminRequester: Requester = { id: 'admin-1', displayName: '管理员', role: Role.ADMIN };
  function draftRequest(requester: Requester, overrides: Record<string, unknown> = {}) {
    return request({
      requesterId: requester.id,
      requester,
      order: {
        ...request().order,
        status: OrderStatus.DRAFT,
        pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
        quotedFee: null, confirmedFee: null, settledFee: null,
        processingAmount: new Decimal(0), packagingAmount: new Decimal(0), totalAmount: new Decimal(0),
        items: [plainPrintItem()],
        customerCharges: [],
        ...overrides,
      },
    });
  }

  it.each([
    ['外部销售本人草稿', salesRequester],
    ['管理员代外部销售建的草稿', adminRequester],
  ])('%s：预览只重算加工费，快递 / 耗材留到提交时权威生成', async (_label, requester) => {
    const value = draftRequest(requester);
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => pureResult(args, { plateApplies: false }),
    );
    const result = await previewOrderChangeRequestPricing(value.id, admin);
    expect((mocks.calculate.mock.calls[0]![1] as ServiceArgs).includeOrderCharges).toBe(false);
    expect(result).toMatchObject({ oldTotal: '0.00', newTotal: '1200.00', complete: true, pendingCharges: [] });
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });

  it.each([
    ['外部销售本人草稿', salesRequester],
    ['管理员代外部销售建的草稿', adminRequester],
  ])('%s：批准改数量不要求物流收费行，也不凭空生成物流行', async (_label, requester) => {
    const value = draftRequest(requester);
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => pureResult(args, { plateApplies: false }),
    );
    mocks.db.orderCustomerCharge.aggregate.mockResolvedValue({ _sum: { amount: null } });
    await reviewOrderChangeRequest(
      { requestId: value.id, decision: 'APPROVE', reviewRemark: null, expectedPriceRevision: 5, expectedQuoteToken: quoteToken },
      admin,
    );
    expect((mocks.calculate.mock.calls[0]![1] as ServiceArgs).includeOrderCharges).toBe(false);
    expect(mocks.finalizeCharges).not.toHaveBeenCalled();
    expect(mocks.db.orderCustomerCharge.upsert).not.toHaveBeenCalled();
    expect(mocks.db.order.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ processingAmount: '1200.00', totalAmount: '1200.00' }),
    }));
  });

  it('已提交外部销售工单缺少快递 / 耗材收费明细时仍在首写入前拒绝批准', async () => {
    const value = draftRequest(salesRequester, { status: OrderStatus.SUBMITTED });
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => pureResult(args, { plateApplies: false }),
    );
    await expect(reviewOrderChangeRequest(
      { requestId: value.id, decision: 'APPROVE', reviewRemark: null, expectedPriceRevision: 5, expectedQuoteToken: quoteToken },
      admin,
    )).rejects.toThrow('外部销售工单的快递/耗材收费明细不完整');
    expect((mocks.calculate.mock.calls[0]![1] as ServiceArgs).includeOrderCharges).toBe(true);
    expectNoApprovalMutation();
  });

  it('草稿已有物流收费行时仍按外部销售口径一并重算', async () => {
    const value = draftRequest(salesRequester, { customerCharges: request().order.customerCharges, totalAmount: new Decimal(8) });
    locate(value);
    mocks.calculate.mockImplementationOnce(
      async (_tx: unknown, args: ServiceArgs) => pureResult(args, { plateApplies: false }),
    );
    await previewOrderChangeRequestPricing(value.id, admin);
    expect((mocks.calculate.mock.calls[0]![1] as ServiceArgs).includeOrderCharges).toBe(true);
  });
});
