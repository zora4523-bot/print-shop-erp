import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import {
  CustomerPriceBookPurpose,
  OrderCustomerChargeStatus,
  OrderItemQuoteDisposition,
  OrderPackagingMode,
  OrderQuotedFeeCompleteness,
  OrderSettlementType,
  OrderStatus,
} from '../../generated/prisma/enums';
import { deriveExternalOrderChargeShipments } from '../price/external-order-charge-facts';
import {
  OrderCustomerChargeError,
  quoteExternalOrderChargesInTransaction,
  resolveExternalOrderChargesForProvisionalCreation,
} from '../price/order-charge-service';
import { quoteOrderPackagingGroups } from '../price/order-packaging-quote';
import {
  QuoteCatalogInvariantError,
  quoteOrderItems,
} from '../price/quote-service';
import { readExternalCreateOrderPriceSnapshot } from './create-order-price-snapshot';
import { createExternalOrderQuoteToken } from './create-order-quote-token';
import { summarizeExternalCreateOrderQuote } from './create-order-quote-summary';
import { orderCascadeLockKey } from './locks';
import { ORDER_PRICING_STATUS } from './pricing-status';
import { appendOrderPricingRevisionInTx } from './pricing-revision';

type MoneyLike = { toString(): string } | string | number;
const DECIMAL_12_2_MAX = new Decimal('9999999999.99');

type FinalizeOrderItem = {
  id: string;
  sequence: number;
  fig: number | null;
  name: string;
  productId: string | null;
  pricingRoute: import('../../generated/prisma/client').OrderItemPricingRoute;
  productStructure: import('../../generated/prisma/client').OrderProductStructure;
  artworkVersion: string | null;
  plateGroupId: string | null;
  pricingGroup: string | null;
  manualQuoteReason: string | null;
  specification: string | null;
  actualWidthMm: MoneyLike | null;
  actualHeightMm: MoneyLike | null;
  paperType: string | null;
  paperWeightGsm: number | null;
  quantity: number;
  crafts: string[];
  foilColors: string[];
  frontFoilColors: string[];
  backFoilColors: string[];
  foilTechnique: import('../../generated/prisma/client').OrderFoilTechnique;
  hasLocalFoil: boolean | null;
  lamination: import('../../generated/prisma/client').OrderLamination;
  printColors: string[];
  isDoubleSided: boolean;
  isDoubleColor: boolean;
  quoteDisposition: OrderItemQuoteDisposition | null;
  product: {
    paperMaterialId: string | null;
  } | null;
};

type FinalizedPriceVersionLockRow = {
  purpose: CustomerPriceBookPurpose;
  priceBookId: string;
  priceBookVersion: number;
  sourceSha256: string;
};

type FinalizeOrderRow = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  settlementType: OrderSettlementType;
  isSfCollect: boolean;
  priceRevision: number;
  processingAmount: MoneyLike;
  packagingAmount: MoneyLike;
  totalAmount: MoneyLike;
  quotedFee: MoneyLike | null;
  quotedFeeCompleteness: OrderQuotedFeeCompleteness | null;
  quotedPricingRevisionId: string | null;
  quotedPricingRevision: {
    id: string;
    revision: number;
    priceVersionLocks: FinalizedPriceVersionLockRow[];
  } | null;
  items: FinalizeOrderItem[];
  packagingGroups: Array<{
    id: string;
    sequence: number;
    name: string | null;
    mode: OrderPackagingMode;
    actualBagCount: number;
  }>;
  shipments: Array<{
    id: string;
    sequence: number;
    destinationProvince: string | null;
    weightKg: MoneyLike | null;
    lines: Array<{ orderItemId: string; quantity: number }>;
  }>;
  customerCharges: Array<{
    amount: MoneyLike | null;
    category: { code: string };
  }>;
};

export type FinalizedExternalOrderPriceVersion = {
  priceBookId: string;
  version: number;
  sourceSha256: string;
};

export type FinalizeExternalOrderQuoteResult = {
  orderId: string;
  pricingRevisionId: string;
  priceRevision: number;
  quotedFee: string;
  quotedFeeCompleteness: OrderQuotedFeeCompleteness;
  processingAmount: string;
  packagingAmount: string;
  logisticsAmount: string;
  totalAmount: string;
  manualItemIds: string[];
  priceVersions: {
    processing: FinalizedExternalOrderPriceVersion;
    logistics: FinalizedExternalOrderPriceVersion;
  };
  reused: boolean;
};

export class ExternalOrderQuoteFinalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalOrderQuoteFinalizeError';
  }
}

export class ExternalOrderQuoteChangedError extends Error {
  constructor(
    readonly quoteToken: string,
    readonly quotedFee: string,
    readonly quotedFeeCompleteness: OrderQuotedFeeCompleteness,
  ) {
    super('价目或报价结果已变化，请复核最新金额后再次提交');
    this.name = 'ExternalOrderQuoteChangedError';
  }
}

const finalizeOrderSelect = {
  id: true,
  orderNo: true,
  status: true,
  settlementType: true,
  isSfCollect: true,
  priceRevision: true,
  processingAmount: true,
  packagingAmount: true,
  totalAmount: true,
  quotedFee: true,
  quotedFeeCompleteness: true,
  quotedPricingRevisionId: true,
  quotedPricingRevision: {
    select: {
      id: true,
      revision: true,
      priceVersionLocks: {
        select: {
          purpose: true,
          priceBookId: true,
          priceBookVersion: true,
          sourceSha256: true,
        },
      },
    },
  },
  items: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      fig: true,
      name: true,
      productId: true,
      pricingRoute: true,
      productStructure: true,
      artworkVersion: true,
      plateGroupId: true,
      pricingGroup: true,
      manualQuoteReason: true,
      specification: true,
      actualWidthMm: true,
      actualHeightMm: true,
      paperType: true,
      paperWeightGsm: true,
      quantity: true,
      crafts: true,
      foilColors: true,
      frontFoilColors: true,
      backFoilColors: true,
      foilTechnique: true,
      hasLocalFoil: true,
      lamination: true,
      printColors: true,
      isDoubleSided: true,
      isDoubleColor: true,
      quoteDisposition: true,
      product: {
        select: {
          paperMaterialId: true,
        },
      },
    },
  },
  packagingGroups: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      name: true,
      mode: true,
      actualBagCount: true,
    },
  },
  shipments: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      destinationProvince: true,
      weightKg: true,
      lines: { select: { orderItemId: true, quantity: true } },
    },
  },
  customerCharges: {
    select: {
      amount: true,
      category: { select: { code: true } },
    },
  },
} as const;

function decimalText(
  value: MoneyLike | null | undefined,
  scale = 2,
): string | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed = new Decimal(value.toString());
    return parsed.isFinite() ? parsed.toFixed(scale) : null;
  } catch {
    return null;
  }
}

function assertStorableTotal(value: Decimal, label: string): void {
  if (!value.isFinite() || value.isNegative() || value.gt(DECIMAL_12_2_MAX)) {
    throw new ExternalOrderQuoteFinalizeError(`${label}超出系统可保存上限`);
  }
}

async function assertSelectedPapersAvailable(
  tx: Prisma.TransactionClient,
  items: readonly FinalizeOrderItem[],
): Promise<void> {
  const paperMaterialIds = [
    ...new Set(
      items.flatMap((item) =>
        item.product?.paperMaterialId ? [item.product.paperMaterialId] : [],
      ),
    ),
  ];
  const fallbackNames = [
    ...new Set(
      items.flatMap((item) =>
        !item.product?.paperMaterialId && item.paperType?.trim()
          ? [item.paperType.trim().toLocaleLowerCase('zh-CN')]
          : [],
      ),
    ),
  ];
  if (paperMaterialIds.length === 0 && fallbackNames.length === 0) return;

  type PaperAvailabilityRow = {
    id: string;
    name: string;
    normalizedName: string;
    isActive: boolean;
    outOfStock: boolean;
  };
  // The share lock closes the check/submit race: an operations update that
  // marks this paper unavailable waits until the order transaction commits.
  const papers = await tx.$queryRaw<PaperAvailabilityRow[]>`
    SELECT
      material."id",
      material."name",
      lower(btrim(material."name")) AS "normalizedName",
      material."isActive",
      material."outOfStock"
    FROM "Material" AS material
    WHERE material."category" = 'PAPER'::"MaterialCategory"
      AND (
        material."id" = ANY(${paperMaterialIds}::text[])
        OR lower(btrim(material."name")) = ANY(${fallbackNames}::text[])
      )
    FOR SHARE OF material
  `;
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const paperByName = new Map(
    papers.map((paper) => [paper.normalizedName, paper]),
  );
  const unavailableSelections = items.flatMap((item) => {
    const linkedId = item.product?.paperMaterialId;
    const paper = linkedId
      ? paperById.get(linkedId)
      : item.paperType?.trim()
        ? paperByName.get(item.paperType.trim().toLocaleLowerCase('zh-CN'))
        : undefined;
    if (!paper || (paper.isActive && !paper.outOfStock)) return [];
    const styleLabel = item.fig === null ? item.name : `第 ${item.fig} 款`;
    return [`${styleLabel}纸张“${paper.name}”`];
  });
  if (unavailableSelections.length > 0) {
    throw new ExternalOrderQuoteFinalizeError(
      `${unavailableSelections.join('、')}已缺货或停用，请重新选择纸张后再提交`,
    );
  }
}

