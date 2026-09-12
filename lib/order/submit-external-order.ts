import { externalShipmentContactIssues } from './external-shipment-contact';
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
import {
  OrderCustomerChargeError,
  resolveExternalOrderChargesForProvisionalCreation,
} from '../price/order-charge-service';
import {
  calculateExternalOrderCharges,
  type ExternalOrderChargeLine,
  type ExternalOrderChargeQuote,
} from '../price/external-order-charges';
import { calculateCreateOrderQuote } from '../price/create-order';
import type {
  CreateOrderPriceSnapshot,
  CreateOrderQuoteInput,
  CreateOrderQuoteResult,
} from '../price/create-order/types';
import {
  buildCreateOrderQuoteInputFromCatalog,
  catalogPaperPricingFacts,
  type CreateOrderQuoteFactsAdapterInput,
  CreateOrderQuoteFactsAdapterError,
} from './create-order-quote-facts-adapter';
import { canonicalizeCreateOrderPaperFact } from '../price/create-order/canonical-facts';
import { acquirePriceRuleSnapshotReadLock } from '../price/rule-snapshot-lock';
import { normalizeCatalogPricingText } from './catalog-pricing-facts';
import { presentCreateOrderQuote } from './create-order-quote-presentation';
import { createExternalOrderQuoteToken } from './create-order-quote-token';
import { buildCreateOrderExternalChargeInput } from './create-order-charge-input';
import {
  PublishedCreateOrderPriceAdapterError,
  readPublishedCreateOrderPriceSnapshot,
} from './create-order-published-rule-adapter';
import { orderCascadeLockKey } from './locks';
import { ORDER_PRICING_STATUS } from './pricing-status';
import { isNewOrderPricingRoute } from './pricing-route';
import { appendOrderPricingRevisionInTx } from './pricing-revision';
import {
  PendingPlateChargeError,
  quoteHasPendingPlateCharge,
  requireActivePlateCategoryIdInTx,
  upsertPendingPlateChargeInTx,
} from './pending-plate-charge';

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
    lines: Array<{ orderItemId: string; unitsPerBag: number }>;
  }>;
  shipments: Array<{
    id: string;
    sequence: number;
    receiverName: string | null;
    receiverPhone: string | null;
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
      lines: {
        orderBy: { orderItem: { sequence: 'asc' } },
        select: { orderItemId: true, unitsPerBag: true },
      },
    },
  },
  shipments: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      receiverName: true,
      receiverPhone: true,
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
  if (items.length === 0) return;

  type PaperAvailabilityRow = {
    id: string;
    name: string;
    specification: string | null;
    isActive: boolean;
    outOfStock: boolean;
  };
  // The caller holds the shared price-snapshot advisory lock. Every supported
  // PAPER identity writer takes its exclusive counterpart, so this full read
  // cannot race create/rename/deactivation or gain a phantom alias. Do not add
  // a Material row lock here: inventory movements lock and update Material
  // rows without taking that advisory lock, and the two lock domains can form
  // an ABBA deadlock. Inventory-only fields are not used for identity matching.
  const papers = await tx.$queryRaw<PaperAvailabilityRow[]>`
    SELECT
      material."id",
      material."name",
      material."specification",
      material."isActive",
      material."outOfStock"
    FROM "Material" AS material
    WHERE material."category" = 'PAPER'::"MaterialCategory"
  `;
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const invalidSelections: string[] = [];
  const unavailableSelections: string[] = [];
  for (const item of items) {
    const styleLabel = item.fig === null ? item.name : `第 ${item.fig} 款`;
    const linkedId = item.product?.paperMaterialId;
    let matches: PaperAvailabilityRow[];
    if (linkedId) {
      const linkedPaper = paperById.get(linkedId);
      matches = linkedPaper ? [linkedPaper] : [];
    } else {
      const submitted = canonicalizeCreateOrderPaperFact(
        item.paperType ?? '',
        item.paperWeightGsm,
      );
      matches = submitted
        ? papers.filter((paper) =>
            catalogPaperPricingFacts(paper).some(
              (fact) =>
                normalizeCatalogPricingText(fact.paperType) ===
                  normalizeCatalogPricingText(submitted.paperType) &&
                fact.paperWeightGsm === submitted.paperWeightGsm,
            ),
          )
        : [];
    }
    if (matches.length !== 1) {
      invalidSelections.push(`${styleLabel}纸张目录身份不存在或不唯一`);
      continue;
    }
    const paper = matches[0]!;
    if (!paper.isActive || paper.outOfStock) {
      unavailableSelections.push(`${styleLabel}纸张“${paper.name}”`);
    }
  }
  if (invalidSelections.length > 0) {
    throw new ExternalOrderQuoteFinalizeError(
      `${invalidSelections.join('、')}，请重新选择纸张后再提交`,
    );
  }
  if (unavailableSelections.length > 0) {
    throw new ExternalOrderQuoteFinalizeError(
      `${unavailableSelections.join('、')}已缺货或停用，请重新选择纸张后再提交`,
    );
  }
}

