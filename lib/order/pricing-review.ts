import { packagingUnit } from './packaging-mode';
import Decimal from "decimal.js";
import type { Prisma } from "../../generated/prisma/client";
import {
  CsSalesEntryType,
  OrderBillingMode,
  OrderChangeRequestStatus,
  OrderCustomerChargeStatus,
  OrderItemQuoteDisposition,
  OrderItemPricingRoute,
  OrderPackagingMode,
  OrderSettlementType,
  OrderStatus,
  Role,
} from "../../generated/prisma/enums";
import { db } from "../db";
import {
  ADMIN_SNAPSHOT_CONFIRMATION_SOURCE,
  buildTrustedAdminChargePricingSnapshot,
  buildTrustedAdminItemPricingSnapshot,
  buildTrustedAdminPackagingPricingSnapshot,
  hasAdminPricingConfirmationMarker,
  isTrustedAdminChargePricingSnapshot,
  isTrustedAdminItemPricingSnapshot,
  isTrustedAdminPackagingPricingSnapshot,
  isTrustedAdminPricingSnapshot,
} from "./admin-pricing-snapshot";
import { hasExclusiveTrustedStructuredPlateCoverage } from "./plate-charge-integrity";
import { orderCascadeLockKey } from "./locks";
import {
  isOrderPricingReviewAllowedStatus,
  ORDER_PRICING_STATUS,
} from "./pricing-status";
import { appendOrderPricingRevisionInTx } from "./pricing-revision";
import { inspectOrderProductionReadinessInTx, prepareOrderForProductionInTx } from "./production-readiness";
import {
  assertCsOrderSalesLedgerReconciledInTx,
  CsSalesLedgerError,
  recordCsSalesEntryInTx,
} from "../salary/cs-sales";

const DECIMAL_10_4_MAX = new Decimal("999999.9999");
const DECIMAL_12_2_MAX = new Decimal("9999999999.99");

type ShipmentChargeCode = "SHIPPING_FEE" | "PACKING_MATERIAL";
type MoneyLike = { toString(): string } | string | number;
type JsonRecord = Record<string, unknown>;

export class OrderPricingReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderPricingReviewError";
  }
}

export type FinalizeOrderPricingCommand = {
  orderId: string;
  expectedOrderRevision: number;
  expectedPriceRevision: number;
  items: Array<{
    itemId: string;
    unitPrice?: string | null;
    fixedFee?: string | null;
    reason?: string | null;
  }>;
  packagingGroups: Array<{
    packagingGroupId: string;
    expectedMode: OrderPackagingMode;
    expectedActualBagCount: number;
    unitPrice?: string | null;
    reason?: string | null;
  }>;
  orderCharges: Array<{
    chargeId: string;
    expectedBusinessKey: string;
    amount: string;
    reason?: string | null;
  }>;
  shipments: Array<{
    shipmentId: string;
    expectedDestinationProvince: string | null;
    expectedBillableWeightKg: string | null;
    shippingFee: string;
    packingMaterialFee: string;
    reason?: string | null;
  }>;
  remark?: string | null;
};

export type OrderPricingVersionEvidence = {
  id: string;
  code: string;
  name: string;
  version: number;
  sourceName: string | null;
  sourceSha256: string | null;
};

type ChargePreview = {
  complete: boolean;
  waived: boolean;
  advisory: boolean;
  suggestedAmount: string | null;
  errors: string[];
  currentAmount: string | null;
};

export type OrderPricingReviewPreview = {
  productionReadiness?: { ready: boolean; issues: string[] };
  orderId: string;
  orderNo: string;
  orderRevision: number;
  priceRevision: number;
  currentProcessingAmount: string;
  currentPackagingAmount: string;
  currentTotalAmount: string;
  processingPriceBook: OrderPricingVersionEvidence | null;
  logisticsPriceBook: OrderPricingVersionEvidence | null;
  items: Array<{
    itemId: string;
    sequence: number;
    name: string;
    quantity: number;
    complete: boolean;
    errors: string[];
    manualQuoteReason: string | null;
    currentUnitPrice: string;
    currentFixedFee: string;
    currentSubtotal: string;
    suggestedUnitPrice: string | null;
    suggestedFixedFee: string | null;
    suggestedSubtotal: string | null;
    currentReason: string | null;
  }>;
  packagingGroups: Array<{
    packagingGroupId: string;
    sequence: number;
    name: string | null;
    mode: OrderPackagingMode;
    actualBagCount: number;
    complete: boolean;
    errors: string[];
    currentUnitPrice: string;
    currentSubtotal: string;
    suggestedUnitPrice: string | null;
    suggestedSubtotal: string | null;
    currentReason: string | null;
  }>;
  orderCharges: Array<{
    chargeId: string;
    businessKey: string;
    categoryCode: string;
    description: string;
    complete: false;
    errors: string[];
    suggestedAmount: string | null;
    currentAmount: string | null;
    currentReason: string | null;
  }>;
  shipments: Array<{
    shipmentId: string;
    sequence: number;
    destinationProvince: string | null;
    billableWeightKg: string | null;
    itemQuantity: number;
    shipping: ChargePreview;
    packaging: ChargePreview;
    currentReason: string | null;
  }>;
};

type PricingItem = {
  id: string;
  orderId: string;
  sequence: number;
  name: string;
  manualQuoteReason: string | null;
  quantity: number;
  quoteDisposition: OrderItemQuoteDisposition | null;
  pricingRoute: OrderItemPricingRoute;
  productId: string | null;
  craft: string | null;
  productStructure: string;
  plateGroupId: string | null;
  pricingGroup: string | null;
  specification: string | null;
  actualWidthMm: MoneyLike | null;
  actualHeightMm: MoneyLike | null;
  paperType: string | null;
  paperWeightGsm: number | null;
  pack: number | null;
  crafts: string[];
  frontFoilColors: string[];
  backFoilColors: string[];
  foilColors: string[];
  foilTechnique: string;
  hasLocalFoil: boolean | null;
  lamination: string;
  printColors: string[];
  printColorsKnown: boolean;
  isDoubleSided: boolean;
  isDoubleColor: boolean;
  unitPrice: MoneyLike;
  fixedFee: MoneyLike;
  subtotal: MoneyLike;
  suggestedSubtotal: MoneyLike | null;
  pricingSnapshot: unknown;
  priceOverrideReason: string | null;
};

type PricingPackagingGroup = {
  id: string;
  orderId: string;
  sequence: number;
  name: string | null;
  mode: OrderPackagingMode;
  actualBagCount: number;
  unitPrice: MoneyLike;
  subtotal: MoneyLike;
  suggestedSubtotal: MoneyLike | null;
  pricingSnapshot: unknown;
  priceOverrideReason: string | null;
  lines: Array<{ orderItemId: string; unitsPerBag: number }>;
};