function quoteItemInput(items: readonly FinalizeOrderItem[]) {
  return items.map((item) => ({
    productId: item.productId,
    pricingRoute: item.pricingRoute,
    productStructure: item.productStructure,
    artworkVersion: item.artworkVersion,
    plateGroupId: item.plateGroupId,
    pricingGroup: item.pricingGroup,
    manualQuoteReason: item.manualQuoteReason,
    specification: item.specification,
    actualWidthMm:
      item.actualWidthMm === null
        ? null
        : Number(decimalText(item.actualWidthMm, 2)),
    actualHeightMm:
      item.actualHeightMm === null
        ? null
        : Number(decimalText(item.actualHeightMm, 2)),
    paperType: item.paperType,
    paperWeightGsm: item.paperWeightGsm,
    quantity: item.quantity,
    crafts: item.crafts,
    foilColors: item.foilColors,
    frontFoilColors: item.frontFoilColors,
    backFoilColors: item.backFoilColors,
    foilTechnique: item.foilTechnique,
    hasLocalFoil: item.hasLocalFoil,
    lamination: item.lamination,
    printColors: item.printColors,
    isDoubleSided: item.isDoubleSided,
    isDoubleColor: item.isDoubleColor,
  }));
}

function shipmentFacts(order: FinalizeOrderRow) {
  return deriveExternalOrderChargeShipments({
    isSfCollect: order.isSfCollect,
    items: order.items.map((item) => ({
      itemKey: item.id,
      quantity: item.quantity,
      paperWeightGsm: item.paperWeightGsm,
      paperType: item.paperType,
      productStructure: item.productStructure,
    })),
    shipments: order.shipments.map((shipment) => ({
      shipmentKey: String(shipment.sequence),
      province: shipment.destinationProvince,
      // weightKg is a server-owned fulfilment fact. Browser-owned
      // quotedWeightKg is deliberately never selected by this service.
      billableWeightKg: decimalText(shipment.weightKg, 3),
      itemQuantities: order.items.map((item) =>
        shipment.lines.reduce(
          (sum, line) =>
            line.orderItemId === item.id ? sum + line.quantity : sum,
          0,
        ),
      ),
    })),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function chargeRequiresManual(snapshot: Prisma.InputJsonObject): boolean {
  const actual: unknown = snapshot.actual;
  return isRecord(actual) && actual.requiresAdminConfirmation === true;
}

function priceVersionFromLocks(
  locks: FinalizedPriceVersionLockRow[],
  purpose: CustomerPriceBookPurpose,
): FinalizedExternalOrderPriceVersion {
  const matches = locks.filter((lock) => lock.purpose === purpose);
  if (matches.length !== 1) {
    throw new ExternalOrderQuoteFinalizeError(
      '工单已报价，但价目版本锁不完整',
    );
  }
  const lock = matches[0]!;
  return {
    priceBookId: lock.priceBookId,
    version: lock.priceBookVersion,
    sourceSha256: lock.sourceSha256,
  };
}

function resultFromExisting(order: FinalizeOrderRow): FinalizeExternalOrderQuoteResult {
  const revision = order.quotedPricingRevision;
  const quotedFee = decimalText(order.quotedFee);
  if (
    !order.quotedPricingRevisionId ||
    !revision ||
    revision.id !== order.quotedPricingRevisionId ||
    quotedFee === null ||
    order.quotedFeeCompleteness === null
  ) {
    throw new ExternalOrderQuoteFinalizeError('工单已报价，但报价快照不完整');
  }
  const logisticsAmount = order.customerCharges
    .filter((charge) =>
      ['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(
        String(charge.category.code),
      ),
    )
    .reduce(
      (sum, charge) =>
        charge.amount === null ? sum : sum.plus(charge.amount.toString()),
      new Decimal(0),
    )
    .toFixed(2);
  return {
    orderId: order.id,
    pricingRevisionId: revision.id,
    priceRevision: revision.revision,
    quotedFee,
    quotedFeeCompleteness: order.quotedFeeCompleteness,
    processingAmount: decimalText(order.processingAmount) ?? '0.00',
    packagingAmount: decimalText(order.packagingAmount) ?? '0.00',
    logisticsAmount,
    totalAmount: decimalText(order.totalAmount) ?? quotedFee,
    manualItemIds: order.items
      .filter(
        (item) =>
          item.quoteDisposition ===
          OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED,
      )
      .map((item) => item.id),
    priceVersions: {
      processing: priceVersionFromLocks(
        revision.priceVersionLocks,
        CustomerPriceBookPurpose.PROCESSING,
      ),
      logistics: priceVersionFromLocks(
        revision.priceVersionLocks,
        CustomerPriceBookPurpose.LOGISTICS,
      ),
    },
    reused: true,
  };
}

async function readOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<FinalizeOrderRow | null> {
  const orderModel = tx.order as unknown as {
    findUnique(args: unknown): Promise<FinalizeOrderRow | null>;
  };
  return orderModel.findUnique({
    where: { id: orderId },
    select: finalizeOrderSelect,
  });
}

/**
 * Finalize the server-owned external-sales quote inside the caller's order
 * submission transaction. The caller remains responsible for the subsequent
 * DRAFT -> PENDING_FACTORY status transition.
 */
export async function finalizeExternalOrderQuoteInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  actorId: string,
  now: Date,
  expectedQuoteToken?: string | null,
): Promise<FinalizeExternalOrderQuoteResult> {
  if (!orderId.trim() || !actorId.trim() || Number.isNaN(now.getTime())) {
    throw new ExternalOrderQuoteFinalizeError('提交报价参数无效');
  }

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
    orderId,
  )}))`;

  const order = await readOrder(tx, orderId);
  if (!order) throw new ExternalOrderQuoteFinalizeError('工单不存在');
  if (order.quotedPricingRevisionId) return resultFromExisting(order);
  if (order.settlementType !== OrderSettlementType.EXTERNAL_SALES) {
    throw new ExternalOrderQuoteFinalizeError('仅外部销售工单需要生成提交报价');
  }
  if (order.status !== OrderStatus.DRAFT) {
    throw new ExternalOrderQuoteFinalizeError('只能为草稿工单生成提交报价');
  }
  if (order.items.length === 0) {
    throw new ExternalOrderQuoteFinalizeError('工单至少需要一个款式');
  }
  if (order.shipments.length === 0) {
    throw new ExternalOrderQuoteFinalizeError('工单至少需要一个发货地址');
  }
  // Paper stock is operational state, so the create-page snapshot is never
  // authoritative at submit time. Re-read it through the persisted product
  // selection in this transaction and fail before any financial write.
  await assertSelectedPapersAvailable(tx, order.items);

  const priceSnapshot = await readExternalCreateOrderPriceSnapshot(tx, {
    now,
  });
  let itemQuotes: Awaited<ReturnType<typeof quoteOrderItems>>;
  try {
    itemQuotes = await quoteOrderItems(
      quoteItemInput(order.items),
      OrderSettlementType.EXTERNAL_SALES,
      now,
      tx,
      { orderItemCount: order.items.length },
    );
  } catch (error) {
    if (error instanceof QuoteCatalogInvariantError) {
      throw new ExternalOrderQuoteFinalizeError(error.message);
    }
    throw error;
  }
  if (itemQuotes.length !== order.items.length) {
    throw new ExternalOrderQuoteFinalizeError('加工费报价与工单款式数不一致');
  }
  for (const quote of itemQuotes) {
    if (quote.snapshot.priceBook?.id !== priceSnapshot.processing.id) {
      throw new ExternalOrderQuoteFinalizeError('加工费报价未锁定当前唯一价目版本');
    }
  }

  const packagingQuote = await quoteOrderPackagingGroups(
    order.packagingGroups.map((group) => ({
      groupKey: group.id,
      mode: group.mode,
      actualBagCount: group.actualBagCount,
    })),
    OrderSettlementType.EXTERNAL_SALES,
    now,
    tx,
    { snapshotLockHeld: true },
  );
  if (
    packagingQuote.priceBook &&
    packagingQuote.priceBook.id !== priceSnapshot.processing.id
  ) {
    throw new ExternalOrderQuoteFinalizeError('入袋费与款式未使用同一加工费价目版本');
  }

  const derivedShipments = shipmentFacts(order);
  const logisticsPreview = await quoteExternalOrderChargesInTransaction(
    tx,
    {
      isSfCollect: order.isSfCollect,
      shipments: derivedShipments,
    },
    now,
    { snapshotLockHeld: true },
  );
  if (logisticsPreview.priceBook.id !== priceSnapshot.logistics.id) {
    throw new ExternalOrderQuoteFinalizeError('物流报价未锁定当前唯一价目版本');
  }

  const currentQuoteToken = createExternalOrderQuoteToken({
    items: quoteItemInput(order.items),
    packagingGroups: order.packagingGroups.map((group) => ({
      groupKey: group.id,
      mode: group.mode,
      actualBagCount: group.actualBagCount,
    })),
    logistics: {
      isSfCollect: order.isSfCollect,
      shipments: derivedShipments,
    },
    priceVersion: priceSnapshot,
    result: {
      items: itemQuotes,
      packaging: packagingQuote,
      logistics: logisticsPreview.quote,
    },
  });
  if (expectedQuoteToken !== currentQuoteToken) {
    const summary = summarizeExternalCreateOrderQuote({
      items: itemQuotes,
      packaging: packagingQuote,
      logistics: logisticsPreview.quote,
    });
    throw new ExternalOrderQuoteChangedError(
      currentQuoteToken,
      summary.knownTotal,
      summary.totalSemantics === 'COMPLETE'
        ? OrderQuotedFeeCompleteness.COMPLETE
        : OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
    );
  }

  let logistics: Awaited<
    ReturnType<typeof resolveExternalOrderChargesForProvisionalCreation>
  >;
  try {
    logistics = await resolveExternalOrderChargesForProvisionalCreation(
      tx,
      {
        isSfCollect: order.isSfCollect,
        shipments: derivedShipments.map((shipment) => ({
          ...shipment,
          // Finalization has no client amount input. Null means: use the
          // current server quote when complete, otherwise stay pending.
          shippingFee: null,
          packingMaterialFee: null,
          overrideReason: null,
        })),
      },
      now,
      { snapshotLockHeld: true },
    );
  } catch (error) {
    if (error instanceof OrderCustomerChargeError) {
      throw new ExternalOrderQuoteFinalizeError(error.message);
    }
    throw error;
  }
  if (logistics.priceBook.id !== priceSnapshot.logistics.id) {
    throw new ExternalOrderQuoteFinalizeError('物流报价未锁定当前唯一价目版本');
  }

  const manualItemIds: string[] = [];
  let knownItemAmount = new Decimal(0);
  for (const [index, item] of order.items.entries()) {
    const quote = itemQuotes[index]!;
    const complete =
      quote.complete &&
      quote.suggestedUnitPrice !== null &&
      quote.suggestedFixedFee !== null &&
      quote.suggestedSubtotal !== null;
    if (complete) {
      const unitPrice = quote.suggestedUnitPrice!;
      const fixedFee = quote.suggestedFixedFee!;
      const subtotal = quote.suggestedSubtotal!;
      knownItemAmount = knownItemAmount.plus(subtotal);
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          quoteDisposition: OrderItemQuoteDisposition.PRICED,
          quotedAmount: subtotal,
          unitPrice,
          fixedFee,
          subtotal,
          suggestedSubtotal: subtotal,
          priceOverrideReason: null,
          pricingSnapshot: {
            ...quote.snapshot,
            source: 'EXTERNAL_SUBMIT_QUOTE',
            actual: {
              unitPrice,
              fixedFee,
              subtotal,
              overrideReason: null,
              provisional: false,
            },
          } satisfies Prisma.InputJsonObject,
        },
      });
    } else {
      manualItemIds.push(item.id);
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          quoteDisposition:
            OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED,
          quotedAmount: null,
          suggestedSubtotal: null,
          priceOverrideReason: null,
          // Legacy non-null amount columns are not interpreted as the
          // canonical quote for a manual item. We intentionally avoid writing
          // a fabricated zero; disposition + quotedAmount are authoritative.
          pricingSnapshot: {
            ...quote.snapshot,
            source: 'EXTERNAL_SUBMIT_MANUAL_REQUIRED',
            actual: {
              amount: null,
              overrideReason: null,
              provisional: true,
            },
          } satisfies Prisma.InputJsonObject,
        },
      });
    }
  }

  let knownPackagingAmount = new Decimal(0);
  let hasManualPackaging = false;
  for (const [index, group] of order.packagingGroups.entries()) {
    const quote = packagingQuote.groups[index];
    if (!quote || quote.groupKey !== group.id) {
      throw new ExternalOrderQuoteFinalizeError(
        `包装组 ${group.sequence} 报价与工单不一致`,
      );
    }
    const complete =
      quote.complete &&
      quote.suggestedUnitPrice !== null &&
      quote.suggestedSubtotal !== null;
    if (complete) {
      const unitPrice = quote.suggestedUnitPrice!;
      const subtotal = quote.suggestedSubtotal!;
      knownPackagingAmount = knownPackagingAmount.plus(subtotal);
      await tx.orderPackagingGroup.update({
        where: { id: group.id },
        data: {
          unitPrice,
          subtotal,
          suggestedSubtotal: subtotal,
          priceOverrideReason: null,
          pricingSnapshot: {
            ...quote.snapshot,
            source: 'EXTERNAL_SUBMIT_QUOTE',
            actual: {
              unitPrice,
              subtotal,
              overrideReason: null,
              provisional: false,
            },
          } satisfies Prisma.InputJsonObject,
        },
      });
    } else {
      hasManualPackaging = true;
      await tx.orderPackagingGroup.update({
        where: { id: group.id },
        data: {
          suggestedSubtotal: null,
          priceOverrideReason: null,
          pricingSnapshot: {
            ...quote.snapshot,
            source: 'EXTERNAL_SUBMIT_MANUAL_REQUIRED',
            actual: {
              amount: null,
              overrideReason: null,
              provisional: true,
            },
          } satisfies Prisma.InputJsonObject,
        },
      });
    }
  }

  const shipmentIdByKey = new Map(
    order.shipments.map((shipment) => [String(shipment.sequence), shipment.id]),
  );
  let knownLogisticsAmount = new Decimal(0);
  let hasManualLogistics = false;
  for (const charge of logistics.charges) {
    const shipmentId = shipmentIdByKey.get(charge.shipmentKey);
    if (!shipmentId) {
      throw new ExternalOrderQuoteFinalizeError('物流收费与工单发货地址不一致');
    }
    const requiresManual = chargeRequiresManual(charge.pricingSnapshot);
    const amount = requiresManual ? null : charge.amount;
    if (requiresManual) {
      hasManualLogistics = true;
    } else {
      knownLogisticsAmount = knownLogisticsAmount.plus(charge.amount);
    }
    const status = requiresManual
      ? OrderCustomerChargeStatus.PENDING_AMOUNT
      : charge.status;
    const waived = status === OrderCustomerChargeStatus.WAIVED;
    const actual = isRecord(charge.pricingSnapshot.actual)
      ? charge.pricingSnapshot.actual
      : {};
    const pricingSnapshot = {
      ...charge.pricingSnapshot,
      source: requiresManual
        ? 'EXTERNAL_SUBMIT_MANUAL_REQUIRED'
        : 'EXTERNAL_SUBMIT_QUOTE',
      actual: {
        ...actual,
        amount,
        overrideReason: null,
        provisional: requiresManual,
        requiresAdminConfirmation: requiresManual,
      },
    } satisfies Prisma.InputJsonObject;
    await tx.orderCustomerCharge.upsert({
      where: {
        orderId_businessKey: {
          orderId: order.id,
          businessKey: charge.businessKey,
        },
      },
      create: {
        orderId: order.id,
        shipmentId,
        categoryId: charge.categoryId,
        priceBookId: charge.priceBookId,
        sourceRuleId: charge.sourceRuleId,
        businessKey: charge.businessKey,
        status,
        description: charge.description,
        quantity: charge.quantity,
        unit: charge.unit,
        unitPrice: null,
        suggestedAmount: charge.suggestedAmount,
        amount,
        pricingSnapshot,
        overrideReason: null,
        createdById: actorId,
        finalizedById: waived ? actorId : null,
        finalizedAt: waived ? now : null,
      },
      update: {
        shipmentId,
        categoryId: charge.categoryId,
        priceBookId: charge.priceBookId,
        sourceRuleId: charge.sourceRuleId,
        status,
        description: charge.description,
        quantity: charge.quantity,
        unit: charge.unit,
        unitPrice: null,
        suggestedAmount: charge.suggestedAmount,
        amount,
        pricingSnapshot,
        overrideReason: null,
        finalizedById: waived ? actorId : null,
        finalizedAt: waived ? now : null,
      },
    });
  }

  const knownProcessingAmount = knownItemAmount.plus(knownPackagingAmount);
  const knownTotalAmount = knownProcessingAmount.plus(knownLogisticsAmount);
  assertStorableTotal(knownPackagingAmount, '入袋费合计');
  assertStorableTotal(knownProcessingAmount, '加工费合计');
  assertStorableTotal(knownLogisticsAmount, '物流费合计');
  assertStorableTotal(knownTotalAmount, '工单已知费用合计');
  const packagingAmount = knownPackagingAmount.toFixed(2);
  const processingAmount = knownProcessingAmount.toFixed(2);
  const logisticsAmount = knownLogisticsAmount.toFixed(2);
  const totalAmount = knownTotalAmount.toFixed(2);
  const hasManual =
    manualItemIds.length > 0 || hasManualPackaging || hasManualLogistics;
  const quotedFeeCompleteness = hasManual
    ? OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS
    : OrderQuotedFeeCompleteness.COMPLETE;
  const pricingStatus = hasManual
    ? ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION
    : ORDER_PRICING_STATUS.AUTO_CONFIRMED;

  // The quoted-fee shape check requires quotedPricingRevisionId at the same
  // time as quotedFee. Persist the legacy visible totals first so the immutable
  // revision can fresh-read them, then link all canonical quote fields in one
  // final update after the revision and its two version locks exist.
  await tx.order.update({
    where: { id: order.id },
    data: { packagingAmount, processingAmount, totalAmount },
    select: { id: true },
  });
  const revision = await appendOrderPricingRevisionInTx(tx, {
    orderId: order.id,
    status: pricingStatus,
    source: 'EXTERNAL_SUBMIT_QUOTE',
    actorId,
    now,
    expectedPriceRevision: order.priceRevision,
    metadata: {
      priceBooks: priceSnapshot,
      quotedFee: totalAmount,
      quotedFeeCompleteness,
      knownAmounts: {
        items: knownItemAmount.toFixed(2),
        packaging: packagingAmount,
        logistics: logisticsAmount,
      },
      manualItemIds,
      hasManualPackaging,
      hasManualLogistics,
    },
  });
  await tx.orderPriceVersionLock.createMany({
    data: [
      {
        pricingRevisionId: revision.pricingRevisionId,
        purpose: CustomerPriceBookPurpose.PROCESSING,
        priceBookId: priceSnapshot.processing.id,
        priceBookVersion: priceSnapshot.processing.version,
        sourceSha256: priceSnapshot.processing.sourceSha256,
        createdAt: now,
      },
      {
        pricingRevisionId: revision.pricingRevisionId,
        purpose: CustomerPriceBookPurpose.LOGISTICS,
        priceBookId: priceSnapshot.logistics.id,
        priceBookVersion: priceSnapshot.logistics.version,
        sourceSha256: priceSnapshot.logistics.sourceSha256,
        createdAt: now,
      },
    ],
  });
  await tx.order.update({
    where: { id: order.id },
    data: {
      quotedFee: totalAmount,
      quotedFeeCompleteness,
      quotedPricingRevisionId: revision.pricingRevisionId,
    },
    select: { id: true },
  });

  return {
    orderId: order.id,
    pricingRevisionId: revision.pricingRevisionId,
    priceRevision: revision.priceRevision,
    quotedFee: totalAmount,
    quotedFeeCompleteness,
    processingAmount,
    packagingAmount,
    logisticsAmount,
    totalAmount,
    manualItemIds,
    priceVersions: {
      processing: {
        priceBookId: priceSnapshot.processing.id,
        version: priceSnapshot.processing.version,
        sourceSha256: priceSnapshot.processing.sourceSha256,
      },
      logistics: {
        priceBookId: priceSnapshot.logistics.id,
        version: priceSnapshot.logistics.version,
        sourceSha256: priceSnapshot.logistics.sourceSha256,
      },
    },
    reused: false,
  };
}