function persistedItemKey(item: FinalizeOrderItem): string {
  return String(item.sequence);
}

function persistedQuoteFacts(
  order: FinalizeOrderRow,
): CreateOrderQuoteFactsAdapterInput {
  const itemKeyById = new Map(
    order.items.map((item) => [item.id, persistedItemKey(item)]),
  );
  return {
    items: order.items.map((item) => {
      if (item.fig === null) {
        throw new ExternalOrderQuoteFinalizeError(
          `款式 ${item.sequence} 缺少稳定 fig，无法生成提交报价`,
        );
      }
      if (!isNewOrderPricingRoute(item.pricingRoute)) {
        throw new ExternalOrderQuoteFinalizeError(
          `款式 ${item.sequence} 的计价路线不支持自动报价`,
        );
      }
      if (item.manualQuoteReason?.trim()) {
        throw new ExternalOrderQuoteFinalizeError(
          `款式 ${item.sequence} 携带配置外备注，外部销售不能直接提交`,
        );
      }
      return {
        itemKey: persistedItemKey(item),
        fig: item.fig,
        productId: item.productId,
        pricingRoute: item.pricingRoute,
        productStructure: item.productStructure,
        pricingGroup: item.pricingGroup,
        specification: item.specification,
        actualWidthMm: item.actualWidthMm,
        actualHeightMm: item.actualHeightMm,
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
      };
    }),
    packagingGroups: order.packagingGroups.map((group) => ({
      groupKey: String(group.sequence),
      mode: group.mode,
      items: group.lines.map((line) => {
        const itemKey = itemKeyById.get(line.orderItemId);
        if (!itemKey) {
          throw new ExternalOrderQuoteFinalizeError(
            `包装组 ${group.sequence} 引用了未知款式`,
          );
        }
        return { itemKey, unitsPerBag: line.unitsPerBag };
      }),
    })),
    isSfCollect: order.isSfCollect,
    shipments: order.shipments.map((shipment) => ({
      shipmentKey: String(shipment.sequence),
      province: shipment.destinationProvince,
      // Only the persisted fulfilment fact is trusted. Browser-authored
      // quotedWeightKg is deliberately absent from finalizeOrderSelect.
      trustedFulfilmentWeightKg: decimalText(shipment.weightKg, 3),
      itemQuantities: Object.fromEntries(
        order.items.map((item) => [
          persistedItemKey(item),
          shipment.lines.reduce(
            (sum, line) =>
              line.orderItemId === item.id ? sum + line.quantity : sum,
            0,
          ),
        ]),
      ),
    })),
  };
}

function pureLogisticsQuote(
  input: CreateOrderQuoteInput,
  snapshot: CreateOrderPriceSnapshot,
): ExternalOrderChargeQuote {
  return calculateExternalOrderCharges(
    buildCreateOrderExternalChargeInput(input),
    snapshot.orderCharges.rules,
    snapshot.orderCharges.logisticsPolicy,
  );
}