type PricingShipment = {
  id: string;
  sequence: number;
  destinationProvince: string | null;
  weightKg: MoneyLike | null;
  lines: Array<{ orderItemId: string; quantity: number }>;
};

type PricingCustomerCharge = {
  id: string;
  orderId: string;
  shipmentId: string | null;
  businessKey: string;
  description: string;
  quantity: MoneyLike | null;
  unit: string | null;
  unitPrice: MoneyLike | null;
  suggestedAmount: MoneyLike | null;
  amount: MoneyLike | null;
  pricingSnapshot: unknown;
  overrideReason: string | null;
  status: string;
  priceBookId: string | null;
  sourceRuleId: string | null;
  isAdjustment: boolean;
  approvalReference: string | null;
  category: { code: string; name: string };
};

type PricingOrder = {
  id: string;
  orderNo: string;
  submitterId: string;
  status: string;
  billingMode: string;
  settlementType: string;
  revision: number;
  pricingStatus: string;
  priceRevision: number;
  processingAmount: MoneyLike;
  packagingAmount: MoneyLike;
  totalAmount: MoneyLike;
  quotedFee: MoneyLike | null;
  confirmedFee: MoneyLike | null;
  settledFee: MoneyLike | null;
  items: PricingItem[];
  packagingGroups: PricingPackagingGroup[];
  shipments: PricingShipment[];
  customerCharges: PricingCustomerCharge[];
};

const pricingOrderSelect = {
  id: true,
  orderNo: true,
  submitterId: true,
  status: true,
  billingMode: true,
  settlementType: true,
  revision: true,
  pricingStatus: true,
  priceRevision: true,
  processingAmount: true,
  packagingAmount: true,
  totalAmount: true,
  quotedFee: true,
  confirmedFee: true,
  settledFee: true,
  items: {
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      orderId: true,
      sequence: true,
      name: true,
      manualQuoteReason: true,
      quantity: true,
      quoteDisposition: true,
      pricingRoute: true,
      productId: true,
      craft: true,
      productStructure: true,
      plateGroupId: true,
      pricingGroup: true,
      specification: true,
      actualWidthMm: true,
      actualHeightMm: true,
      paperType: true,
      paperWeightGsm: true,
      pack: true,
      crafts: true,
      frontFoilColors: true,
      backFoilColors: true,
      foilColors: true,
      foilTechnique: true,
      hasLocalFoil: true,
      lamination: true,
      printColors: true,
      printColorsKnown: true,
      isDoubleSided: true,
      isDoubleColor: true,
      unitPrice: true,
      fixedFee: true,
      subtotal: true,
      suggestedSubtotal: true,
      pricingSnapshot: true,
      priceOverrideReason: true,
    },
  },
  packagingGroups: {
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      orderId: true,
      sequence: true,
      name: true,
      mode: true,
      actualBagCount: true,
      unitPrice: true,
      subtotal: true,
      suggestedSubtotal: true,
      pricingSnapshot: true,
      priceOverrideReason: true,
      lines: { select: { orderItemId: true, unitsPerBag: true } },
    },
  },
  shipments: {
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      destinationProvince: true,
      weightKg: true,
      lines: { select: { orderItemId: true, quantity: true } },
    },
  },
  customerCharges: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      orderId: true,
      shipmentId: true,
      businessKey: true,
      description: true,
      quantity: true,
      unit: true,
      unitPrice: true,
      suggestedAmount: true,
      amount: true,
      pricingSnapshot: true,
      overrideReason: true,
      status: true,
      priceBookId: true,
      sourceRuleId: true,
      isAdjustment: true,
      approvalReference: true,
      category: { select: { code: true, name: true } },
    },
  },
} as const;

function assertAdmin(actor: { id: string; role: Role }): void {
  if (actor.role !== Role.ADMIN) {
    throw new OrderPricingReviewError("只有管理员可以确认工单终价");
  }
}

function assertReviewable(order: PricingOrder): void {
  if (order.settlementType === OrderSettlementType.NO_CHARGE) {
    throw new OrderPricingReviewError("免费工单不进入工厂核价流程");
  }
  if (!isOrderPricingReviewAllowedStatus(order.status)) {
    throw new OrderPricingReviewError(
      "工单未处于待工厂确认阶段，不能确认终价",
    );
  }
  if (
    order.pricingStatus !== ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION
  ) {
    throw new OrderPricingReviewError(
      "工单价格不处于待管理员确认状态，不能重复确认终价",
    );
  }
}

function money(value: MoneyLike | null | undefined, scale = 2): string | null {
  if (value === null || value === undefined) return null;
  return new Decimal(value.toString()).toFixed(scale);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function optionalText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function snapshotMoney(value: unknown, scale: number): string | null {
  const text = optionalText(value);
  if (text === null) return null;
  try {
    return new Decimal(text).toFixed(scale);
  } catch {
    return null;
  }
}

function snapshotStatus(snapshot: unknown): string | null {
  return optionalText(record(snapshot).status)?.toUpperCase() ?? null;
}

function snapshotIsConfirmed(snapshot: unknown): boolean {
  return (
    isTrustedAdminPricingSnapshot(snapshot) ||
    hasAdminPricingConfirmationMarker(snapshot)
  );
}

function snapshotRequiresManual(snapshot: unknown): boolean {
  const data = record(snapshot);
  const actual = record(data.actual);
  const status = snapshotStatus(snapshot);
  const source = optionalText(data.source)?.toUpperCase() ?? "";
  if (snapshotIsConfirmed(snapshot)) return false;
  return (
    status === "MANUAL_PRICING_REQUIRED" ||
    status === "PENDING_AMOUNT" ||
    status === "EXCLUDED_MANUAL" ||
    data.complete === false ||
    actual.provisional === true ||
    actual.requiresAdminConfirmation === true ||
    source.includes("MANUAL_REQUIRED")
  );
}

/**
 * New-engine manual rows keep legacy non-null decimal columns at zero only to
 * satisfy the compatibility schema. The snapshot is the canonical signal that
 * no amount exists yet; those placeholders must never become an editable
 * default. Older manually priced rows without this explicit pending envelope
 * keep their persisted values for operator review.
 */
function snapshotHasUnknownManualAmount(snapshot: unknown): boolean {
  if (!snapshotRequiresManual(snapshot)) return false;
  const actual = record(record(snapshot).actual);
  return (
    actual.amount === null ||
    actual.provisional === true ||
    actual.requiresAdminConfirmation === true
  );
}

function snapshotErrors(snapshot: unknown): string[] {
  const data = record(snapshot);
  const quote = record(data.quote);
  const values: string[] = [];
  const pendingReason =
    optionalText(data.pendingReason) ??
    optionalText(record(data.pendingReason).message);
  if (pendingReason) values.push(pendingReason);
  for (const candidate of [data.errors, quote.errors]) {
    if (!Array.isArray(candidate)) continue;
    for (const error of candidate) {
      if (typeof error === "string" && error.trim()) values.push(error.trim());
    }
  }
  if (Array.isArray(data.manualReasons)) {
    for (const reason of data.manualReasons) {
      if (typeof reason === "string" && reason.trim()) {
        values.push(reason.trim());
      } else if (isRecord(reason)) {
        const message = optionalText(reason.message);
        if (message) values.push(message);
      }
    }
  }
  return [...new Set(values)];
}

function itemRequiresManual(item: PricingItem): boolean {
  if (isTrustedAdminItemPricingSnapshot(item.pricingSnapshot, item)) {
    return false;
  }
  return (
    snapshotIsConfirmed(item.pricingSnapshot) ||
    item.quoteDisposition ===
      OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED ||
    Boolean(item.manualQuoteReason?.trim()) ||
    snapshotRequiresManual(item.pricingSnapshot)
  );
}

function packagingRequiresManual(group: PricingPackagingGroup): boolean {
  if (
    isTrustedAdminPackagingPricingSnapshot(group.pricingSnapshot, group)
  ) {
    return false;
  }
  return (
    snapshotIsConfirmed(group.pricingSnapshot) ||
    snapshotRequiresManual(group.pricingSnapshot)
  );
}

function chargeRequiresManual(
  charge: PricingCustomerCharge | undefined,
): boolean {
  if (!charge) return true;
  if (charge.status === OrderCustomerChargeStatus.WAIVED) {
    return (
      charge.amount === null ||
      !new Decimal(charge.amount.toString()).isZero()
    );
  }
  if (charge.amount === null) return true;
  if (isTrustedAdminChargePricingSnapshot(charge.pricingSnapshot, charge)) {
    return false;
  }
  if (isTrustedAdminPricingSnapshot(charge.pricingSnapshot)) return true;
  return (
    snapshotIsConfirmed(charge.pricingSnapshot) ||
    charge.status === OrderCustomerChargeStatus.PENDING_AMOUNT ||
    snapshotRequiresManual(charge.pricingSnapshot)
  );
}

function assertStructuredPlateChargesConsistent(order: PricingOrder): void {
  const hasActiveStructuredPlateCharge = order.customerCharges.some(
    (charge) =>
      charge.category.code === "PLATE_MAKING_FEE" &&
      charge.businessKey.startsWith("PLATE_DETAIL:") &&
      charge.status !== OrderCustomerChargeStatus.WAIVED,
  );
  if (
    hasActiveStructuredPlateCharge &&
    !hasExclusiveTrustedStructuredPlateCoverage({
      items: order.items,
      charges: order.customerCharges,
    })
  ) {
    throw new OrderPricingReviewError(
      "逐款制版明细与订单级制烫金版费不一致，请先由管理员清理重复或无效明细",
    );
  }
}

function parseVersionEvidence(
  value: unknown,
  fallbackName: string,
): OrderPricingVersionEvidence | null {
  const data = record(value);
  const id = optionalText(data.id);
  const code = optionalText(data.code);
  const rawVersion = data.version;
  const version =
    typeof rawVersion === "number"
      ? rawVersion
      : typeof rawVersion === "string" && /^\d+$/.test(rawVersion)
        ? Number.parseInt(rawVersion, 10)
        : null;
  if (!id || !code || version === null || version < 1) return null;
  return {
    id,
    code,
    name: optionalText(data.name) ?? fallbackName,
    version,
    sourceName: optionalText(data.sourceName),
    sourceSha256: optionalText(data.sourceSha256),
  };
}

function snapshotVersionEvidence(
  snapshot: unknown,
  kind: "processing" | "logistics",
): OrderPricingVersionEvidence | null {
  const data = record(snapshot);
  const bundled = parseVersionEvidence(
    record(data.priceVersion)[kind],
    kind === "processing" ? "加工费报价快照" : "物流报价快照",
  );
  if (bundled) return bundled;
  const book = parseVersionEvidence(
    data.priceBook,
    kind === "processing" ? "加工费报价快照" : "物流报价快照",
  );
  if (!book) return null;
  const code = book.code.toUpperCase();
  if (kind === "processing" && code.includes("LOGISTICS")) return null;
  if (kind === "logistics" && code.includes("PROCESSING")) return null;
  return book;
}

function firstVersionEvidence(
  snapshots: readonly unknown[],
  kind: "processing" | "logistics",
): OrderPricingVersionEvidence | null {
  for (const snapshot of snapshots) {
    const evidence = snapshotVersionEvidence(snapshot, kind);
    if (evidence) return evidence;
  }
  return null;
}

function shipmentChargeKey(sequence: number, code: ShipmentChargeCode): string {
  return `SHIPMENT:${sequence}:${code}`;
}

function chargeByShipmentAndCode(
  chargeByBusinessKey: ReadonlyMap<string, PricingCustomerCharge>,
  shipment: PricingShipment,
  code: ShipmentChargeCode,
): PricingCustomerCharge | undefined {
  return chargeByBusinessKey.get(shipmentChargeKey(shipment.sequence, code));
}

function isShipmentCustomerCharge(charge: PricingCustomerCharge): boolean {
  const code = String(charge.category.code).toUpperCase();
  return code === "SHIPPING_FEE" || code === "PACKING_MATERIAL";
}

function reviewsShipmentCustomerCharges(order: PricingOrder): boolean {
  return order.settlementType === OrderSettlementType.EXTERNAL_SALES;
}

/**
 * Shipment charges are persisted accounting rows, so neither their display
 * key nor their relation alone is sufficient identity. Require one canonical
 * row for every (order, shipment, category) tuple before previewing or writing
 * a final price. This also prevents one corrupt row from being reused for two
 * shipment inputs.
 */
function assertShipmentCustomerChargeIdentity(
  order: PricingOrder,
): ReadonlyMap<string, PricingCustomerCharge> {
  const expectedByBusinessKey = new Map<
    string,
    { shipmentId: string; categoryCode: ShipmentChargeCode }
  >();
  for (const shipment of order.shipments) {
    for (const categoryCode of [
      "SHIPPING_FEE",
      "PACKING_MATERIAL",
    ] as const) {
      expectedByBusinessKey.set(
        shipmentChargeKey(shipment.sequence, categoryCode),
        { shipmentId: shipment.id, categoryCode },
      );
    }
  }
  if (expectedByBusinessKey.size !== order.shipments.length * 2) {
    throw new OrderPricingReviewError(
      "工单发货记录序号重复，无法安全核对快递费和打包耗材费",
    );
  }

  const shipmentCharges = order.customerCharges.filter(isShipmentCustomerCharge);
  if (shipmentCharges.length !== expectedByBusinessKey.size) {
    throw new OrderPricingReviewError(
      "每个发货地址必须且只能保存一条快递费和一条打包耗材费",
    );
  }

  const chargeByBusinessKey = new Map<string, PricingCustomerCharge>();
  const seenTargets = new Set<string>();
  for (const charge of shipmentCharges) {
    const businessKey = String(charge.businessKey);
    const categoryCode = String(charge.category.code);
    const expected = expectedByBusinessKey.get(businessKey);
    const targetKey = `${charge.shipmentId ?? ""}:${categoryCode}`;
    if (
      charge.orderId !== order.id ||
      !expected ||
      categoryCode !== expected.categoryCode ||
      charge.shipmentId !== expected.shipmentId
    ) {
      throw new OrderPricingReviewError(
        `收费明细 ${charge.businessKey} 与工单、发货地址或收费类目不一致，请先修复收费数据`,
      );
    }
    if (
      chargeByBusinessKey.has(businessKey) ||
      seenTargets.has(targetKey)
    ) {
      throw new OrderPricingReviewError(
        `收费明细 ${charge.businessKey} 重复，无法确认工单终价`,
      );
    }
    chargeByBusinessKey.set(businessKey, charge);
    seenTargets.add(targetKey);
  }

  if (
    [...expectedByBusinessKey.keys()].some(
      (businessKey) => !chargeByBusinessKey.has(businessKey),
    )
  ) {
    throw new OrderPricingReviewError(
      "工单快递费或打包耗材费缺失，无法确认工单终价",
    );
  }
  return chargeByBusinessKey;
}

function snapshotBillableWeightKg(
  shipment: PricingShipment,
  shipping: PricingCustomerCharge | undefined,
): string | null {
  const snapshot = record(shipping?.pricingSnapshot);
  const quote = record(snapshot.quote);
  const basis = record(quote.basis);
  const actual = record(snapshot.actual);
  for (const value of [
    basis.billableWeightKg,
    actual.billableWeightKg,
    shipment.weightKg,
  ]) {
    const parsed = snapshotMoney(value, 3);
    if (parsed !== null && new Decimal(parsed).gt(0)) return parsed;
  }
  return null;
}

function previewCharge(charge: PricingCustomerCharge | undefined): ChargePreview {
  const requiresManual = chargeRequiresManual(charge);
  const errors = charge
    ? snapshotErrors(charge.pricingSnapshot)
    : ["工单未保存该收费快照，需工厂人工核价"];
  if (requiresManual && errors.length === 0) {
    errors.push("收费快照标记为待人工确认");
  }
  return {
    complete: !requiresManual,
    waived: charge?.status === OrderCustomerChargeStatus.WAIVED,
    advisory: requiresManual,
    suggestedAmount: money(charge?.suggestedAmount),
    errors,
    currentAmount: money(charge?.amount),
  };
}

function parseManualMoney(
  value: string | null | undefined,
  label: string,
  max: Decimal,
  decimalPlaces: number,
): Decimal {
  if (value === null || value === undefined || value.trim() === "") {
    throw new OrderPricingReviewError(`${label}必须由管理员填写`);
  }
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new OrderPricingReviewError(`${label}格式非法`);
  }
  if (
    !parsed.isFinite() ||
    parsed.isNegative() ||
    parsed.decimalPlaces() > decimalPlaces ||
    parsed.gt(max)
  ) {
    throw new OrderPricingReviewError(`${label}超出系统允许范围`);
  }
  return parsed;
}