function logisticsPersistenceInput(input: CreateOrderQuoteInput) {
  return buildCreateOrderExternalChargeInput(input).shipments.map(
    (shipment) => ({
      ...shipment,
      billableWeightKg:
        shipment.billableWeightKg === null
          ? null
          : String(shipment.billableWeightKg),
      shippingFee: null,
      packingMaterialFee: null,
      overrideReason: null,
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function chargeRequiresManual(snapshot: Prisma.InputJsonObject): boolean {
  const actual: unknown = snapshot.actual;
  return isRecord(actual) && actual.requiresAdminConfirmation === true;
}

function sameMoney(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  try {
    return new Decimal(left).equals(right);
  } catch {
    return false;
  }
}

type ResolvedLogistics = Awaited<
  ReturnType<typeof resolveExternalOrderChargesForProvisionalCreation>
>;

function assertResolvedLogisticsMatchesPure(args: {
  resolved: ResolvedLogistics;
  pure: ExternalOrderChargeQuote;
  quote: CreateOrderQuoteResult;
  snapshot: CreateOrderPriceSnapshot;
}): Map<string, ExternalOrderChargeLine> {
  const expectedVersion = args.quote.priceVersion.logistics;
  if (
    args.resolved.priceBook.id !== expectedVersion.id ||
    args.resolved.priceBook.version !== expectedVersion.version ||
    args.resolved.priceBook.sourceSha256 !== expectedVersion.sourceSha256
  ) {
    throw new ExternalOrderQuoteFinalizeError(
      '物流持久化未使用纯引擎锁定的价目版本',
    );
  }
  if (
    args.resolved.priceBook.policy.ruleVersion !==
    args.snapshot.orderCharges.logisticsPolicy.ruleVersion
  ) {
    throw new ExternalOrderQuoteFinalizeError(
      '物流持久化的计费规则版本与纯引擎不一致',
    );
  }

  const expectedByBusinessKey = new Map<string, ExternalOrderChargeLine>();
  for (const shipment of args.pure.shipments) {
    expectedByBusinessKey.set(
      `SHIPMENT:${shipment.shipmentKey}:SHIPPING_FEE`,
      shipment.shipping,
    );
    expectedByBusinessKey.set(
      `SHIPMENT:${shipment.shipmentKey}:PACKING_MATERIAL`,
      shipment.packaging,
    );
  }
  if (args.resolved.charges.length !== expectedByBusinessKey.size) {
    throw new ExternalOrderQuoteFinalizeError(
      '物流持久化明细数与纯引擎结果不一致',
    );
  }

  const seen = new Set<string>();
  for (const charge of args.resolved.charges) {
    const expected = expectedByBusinessKey.get(charge.businessKey);
    if (!expected || seen.has(charge.businessKey)) {
      throw new ExternalOrderQuoteFinalizeError(
        '物流持久化明细与纯引擎业务键不一致',
      );
    }
    seen.add(charge.businessKey);
    const expectedCategory =
      expected.categoryCode === 'SHIPPING'
        ? 'SHIPPING_FEE'
        : 'PACKING_MATERIAL';
    const manual = !expected.complete || expected.amount === null;
    const persistedResolverAmount = manual ? null : charge.amount;
    if (
      charge.categoryCode !== expectedCategory ||
      chargeRequiresManual(charge.pricingSnapshot) !== manual ||
      !sameMoney(persistedResolverAmount, expected.amount) ||
      !sameMoney(charge.suggestedAmount, expected.amount)
    ) {
      throw new ExternalOrderQuoteFinalizeError(
        `物流持久化金额与纯引擎结果不一致：${charge.businessKey}`,
      );
    }
    const rawResolverQuote: unknown = charge.pricingSnapshot.quote;
    const resolverQuote: Record<string, unknown> | null = isRecord(
      rawResolverQuote,
    )
      ? rawResolverQuote
      : null;
    if (
      resolverQuote?.ruleCode !== expected.ruleCode ||
      (expected.ruleCode === null
        ? charge.sourceRuleId !== null
        : charge.sourceRuleId === null)
    ) {
      throw new ExternalOrderQuoteFinalizeError(
        `物流持久化规则与纯引擎结果不一致：${charge.businessKey}`,
      );
    }
  }
  return expectedByBusinessKey;
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

type PreparedExternalOrderQuote =
  | { kind: 'REUSE'; result: FinalizeExternalOrderQuoteResult }
  | { kind: 'REPRICE'; order: FinalizeOrderRow };

async function prepareExternalOrderQuote(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<PreparedExternalOrderQuote> {
  const order = await readOrder(tx, orderId);
  if (!order) throw new ExternalOrderQuoteFinalizeError('工单不存在');
  // A DRAFT may carry a quote produced by an approved change request. It is
  // still mutable and must revalidate live paper/catalog facts at submission.
  if (order.quotedPricingRevisionId && order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.REJECTED) {
    return { kind: 'REUSE', result: resultFromExisting(order) };
  }
  if (order.settlementType !== OrderSettlementType.EXTERNAL_SALES) {
    throw new ExternalOrderQuoteFinalizeError('仅外部销售工单需要生成提交报价');
  }
  if (order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.REJECTED) {
    throw new ExternalOrderQuoteFinalizeError('只能为草稿或驳回工单生成提交报价');
  }
  if (order.items.length === 0) {
    throw new ExternalOrderQuoteFinalizeError('工单至少需要一个款式');
  }
  if (order.shipments.length === 0) {
    throw new ExternalOrderQuoteFinalizeError('工单至少需要一个发货地址');
  }
  const contactIssues = externalShipmentContactIssues(order.shipments.filter((shipment) => shipment.sequence > 1));
  if (contactIssues.length) throw new ExternalOrderQuoteFinalizeError(contactIssues.map((issue) => issue.message).join('；'));
  // Canonical lock order for every quote/catalog transaction:
  // price snapshot -> PAPER rows. Material writers already use the same order.
  await acquirePriceRuleSnapshotReadLock(tx);
  await assertSelectedPapersAvailable(tx, order.items);
  return { kind: 'REPRICE', order };
}

function freshQuoteFeeLifecycle(quotedFee: string) {
  return { quotedFee, confirmedFee: null, settledFee: null } as const;
}

async function linkFinalizedQuoteRevision(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    quotedFee: string;
    quotedFeeCompleteness: OrderQuotedFeeCompleteness;
    pricingRevisionId: string;
  },
): Promise<void> {
  await tx.order.update({
    where: { id: input.orderId },
    data: {
      ...freshQuoteFeeLifecycle(input.quotedFee),
      quotedFeeCompleteness: input.quotedFeeCompleteness,
      quotedPricingRevisionId: input.pricingRevisionId,
    },
    select: { id: true },
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

  const prepared = await prepareExternalOrderQuote(tx, orderId);
  if (prepared.kind === 'REUSE') return prepared.result;
  const { order } = prepared;

  let priceSnapshot: CreateOrderPriceSnapshot;
  let pureInput: CreateOrderQuoteInput;
  try {
    priceSnapshot = await readPublishedCreateOrderPriceSnapshot(tx, {
      now,
      snapshotLockHeld: true,
    });
    pureInput = await buildCreateOrderQuoteInputFromCatalog(
      tx,
      persistedQuoteFacts(order),
    );
  } catch (error) {
    if (
      error instanceof CreateOrderQuoteFactsAdapterError ||
      error instanceof PublishedCreateOrderPriceAdapterError
    ) {
      throw new ExternalOrderQuoteFinalizeError(error.message);
    }
    throw error;
  }
  const quote = calculateCreateOrderQuote(pureInput, priceSnapshot);
  if (!quote.submittable) {
    throw new ExternalOrderQuoteFinalizeError(
      quote.errors.join('；') || '提交报价事实无效',
    );
  }
  const logisticsPreview = pureLogisticsQuote(pureInput, priceSnapshot);

  const currentQuoteToken = createExternalOrderQuoteToken({
    items: pureInput.items,
    packagingGroups: pureInput.packagingGroups,
    logistics: {
      isSfCollect: pureInput.isSfCollect,
      shipments: pureInput.shipments,
    },
    priceVersion: quote.priceVersion,
    result: {
      items: quote.items,
      packaging: quote.packagingGroups,
      logistics: quote.order,
    },
  });
  const presentation = presentCreateOrderQuote({
    factsKey: order.id,
    input: pureInput,
    quote,
    logistics: logisticsPreview,
    quoteToken: currentQuoteToken,
  });
  if (expectedQuoteToken !== currentQuoteToken) {
    throw new ExternalOrderQuoteChangedError(
      currentQuoteToken,
      presentation.knownTotal,
      presentation.totalSemantics === 'COMPLETE'
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
        isSfCollect: pureInput.isSfCollect,
        // Finalization has no client amount input. The resolver is retained
        // only to bind category/rule ids; canonical amounts come from the
        // pure result below and unresolved lines remain null.
        shipments: logisticsPersistenceInput(pureInput),
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
  const pureLogisticsLines = assertResolvedLogisticsMatchesPure({
    resolved: logistics,
    pure: logisticsPreview,
    quote,
    snapshot: priceSnapshot,
  });
  const hasPendingPlate = quoteHasPendingPlateCharge(quote);
  let plateCategoryId: string | null = null;
  if (hasPendingPlate) {
    try {
      plateCategoryId = await requireActivePlateCategoryIdInTx(tx);
    } catch (error) {
      if (error instanceof PendingPlateChargeError) {
        throw new ExternalOrderQuoteFinalizeError(error.message);
      }
      throw error;
    }
  }
  const manualItemIds: string[] = [];
  let knownItemAmount = new Decimal(0);
  for (const [index, item] of order.items.entries()) {
    const pureItem = quote.items[index];
    const itemPresentation = presentation.items[index];
    if (
      !pureItem ||
      !itemPresentation ||
      pureItem.itemKey !== persistedItemKey(item)
    ) {
      throw new ExternalOrderQuoteFinalizeError(
        '纯引擎款式结果与工单不一致',
      );
    }
    knownItemAmount = knownItemAmount.plus(pureItem.knownAmount);
    const complete =
      pureItem.status === 'QUOTED' &&
      itemPresentation.complete &&
      itemPresentation.suggestedUnitPrice !== null &&
      itemPresentation.suggestedFixedFee !== null &&
      itemPresentation.suggestedSubtotal !== null;
    if (complete) {
      const unitPrice = itemPresentation.suggestedUnitPrice!;
      const fixedFee = itemPresentation.suggestedFixedFee!;
      const subtotal = itemPresentation.suggestedSubtotal!;
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
            ...itemPresentation.snapshot,
            // Keep the pure-engine schemaVersion while satisfying the legacy
            // OrderItem snapshot compatibility envelope at persistence time.
            version: 1,
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
      if (pureItem.status !== 'MANUAL_PRICING_REQUIRED') {
        throw new ExternalOrderQuoteFinalizeError(
          `款式 ${item.sequence} 未产生可保存的报价状态`,
        );
      }
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
            ...itemPresentation.snapshot,
            version: 1,
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

  if (
    quote.packagingGroups.length !== order.packagingGroups.length ||
    presentation.packaging.groups.length !== order.packagingGroups.length
  ) {
    throw new ExternalOrderQuoteFinalizeError(
      '纯引擎包装组结果与工单不一致',
    );
  }
  let knownPackagingAmount = new Decimal(0);
  let hasManualPackaging = false;
  for (const [index, group] of order.packagingGroups.entries()) {
    const pureGroup = quote.packagingGroups[index];
    const groupPresentation = presentation.packaging.groups[index];
    if (
      !pureGroup ||
      !groupPresentation ||
      pureGroup.groupKey !== String(group.sequence) ||
      groupPresentation.groupKey !== pureGroup.groupKey ||
      (pureGroup.bagCount !== null &&
        pureGroup.bagCount !== group.actualBagCount)
    ) {
      throw new ExternalOrderQuoteFinalizeError(
        `包装组 ${group.sequence} 报价与工单不一致`,
      );
    }
    knownPackagingAmount = knownPackagingAmount.plus(pureGroup.knownAmount);
    const complete =
      pureGroup.status === 'QUOTED' &&
      groupPresentation.complete &&
      groupPresentation.suggestedUnitPrice !== null &&
      groupPresentation.suggestedSubtotal !== null;
    if (complete) {
      const unitPrice = groupPresentation.suggestedUnitPrice!;
      const subtotal = groupPresentation.suggestedSubtotal!;
      await tx.orderPackagingGroup.update({
        where: { id: group.id },
        data: {
          unitPrice,
          subtotal,
          suggestedSubtotal: subtotal,
          priceOverrideReason: null,
          pricingSnapshot: {
            ...groupPresentation.snapshot,
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
            ...groupPresentation.snapshot,
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
    const pureLine = pureLogisticsLines.get(charge.businessKey);
    if (!pureLine) {
      throw new ExternalOrderQuoteFinalizeError(
        '物流持久化明细缺少纯引擎结果',
      );
    }
    const requiresManual = !pureLine.complete || pureLine.amount === null;
    const amount = requiresManual ? null : pureLine.amount;
    if (requiresManual) {
      hasManualLogistics = true;
    } else {
      knownLogisticsAmount = knownLogisticsAmount.plus(pureLine.amount!);
    }
    const status = requiresManual
      ? OrderCustomerChargeStatus.PENDING_AMOUNT
      : pureLine.waived
        ? OrderCustomerChargeStatus.WAIVED
        : OrderCustomerChargeStatus.ESTIMATED;
    const waived = status === OrderCustomerChargeStatus.WAIVED;
    const actual = isRecord(charge.pricingSnapshot.actual)
      ? charge.pricingSnapshot.actual
      : {};
    const pricingSnapshot = {
      ...charge.pricingSnapshot,
      schemaVersion: 2,
      engineVersion: 'CREATE_ORDER_PURE_V1',
      priceVersion: quote.priceVersion,
      pureLine: pureLine as unknown as Prisma.InputJsonObject,
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
        suggestedAmount: pureLine.amount,
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
        suggestedAmount: pureLine.amount,
        amount,
        pricingSnapshot,
        overrideReason: null,
        finalizedById: waived ? actorId : null,
        finalizedAt: waived ? now : null,
      },
    });
  }
  if (hasPendingPlate) {
    try {
      await upsertPendingPlateChargeInTx({
        tx,
        orderId: order.id,
        actorId,
        categoryId: plateCategoryId!,
        quote,
        source: 'EXTERNAL_SUBMIT_PENDING_PLATE',
      });
    } catch (error) {
      if (error instanceof PendingPlateChargeError) {
        throw new ExternalOrderQuoteFinalizeError(error.message);
      }
      throw error;
    }
  }

  const knownProcessingAmount = knownItemAmount.plus(knownPackagingAmount);
  const knownTotalAmount = knownProcessingAmount.plus(knownLogisticsAmount);
  assertStorableTotal(knownPackagingAmount, '入袋费合计');
  assertStorableTotal(knownProcessingAmount, '加工费合计');
  assertStorableTotal(knownLogisticsAmount, '物流费合计');
  assertStorableTotal(knownTotalAmount, '工单已知费用合计');
  if (!new Decimal(quote.knownTotal).equals(knownTotalAmount)) {
    throw new ExternalOrderQuoteFinalizeError(
      '持久化明细合计与纯引擎已知合计不一致',
    );
  }
  const packagingAmount = knownPackagingAmount.toFixed(2);
  const processingAmount = knownProcessingAmount.toFixed(2);
  const logisticsAmount = knownLogisticsAmount.toFixed(2);
  const totalAmount = knownTotalAmount.toFixed(2);
  const hasManual = presentation.hasManualPricing;
  if (
    hasManual !==
    (manualItemIds.length > 0 ||
      hasManualPackaging ||
      hasManualLogistics ||
      hasPendingPlate)
  ) {
    throw new ExternalOrderQuoteFinalizeError(
      '纯引擎的人工核价语义与持久化明细不一致',
    );
  }
  const quotedFeeCompleteness =
    presentation.totalSemantics === 'COMPLETE'
      ? OrderQuotedFeeCompleteness.COMPLETE
      : OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS;
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
    orderFeeSnapshot: freshQuoteFeeLifecycle(totalAmount),
    metadata: {
      engineVersion: 'CREATE_ORDER_PURE_V1',
      priceBooks: quote.priceVersion,
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
      pureQuote: {
        status: quote.status,
        pendingLineCodes: quote.pendingLineCodes,
        manualReasons: quote.manualReasons,
        pendingReasons: quote.pendingReasons,
      },
    },
  });
  await tx.orderPriceVersionLock.createMany({
    data: [
      {
        pricingRevisionId: revision.pricingRevisionId,
        purpose: CustomerPriceBookPurpose.PROCESSING,
        priceBookId: quote.priceVersion.processing.id,
        priceBookVersion: quote.priceVersion.processing.version,
        sourceSha256: quote.priceVersion.processing.sourceSha256,
        createdAt: now,
      },
      {
        pricingRevisionId: revision.pricingRevisionId,
        purpose: CustomerPriceBookPurpose.LOGISTICS,
        priceBookId: quote.priceVersion.logistics.id,
        priceBookVersion: quote.priceVersion.logistics.version,
        sourceSha256: quote.priceVersion.logistics.sourceSha256,
        createdAt: now,
      },
    ],
  });
  await linkFinalizedQuoteRevision(tx, {
    orderId: order.id,
    quotedFee: totalAmount,
    quotedFeeCompleteness,
    pricingRevisionId: revision.pricingRevisionId,
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
        priceBookId: quote.priceVersion.processing.id,
        version: quote.priceVersion.processing.version,
        sourceSha256: quote.priceVersion.processing.sourceSha256,
      },
      logistics: {
        priceBookId: quote.priceVersion.logistics.id,
        version: quote.priceVersion.logistics.version,
        sourceSha256: quote.priceVersion.logistics.sourceSha256,
      },
    },
    reused: false,
  };
}