function requiredReason(value: string | null | undefined, label: string): string {
  const reason = value?.trim() ?? "";
  if (!reason) {
    throw new OrderPricingReviewError(`${label}，请填写管理员定价依据`);
  }
  return reason;
}

async function readPricingOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<PricingOrder | null> {
  const model = tx.order as unknown as {
    findUnique(args: unknown): Promise<PricingOrder | null>;
  };
  return model.findUnique({ where: { id: orderId }, select: pricingOrderSelect });
}

export async function previewOrderPricingReview(
  orderId: string,
  actor: { id: string; role: Role },
  _now: Date = new Date(),
): Promise<OrderPricingReviewPreview> {
  assertAdmin(actor);
  // Kept for call-site compatibility and deterministic tests; snapshot reads
  // intentionally do not select a price version by the current clock.
  void _now;
  return db.$transaction(async (tx) => {
    const order = await readPricingOrder(tx, orderId);
    if (!order) throw new OrderPricingReviewError("工单不存在");
    assertReviewable(order);
    assertStructuredPlateChargesConsistent(order);
    const includesShipmentCharges = reviewsShipmentCustomerCharges(order);
    const shipmentChargeByBusinessKey = includesShipmentCharges
      ? assertShipmentCustomerChargeIdentity(order)
      : new Map<string, PricingCustomerCharge>();

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      productionReadiness: order.status === OrderStatus.SUBMITTED || order.status === OrderStatus.PENDING_FACTORY
        ? await inspectOrderProductionReadinessInTx(tx, order.id).then(({ ready, issues }) => ({ ready, issues }))
        : undefined,
      orderRevision: order.revision,
      priceRevision: order.priceRevision,
      currentProcessingAmount: money(order.processingAmount)!,
      currentPackagingAmount: money(order.packagingAmount)!,
      currentTotalAmount: money(order.totalAmount)!,
      processingPriceBook: firstVersionEvidence(
        [
          ...order.items.map((item) => item.pricingSnapshot),
          ...order.packagingGroups.map((group) => group.pricingSnapshot),
        ],
        "processing",
      ),
      logisticsPriceBook: includesShipmentCharges
        ? firstVersionEvidence(
            order.customerCharges
              .filter(isShipmentCustomerCharge)
              .map((charge) => charge.pricingSnapshot),
            "logistics",
          )
        : null,
      items: order.items.map((item) => {
        const complete = !itemRequiresManual(item);
        const snapshot = record(item.pricingSnapshot);
        const hasUnknownManualAmount =
          !complete && snapshotHasUnknownManualAmount(item.pricingSnapshot);
        const errors = snapshotErrors(item.pricingSnapshot);
        if (!complete && errors.length === 0) {
          errors.push("该款式的报价快照标记为待人工核价");
        }
        return {
          itemId: item.id,
          sequence: item.sequence,
          name: item.name,
          quantity: item.quantity,
          complete,
          errors: [...new Set(errors)],
          manualQuoteReason: item.manualQuoteReason,
          currentUnitPrice: hasUnknownManualAmount
            ? ""
            : money(item.unitPrice, 4)!,
          currentFixedFee: hasUnknownManualAmount ? "" : money(item.fixedFee)!,
          currentSubtotal: hasUnknownManualAmount ? "" : money(item.subtotal)!,
          suggestedUnitPrice: complete
            ? (snapshotMoney(snapshot.suggestedUnitPrice, 4) ??
              money(item.unitPrice, 4))
            : snapshotMoney(snapshot.suggestedUnitPrice, 4),
          suggestedFixedFee: complete
            ? (snapshotMoney(snapshot.suggestedFixedFee, 2) ??
              money(item.fixedFee))
            : snapshotMoney(snapshot.suggestedFixedFee, 2),
          suggestedSubtotal:
            money(item.suggestedSubtotal) ??
            snapshotMoney(snapshot.suggestedSubtotal, 2) ??
            (complete ? money(item.subtotal) : null),
          currentReason: item.priceOverrideReason,
        };
      }),
      packagingGroups: order.packagingGroups.map((group) => {
        const complete = !packagingRequiresManual(group);
        const snapshot = record(group.pricingSnapshot);
        const hasUnknownManualAmount =
          !complete && snapshotHasUnknownManualAmount(group.pricingSnapshot);
        const actual = record(snapshot.actual);
        const basis = record(record(snapshot.line).basis);
        const errors = snapshotErrors(group.pricingSnapshot);
        if (!complete && errors.length === 0) {
          errors.push("该包装组报价快照标记为待人工核价");
        }
        return {
          packagingGroupId: group.id,
          sequence: group.sequence,
          name: group.name,
          mode: group.mode,
          actualBagCount: group.actualBagCount,
          complete,
          errors,
          currentUnitPrice: hasUnknownManualAmount
            ? ""
            : money(group.unitPrice, 4)!,
          currentSubtotal: hasUnknownManualAmount
            ? ""
            : money(group.subtotal)!,
          suggestedUnitPrice: complete
            ? (snapshotMoney(snapshot.suggestedUnitPrice, 4) ??
              snapshotMoney(actual.unitPrice, 4) ??
              snapshotMoney(basis.rate, 4) ??
              money(group.unitPrice, 4))
            : snapshotMoney(snapshot.suggestedUnitPrice, 4),
          suggestedSubtotal:
            money(group.suggestedSubtotal) ??
            snapshotMoney(snapshot.suggestedSubtotal, 2) ??
            (complete ? money(group.subtotal) : null),
          currentReason: group.priceOverrideReason,
        };
      }),
      orderCharges: order.customerCharges
        .filter(
          (charge) =>
            charge.shipmentId === null &&
            !isShipmentCustomerCharge(charge) &&
            chargeRequiresManual(charge),
        )
        .map((charge) => {
          const errors = snapshotErrors(charge.pricingSnapshot);
          if (errors.length === 0) {
            errors.push("该订单级收费快照标记为待人工核价");
          }
          return {
            chargeId: charge.id,
            businessKey: charge.businessKey,
            categoryCode: charge.category.code,
            description: charge.description,
            complete: false as const,
            errors,
            suggestedAmount: money(charge.suggestedAmount),
            currentAmount: money(charge.amount),
            currentReason: charge.overrideReason,
          };
        }),
      shipments: includesShipmentCharges
        ? order.shipments.map((shipment) => {
            const shipping = chargeByShipmentAndCode(
              shipmentChargeByBusinessKey,
              shipment,
              "SHIPPING_FEE",
            );
            const packaging = chargeByShipmentAndCode(
              shipmentChargeByBusinessKey,
              shipment,
              "PACKING_MATERIAL",
            );
            return {
              shipmentId: shipment.id,
              sequence: shipment.sequence,
              destinationProvince: shipment.destinationProvince,
              billableWeightKg: snapshotBillableWeightKg(shipment, shipping),
              itemQuantity: shipment.lines.reduce(
                (sum, line) => sum + line.quantity,
                0,
              ),
              shipping: previewCharge(shipping),
              packaging: previewCharge(packaging),
              currentReason:
                packaging?.overrideReason ?? shipping?.overrideReason ?? null,
            };
          })
        : [],
    };
  });
}

function validateUniqueIds<T>(
  rows: readonly T[],
  getId: (row: T) => string,
  message: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const id = getId(row);
    if (result.has(id)) throw new OrderPricingReviewError(message);
    result.set(id, row);
  }
  return result;
}

function sameNullableDecimal(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  try {
    return new Decimal(left).eq(right);
  } catch {
    return false;
  }
}

function validateFinalPricingSubmissions(
  input: FinalizeOrderPricingCommand,
  order: PricingOrder,
) {
  const includesShipmentCharges = reviewsShipmentCustomerCharges(order);
  const shipmentChargeByBusinessKey = includesShipmentCharges
    ? assertShipmentCustomerChargeIdentity(order)
    : new Map<string, PricingCustomerCharge>();

  const submittedItems = validateUniqueIds(
    input.items,
    (item) => item.itemId,
    "同一款式不能重复提交终价",
  );
  if (
    [...submittedItems.keys()].some(
      (id) => !order.items.some((item) => item.id === id),
    )
  ) {
    throw new OrderPricingReviewError("终价明细包含不属于该工单的款式");
  }
  const submittedGroups = validateUniqueIds(
    input.packagingGroups,
    (group) => group.packagingGroupId,
    "同一包装组不能重复提交终价",
  );
  if (
    submittedGroups.size !== order.packagingGroups.length ||
    order.packagingGroups.some((group) => !submittedGroups.has(group.id))
  ) {
    throw new OrderPricingReviewError("请完整确认每一个包装组的包装费");
  }
  for (const group of order.packagingGroups) {
    const submitted = submittedGroups.get(group.id)!;
    if (
      submitted.expectedMode !== group.mode ||
      submitted.expectedActualBagCount !== group.actualBagCount
    ) {
      throw new OrderPricingReviewError(
        `包装组 ${group.sequence} 的模式或包装数量已变更，请刷新后按当前快照重新核价`,
      );
    }
  }
  if (!includesShipmentCharges && input.shipments.length > 0) {
    throw new OrderPricingReviewError(
      "快递费与打包耗材应收仅适用于外部销售结算工单",
    );
  }
  const submittedShipments = validateUniqueIds(
    input.shipments,
    (shipment) => shipment.shipmentId,
    "同一发货地址不能重复提交收费",
  );
  if (
    includesShipmentCharges &&
    (submittedShipments.size !== order.shipments.length ||
      order.shipments.some((shipment) => !submittedShipments.has(shipment.id)))
  ) {
    throw new OrderPricingReviewError(
      "请完整确认每一个发货地址的快递费和打包耗材费",
    );
  }
  for (const shipment of includesShipmentCharges ? order.shipments : []) {
    const submitted = submittedShipments.get(shipment.id)!;
    const shipping = chargeByShipmentAndCode(
      shipmentChargeByBusinessKey,
      shipment,
      "SHIPPING_FEE",
    );
    if (
      submitted.expectedDestinationProvince !== shipment.destinationProvince ||
      !sameNullableDecimal(
        submitted.expectedBillableWeightKg,
        snapshotBillableWeightKg(shipment, shipping),
      )
    ) {
      throw new OrderPricingReviewError(
        `地址 ${shipment.sequence} 的计费省份或重量已变更，请刷新后按当前快照重新核价`,
      );
    }
  }

  const expectedOrderCharges = order.customerCharges.filter(
    (charge) =>
      charge.shipmentId === null &&
      !isShipmentCustomerCharge(charge) &&
      chargeRequiresManual(charge),
  );
  const submittedOrderCharges = validateUniqueIds(
    input.orderCharges,
    (charge) => charge.chargeId,
    "同一订单级待核价费用不能重复提交",
  );
  if (
    submittedOrderCharges.size !== expectedOrderCharges.length ||
    expectedOrderCharges.some(
      (charge) => !submittedOrderCharges.has(charge.id),
    )
  ) {
    throw new OrderPricingReviewError("请完整确认每一项订单级待核价费用");
  }
  for (const charge of expectedOrderCharges) {
    const submitted = submittedOrderCharges.get(charge.id)!;
    if (submitted.expectedBusinessKey !== charge.businessKey) {
      throw new OrderPricingReviewError(
        `订单级收费“${charge.description}”已变更，请刷新后重新核价`,
      );
    }
  }

  const manualItems = order.items.flatMap((item) => {
    if (!itemRequiresManual(item)) return [];
    const submitted = submittedItems.get(item.id);
    const unitPrice = parseManualMoney(
      submitted?.unitPrice,
      `款式“${item.name}”的客户单价`,
      DECIMAL_10_4_MAX,
      4,
    );
    const fixedFee = parseManualMoney(
      submitted?.fixedFee,
      `款式“${item.name}”的一次性费用`,
      DECIMAL_12_2_MAX,
      2,
    );
    const reason = requiredReason(
      submitted?.reason,
      `款式“${item.name}”需人工核价`,
    );
    const subtotal = unitPrice
      .times(item.quantity)
      .plus(fixedFee)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (subtotal.gt(DECIMAL_12_2_MAX)) {
      throw new OrderPricingReviewError(
        `款式“${item.name}”的小计超出系统允许范围`,
      );
    }
    return [{
      item,
      unitPrice: unitPrice.toFixed(4),
      fixedFee: fixedFee.toFixed(2),
      subtotal: subtotal.toFixed(2),
      reason,
    }];
  });
  const manualItemIds = new Set(manualItems.map(({ item }) => item.id));
  if ([...submittedItems.keys()].some((id) => !manualItemIds.has(id))) {
    throw new OrderPricingReviewError(
      "已锁定快照价的款式不接受人工改价，请刷新后重试",
    );
  }

  return { includesShipmentCharges, shipmentChargeByBusinessKey,
    submittedGroups, submittedShipments, expectedOrderCharges,
    submittedOrderCharges, manualItems };
}

export async function finalizeOrderPricing(
  input: FinalizeOrderPricingCommand,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<{
  orderId: string;
  priceRevision: number;
  packagingAmount: string;
  processingAmount: string;
  totalAmount: string;
  confirmedFee: string;
  productionReadiness?: { ready: boolean; issues: string[] };
  processingPriceBookVersion: number | null;
  logisticsPriceBookVersion: number | null;
}> {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      input.orderId,
    )}))`;
    const order = await readPricingOrder(tx, input.orderId);
    if (!order) throw new OrderPricingReviewError("工单不存在");
    assertReviewable(order);
    const pendingRequest = await tx.orderChangeRequest.findFirst({
      where: { orderId: order.id, status: OrderChangeRequestStatus.PENDING },
      select: { id: true },
    });
    if (pendingRequest) throw new OrderPricingReviewError('存在待审批申请，请先处理申请后再核价');

    assertStructuredPlateChargesConsistent(order);
    if (order.priceRevision !== input.expectedPriceRevision) {
      throw new OrderPricingReviewError(
        "工单价格已被其他人更新，请刷新后重新核对",
      );
    }
    if (order.revision !== input.expectedOrderRevision) {
      throw new OrderPricingReviewError(
        "工单款式、数量或发货信息已变更，请刷新并按当前快照重新核价",
      );
    }
    const { includesShipmentCharges, shipmentChargeByBusinessKey,
      submittedGroups, submittedShipments, expectedOrderCharges,
      submittedOrderCharges, manualItems } =
      validateFinalPricingSubmissions(input, order);

    const manualGroups = order.packagingGroups.flatMap((group) => {
      if (!packagingRequiresManual(group)) return [];
      const submitted = submittedGroups.get(group.id)!;
      const unitPrice = parseManualMoney(
        submitted.unitPrice,
        `包装组 ${group.sequence} 的每${packagingUnit(group.mode)}包装费`,
        DECIMAL_10_4_MAX,
        4,
      );
      if (group.mode === OrderPackagingMode.UNPACKED && !unitPrice.isZero()) {
        throw new OrderPricingReviewError('不包装的包装费必须为 0');
      }
      const reason = requiredReason(
        submitted.reason,
        `包装组 ${group.sequence} 需人工核价`,
      );
      const subtotal = unitPrice
        .times(group.actualBagCount)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (subtotal.gt(DECIMAL_12_2_MAX)) {
        throw new OrderPricingReviewError(
          `包装组 ${group.sequence} 的包装费小计超出系统允许范围`,
        );
      }
      return [{
        group,
        unitPrice: unitPrice.toFixed(4),
        subtotal: subtotal.toFixed(2),
        reason,
      }];
    });

    const manualOrderCharges = expectedOrderCharges.map((charge) => {
      const submitted = submittedOrderCharges.get(charge.id)!;
      return {
        charge,
        amount: parseManualMoney(
          submitted.amount,
          `订单级收费“${charge.description}”`,
          DECIMAL_12_2_MAX,
          2,
        ).toFixed(2),
        reason: requiredReason(
          submitted.reason,
          `订单级收费“${charge.description}”需人工核价`,
        ),
      };
    });

    type ManualCharge = {
      shipment: PricingShipment;
      code: ShipmentChargeCode;
      previous: PricingCustomerCharge | undefined;
      amount: string;
      reason: string;
    };
    const manualCharges: ManualCharge[] = [];
    for (const shipment of includesShipmentCharges ? order.shipments : []) {
      const submitted = submittedShipments.get(shipment.id)!;
      const pairs: Array<[ShipmentChargeCode, string, string]> = [
        ["SHIPPING_FEE", submitted.shippingFee, "快递费"],
        ["PACKING_MATERIAL", submitted.packingMaterialFee, "打包耗材费"],
      ];
      const needsManual = pairs.some(([code]) =>
        chargeRequiresManual(
          chargeByShipmentAndCode(
            shipmentChargeByBusinessKey,
            shipment,
            code,
          ),
        ),
      );
      const reason = needsManual
        ? requiredReason(
            submitted.reason,
            `地址 ${shipment.sequence} 存在待人工确认收费`,
          )
        : "";
      for (const [code, rawAmount, label] of pairs) {
        const previous = chargeByShipmentAndCode(
          shipmentChargeByBusinessKey,
          shipment,
          code,
        );
        if (!chargeRequiresManual(previous)) continue;
        const amount = parseManualMoney(
          rawAmount,
          `地址 ${shipment.sequence} 的${label}`,
          DECIMAL_12_2_MAX,
          2,
        ).toFixed(2);
        manualCharges.push({ shipment, code, previous, amount, reason });
      }
    }

    const itemSubtotalById = new Map(
      manualItems.map(({ item, subtotal }) => [item.id, subtotal]),
    );
    const itemAmount = order.items.reduce(
      (sum, item) =>
        sum.plus(itemSubtotalById.get(item.id) ?? item.subtotal.toString()),
      new Decimal(0),
    );
    const groupSubtotalById = new Map(
      manualGroups.map(({ group, subtotal }) => [group.id, subtotal]),
    );
    const packagingTotal = order.packagingGroups.reduce(
      (sum, group) =>
        sum.plus(groupSubtotalById.get(group.id) ?? group.subtotal.toString()),
      new Decimal(0),
    );
    const chargeAmountById = new Map(
      [
        ...manualCharges
          .filter((charge) => charge.previous)
          .map((charge) => [charge.previous!.id, charge.amount] as const),
        ...manualOrderCharges.map(
          ({ charge, amount }) => [charge.id, amount] as const,
        ),
      ],
    );
    const existingChargeTotal = order.customerCharges
      .filter(
        (charge) =>
          includesShipmentCharges || !isShipmentCustomerCharge(charge),
      )
      .reduce((sum, charge) => {
        const amount = chargeAmountById.get(charge.id) ?? money(charge.amount);
        return amount === null ? sum : sum.plus(amount);
      }, new Decimal(0));
    const createdChargeTotal = manualCharges
      .filter((charge) => !charge.previous)
      .reduce((sum, charge) => sum.plus(charge.amount), new Decimal(0));
    const customerChargeTotal = existingChargeTotal.plus(createdChargeTotal);
    const processingTotal = itemAmount.plus(packagingTotal);
    const total = processingTotal.plus(customerChargeTotal);
    if (total.isNegative()) {
      throw new OrderPricingReviewError("工单总额不能为负数");
    }
    if (total.gt(DECIMAL_12_2_MAX)) {
      throw new OrderPricingReviewError("工单总额超出系统允许范围");
    }
    const packagingAmount = packagingTotal.toFixed(2);
    const processingAmount = processingTotal.toFixed(2);
    const totalAmount = total.toFixed(2);
    const csSalesDelta = total.minus(order.totalAmount.toString());
    if (
      order.settlementType === OrderSettlementType.INTERNAL_SALES &&
      order.billingMode === OrderBillingMode.CHARGE &&
      !csSalesDelta.isZero()
    ) {
      const nextOrderRevision = order.revision + 1;
      try {
        await assertCsOrderSalesLedgerReconciledInTx(
          tx,
          order.id,
          order.totalAmount.toString(),
        );
        await recordCsSalesEntryInTx(tx, {
          eventKey: `order:${order.id}:revision:${nextOrderRevision}:change`,
          csUserId: order.submitterId,
          orderId: order.id,
          orderRevision: nextOrderRevision,
          type: CsSalesEntryType.ORDER_CHANGED,
          amount: csSalesDelta,
          occurredAt: now,
          remark: "管理员确认工单终价",
        });
      } catch (error) {
        if (error instanceof CsSalesLedgerError) {
          throw new OrderPricingReviewError(error.message);
        }
        throw error;
      }
    }

    for (const manual of manualItems) {
      await tx.orderItem.update({
        where: { id: manual.item.id },
        data: {
          unitPrice: manual.unitPrice,
          fixedFee: manual.fixedFee,
          subtotal: manual.subtotal,
          priceOverrideReason: manual.reason,
          pricingSnapshot: buildTrustedAdminItemPricingSnapshot({
            previous: manual.item.pricingSnapshot,
            now,
            actorId: actor.id,
            previousPriceRevision: order.priceRevision,
            item: {
              ...manual.item,
              unitPrice: manual.unitPrice,
              fixedFee: manual.fixedFee,
              subtotal: manual.subtotal,
              priceOverrideReason: manual.reason,
            },
          }),
        },
      });
    }
    for (const manual of manualGroups) {
      await tx.orderPackagingGroup.update({
        where: { id: manual.group.id },
        data: {
          unitPrice: manual.unitPrice,
          subtotal: manual.subtotal,
          priceOverrideReason: manual.reason,
          pricingSnapshot: buildTrustedAdminPackagingPricingSnapshot({
            previous: manual.group.pricingSnapshot,
            now,
            actorId: actor.id,
            previousPriceRevision: order.priceRevision,
            group: {
              ...manual.group,
              unitPrice: manual.unitPrice,
              subtotal: manual.subtotal,
              priceOverrideReason: manual.reason,
            },
          }),
        },
      });
    }

    for (const manual of manualOrderCharges) {
      const isShipped = order.status === OrderStatus.SHIPPED;
      const status = isShipped
        ? OrderCustomerChargeStatus.FINAL
        : OrderCustomerChargeStatus.ESTIMATED;
      await tx.orderCustomerCharge.update({
        where: { id: manual.charge.id },
        data: {
          amount: manual.amount,
          status,
          overrideReason: manual.reason,
          pricingSnapshot: buildTrustedAdminChargePricingSnapshot({
            previous: manual.charge.pricingSnapshot,
            now,
            actorId: actor.id,
            previousPriceRevision: order.priceRevision,
            charge: {
              orderId: order.id,
              businessKey: manual.charge.businessKey,
              shipmentId: manual.charge.shipmentId,
              categoryCode: manual.charge.category.code,
              status,
              priceBookId: manual.charge.priceBookId,
              sourceRuleId: manual.charge.sourceRuleId,
              quantity: manual.charge.quantity,
              unit: manual.charge.unit,
              unitPrice: manual.charge.unitPrice,
              suggestedAmount: manual.charge.suggestedAmount,
              amount: manual.amount,
              isAdjustment: manual.charge.isAdjustment,
              approvalReference: manual.charge.approvalReference,
              overrideReason: manual.reason,
            },
          }),
          finalizedById: isShipped ? actor.id : null,
          finalizedAt: isShipped ? now : null,
        },
        select: { id: true },
      });
    }

    const categoryByCode = new Map<
      ShipmentChargeCode,
      { id: string; name: string }
    >();
    for (const manual of manualCharges) {
      const isShipped = order.status === OrderStatus.SHIPPED;
      const status = isShipped
        ? OrderCustomerChargeStatus.FINAL
        : OrderCustomerChargeStatus.ESTIMATED;
      const pricingSnapshot = buildTrustedAdminChargePricingSnapshot({
        previous: manual.previous?.pricingSnapshot,
        now,
        actorId: actor.id,
        previousPriceRevision: order.priceRevision,
        charge: {
          orderId: order.id,
          businessKey: shipmentChargeKey(manual.shipment.sequence, manual.code),
          shipmentId: manual.shipment.id,
          categoryCode: manual.code,
          status,
          priceBookId: manual.previous?.priceBookId ?? null,
          sourceRuleId: manual.previous?.sourceRuleId ?? null,
          quantity: manual.previous?.quantity ?? null,
          unit: manual.previous?.unit ?? null,
          unitPrice: manual.previous?.unitPrice ?? null,
          suggestedAmount: manual.previous?.suggestedAmount ?? null,
          amount: manual.amount,
          isAdjustment: manual.previous?.isAdjustment ?? false,
          approvalReference: manual.previous?.approvalReference ?? null,
          overrideReason: manual.reason,
        },
      });
      if (manual.previous) {
        await tx.orderCustomerCharge.update({
          where: { id: manual.previous.id },
          data: {
            amount: manual.amount,
            status,
            overrideReason: manual.reason,
            pricingSnapshot,
            finalizedById: isShipped ? actor.id : null,
            finalizedAt: isShipped ? now : null,
          },
          select: { id: true },
        });
        continue;
      }
      let category = categoryByCode.get(manual.code);
      if (!category) {
        const foundCategory = await tx.customerChargeCategory.findUnique({
          where: { code: manual.code },
          select: { id: true, name: true },
        });
        if (!foundCategory) {
          throw new OrderPricingReviewError(
            `收费类目 ${manual.code} 不存在，无法保存人工核价`,
          );
        }
        category = foundCategory;
        categoryByCode.set(manual.code, category);
      }
      await tx.orderCustomerCharge.create({
        data: {
          orderId: order.id,
          shipmentId: manual.shipment.id,
          categoryId: category.id,
          priceBookId: null,
          sourceRuleId: null,
          businessKey: shipmentChargeKey(manual.shipment.sequence, manual.code),
          status,
          description: category.name,
          quantity: null,
          unit: null,
          unitPrice: null,
          suggestedAmount: null,
          amount: manual.amount,
          pricingSnapshot,
          overrideReason: manual.reason,
          createdById: actor.id,
          finalizedById: isShipped ? actor.id : null,
          finalizedAt: isShipped ? now : null,
        },
        select: { id: true },
      });
    }

    const orderModel = tx.order as unknown as {
      update(args: unknown): Promise<{ id: string }>;
    };
    await orderModel.update({
      where: { id: order.id },
      data: {
        packagingAmount,
        processingAmount,
        totalAmount,
        confirmedFee: totalAmount,
      },
      select: { id: true },
    });

    const processingPriceBook = firstVersionEvidence(
      [
        ...order.items.map((item) => item.pricingSnapshot),
        ...order.packagingGroups.map((group) => group.pricingSnapshot),
      ],
      "processing",
    );
    const logisticsPriceBook = includesShipmentCharges
      ? firstVersionEvidence(
          order.customerCharges
            .filter(isShipmentCustomerCharge)
            .map((charge) => charge.pricingSnapshot),
          "logistics",
        )
      : null;
    const revision = await appendOrderPricingRevisionInTx(tx, {
      orderId: order.id,
      status: ORDER_PRICING_STATUS.ADMIN_CONFIRMED,
      source: ADMIN_SNAPSHOT_CONFIRMATION_SOURCE,
      actorId: actor.id,
      now,
      expectedPriceRevision: order.priceRevision,
      incrementOrderRevision: true,
      remark: input.remark,
      metadata: {
        priceVersions: {
          processing: processingPriceBook,
          logistics: logisticsPriceBook,
        },
        manualItemIds: manualItems.map(({ item }) => item.id),
        manualPackagingGroupIds: manualGroups.map(({ group }) => group.id),
        manualCustomerChargeKeys: [
          ...manualOrderCharges.map(({ charge }) => charge.businessKey),
          ...manualCharges.map(({ shipment, code }) =>
            shipmentChargeKey(shipment.sequence, code),
          ),
        ],
        packagingAmount,
        customerChargeAmount: customerChargeTotal.toFixed(2),
      },
    });
    let productionReadiness: { ready: boolean; issues: string[] } | undefined;
    if (
      order.status === OrderStatus.PENDING_FACTORY ||
      order.status === OrderStatus.SUBMITTED
    ) {
      const prepared = await prepareOrderForProductionInTx(tx, order.id, actor, now);
      productionReadiness = { ready: prepared.ready, issues: prepared.issues };
      if (!prepared.ready) {
        await tx.orderLog.create({ data: {
          orderId: order.id, operatorId: actor.id, action: 'PRICING_CONFIRMED_NOT_READY',
          remark: `终价已保存，生产资料待补齐：${prepared.issues.join('；')}`,
        } });
      }
    }
    await tx.orderLog.create({
      data: {
        orderId: order.id,
        operatorId: actor.id,
        action: "PRICING_ADMIN_CONFIRMED",
        changedFields: {
          pricingStatus: {
            before: order.pricingStatus,
            after: ORDER_PRICING_STATUS.ADMIN_CONFIRMED,
          },
          priceRevision: {
            before: order.priceRevision,
            after: revision.priceRevision,
          },
          revision: { before: order.revision, after: revision.orderRevision },
          processingAmount: {
            before: money(order.processingAmount),
            after: processingAmount,
          },
          packagingAmount: {
            before: money(order.packagingAmount),
            after: packagingAmount,
          },
          totalAmount: {
            before: money(order.totalAmount),
            after: totalAmount,
          },
          confirmedFee: {
            before: money(order.confirmedFee),
            after: totalAmount,
          },
          quotedFee: {
            before: money(order.quotedFee),
            after: money(order.quotedFee),
          },
          settledFee: {
            before: money(order.settledFee),
            after: money(order.settledFee),
          },
        },
        remark: input.remark?.trim() || "管理员按工单既有报价快照确认终价",
      },
    });

    return {
      orderId: order.id,
      priceRevision: revision.priceRevision,
      packagingAmount,
      processingAmount,
      totalAmount,
      confirmedFee: totalAmount,
      productionReadiness,
      processingPriceBookVersion: processingPriceBook?.version ?? null,
      logisticsPriceBookVersion: logisticsPriceBook?.version ?? null,
    };
  });
}
