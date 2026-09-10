import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';

type JsonRecord = Record<string, unknown>;
type MoneyLike = { toString(): string } | string | number;

export const ADMIN_SNAPSHOT_CONFIRMATION_SOURCE =
  'ADMIN_SNAPSHOT_CONFIRMATION';

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Builds the complete persisted trust envelope for an administrator-confirmed
 * price. Callers supply the authoritative amount fields; this helper owns the
 * marker and confirmation fields consumed by the shared trust boundary.
 */
export function buildTrustedAdminPricingSnapshot(args: {
  previous: unknown;
  now: Date;
  actorId: string;
  previousPriceRevision: number;
  actual: JsonRecord;
  manualQuoteReason?: string | null;
}): Prisma.InputJsonObject {
  const previous = record(args.previous);
  return {
    ...previous,
    source: ADMIN_SNAPSHOT_CONFIRMATION_SOURCE,
    status: 'ADMIN_CONFIRMED',
    previousPriceRevision: args.previousPriceRevision,
    ...(args.manualQuoteReason
      ? { manualQuoteReason: args.manualQuoteReason }
      : {}),
    actual: {
      ...record(previous.actual),
      ...args.actual,
      provisional: false,
      requiresAdminConfirmation: false,
      automatic: false,
    },
    confirmation: {
      actorId: args.actorId,
      confirmedAt: args.now.toISOString(),
      reason: optionalText(args.actual.overrideReason),
    },
  } as Prisma.InputJsonObject;
}

export type AdminChargePricingSnapshotFacts = {
  orderId: string;
  businessKey: string;
  shipmentId: string | null;
  categoryCode: string;
  status: string;
  priceBookId: string | null;
  sourceRuleId: string | null;
  quantity: MoneyLike | null;
  unit: string | null;
  unitPrice: MoneyLike | null;
  suggestedAmount: MoneyLike | null;
  amount: MoneyLike;
  isAdjustment: boolean;
  approvalReference: string | null;
  overrideReason: string | null;
};

export type AdminItemPricingSnapshotFacts = {
  orderId: string;
  id: string;
  productId: string | null;
  pricingRoute: string;
  craft: string | null;
  productStructure: string;
  plateGroupId: string | null;
  pricingGroup: string | null;
  manualQuoteReason: string | null;
  specification: string | null;
  actualWidthMm: MoneyLike | null;
  actualHeightMm: MoneyLike | null;
  paperType: string | null;
  paperWeightGsm: number | null;
  quantity: number;
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
  quoteDisposition: string | null;
  unitPrice: MoneyLike;
  fixedFee: MoneyLike;
  subtotal: MoneyLike;
  priceOverrideReason: string | null;
};

export type AdminPackagingPricingSnapshotFacts = {
  orderId: string;
  id: string;
  mode: string;
  actualBagCount: number;
  unitPrice: MoneyLike;
  subtotal: MoneyLike;
  priceOverrideReason: string | null;
  lines: ReadonlyArray<{ orderItemId: string; unitsPerBag: number }>;
};

function canonicalUpperText(value: string): string {
  return value.trim().toUpperCase();
}

function canonicalNullableText(value: string | null): string | null {
  return value?.trim() || null;
}

function canonicalMoney(value: MoneyLike, scale: number): string {
  return new Decimal(value.toString()).toFixed(scale);
}

function canonicalOptionalMoney(
  value: MoneyLike | null,
  scale: number,
): string | null {
  return value === null ? null : canonicalMoney(value, scale);
}

function canonicalStringList(values: readonly string[]): string[] {
  return values
    .map((value) => value.trim())
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function canonicalItemActual(
  item: AdminItemPricingSnapshotFacts,
): JsonRecord {
  return {
    orderId: item.orderId.trim(),
    itemId: item.id.trim(),
    productId: canonicalNullableText(item.productId),
    pricingRoute: canonicalUpperText(item.pricingRoute),
    craft: canonicalNullableText(item.craft)?.toUpperCase() ?? null,
    productStructure: canonicalUpperText(item.productStructure),
    plateGroupId: canonicalNullableText(item.plateGroupId),
    pricingGroup: canonicalNullableText(item.pricingGroup)?.toUpperCase() ?? null,
    manualQuoteReason: canonicalNullableText(item.manualQuoteReason),
    specification: canonicalNullableText(item.specification),
    actualWidthMm: canonicalOptionalMoney(item.actualWidthMm, 2),
    actualHeightMm: canonicalOptionalMoney(item.actualHeightMm, 2),
    paperType: canonicalNullableText(item.paperType),
    paperWeightGsm: item.paperWeightGsm,
    quantity: item.quantity,
    pack: item.pack,
    crafts: canonicalStringList(item.crafts),
    frontFoilColors: canonicalStringList(item.frontFoilColors),
    backFoilColors: canonicalStringList(item.backFoilColors),
    foilColors: canonicalStringList(item.foilColors),
    foilTechnique: canonicalUpperText(item.foilTechnique),
    hasLocalFoil: item.hasLocalFoil,
    lamination: canonicalUpperText(item.lamination),
    printColors: canonicalStringList(item.printColors),
    printColorsKnown: item.printColorsKnown,
    isDoubleSided: item.isDoubleSided,
    isDoubleColor: item.isDoubleColor,
    quoteDisposition:
      canonicalNullableText(item.quoteDisposition)?.toUpperCase() ?? null,
    unitPrice: canonicalMoney(item.unitPrice, 4),
    fixedFee: canonicalMoney(item.fixedFee, 2),
    subtotal: canonicalMoney(item.subtotal, 2),
    overrideReason: canonicalNullableText(item.priceOverrideReason),
  };
}

function canonicalPackagingActual(
  group: AdminPackagingPricingSnapshotFacts,
): JsonRecord {
  return {
    orderId: group.orderId.trim(),
    groupId: group.id.trim(),
    mode: canonicalUpperText(group.mode),
    actualBagCount: group.actualBagCount,
    unitPrice: canonicalMoney(group.unitPrice, 4),
    subtotal: canonicalMoney(group.subtotal, 2),
    overrideReason: canonicalNullableText(group.priceOverrideReason),
    members: [...group.lines]
      .map((line) => ({
        orderItemId: line.orderItemId.trim(),
        unitsPerBag: line.unitsPerBag,
      }))
      .sort((left, right) =>
        left.orderItemId < right.orderItemId
          ? -1
          : left.orderItemId > right.orderItemId
            ? 1
            : left.unitsPerBag - right.unitsPerBag,
      ),
  };
}

function canonicalChargeActual(
  charge: AdminChargePricingSnapshotFacts,
): JsonRecord {
  return {
    orderId: charge.orderId.trim(),
    businessKey: canonicalUpperText(charge.businessKey),
    shipmentId: charge.shipmentId?.trim() || null,
    categoryCode: canonicalUpperText(charge.categoryCode),
    status: canonicalUpperText(charge.status),
    priceBookId: canonicalNullableText(charge.priceBookId),
    sourceRuleId: canonicalNullableText(charge.sourceRuleId),
    quantity: canonicalOptionalMoney(charge.quantity, 3),
    unit: canonicalNullableText(charge.unit),
    unitPrice: canonicalOptionalMoney(charge.unitPrice, 4),
    suggestedAmount: canonicalOptionalMoney(charge.suggestedAmount, 2),
    amount: canonicalMoney(charge.amount, 2),
    isAdjustment: charge.isAdjustment,
    approvalReference: canonicalNullableText(charge.approvalReference),
    overrideReason: nonEmptyText(charge.overrideReason),
  };
}

function matchesCanonicalFields(
  actual: JsonRecord,
  expected: JsonRecord,
): boolean {
  return Object.entries(expected).every(
    ([key, expectedValue]) =>
      Object.prototype.hasOwnProperty.call(actual, key) &&
      JSON.stringify(actual[key]) === JSON.stringify(expectedValue),
  );
}

export function buildTrustedAdminItemPricingSnapshot(args: {
  previous: unknown;
  now: Date;
  actorId: string;
  previousPriceRevision: number;
  item: AdminItemPricingSnapshotFacts;
}): Prisma.InputJsonObject {
  return buildTrustedAdminPricingSnapshot({
    previous: args.previous,
    now: args.now,
    actorId: args.actorId,
    previousPriceRevision: args.previousPriceRevision,
    manualQuoteReason: args.item.manualQuoteReason,
    actual: canonicalItemActual(args.item),
  });
}

export function buildTrustedAdminPackagingPricingSnapshot(args: {
  previous: unknown;
  now: Date;
  actorId: string;
  previousPriceRevision: number;
  group: AdminPackagingPricingSnapshotFacts;
}): Prisma.InputJsonObject {
  return buildTrustedAdminPricingSnapshot({
    previous: args.previous,
    now: args.now,
    actorId: args.actorId,
    previousPriceRevision: args.previousPriceRevision,
    actual: canonicalPackagingActual(args.group),
  });
}

/**
 * Charge confirmations need a stronger identity boundary than generic item or
 * packaging amounts: the same amount and reason may legitimately occur on
 * several rows. Persist the canonical accounting tuple in the trusted actual
 * envelope so a copied snapshot cannot authorize a different charge.
 */
export function buildTrustedAdminChargePricingSnapshot(args: {
  previous: unknown;
  now: Date;
  actorId: string;
  previousPriceRevision: number;
  charge: AdminChargePricingSnapshotFacts;
}): Prisma.InputJsonObject {
  return buildTrustedAdminPricingSnapshot({
    previous: args.previous,
    now: args.now,
    actorId: args.actorId,
    previousPriceRevision: args.previousPriceRevision,
    actual: canonicalChargeActual(args.charge),
  });
}

/**
 * Envelope-only trust check for persisted administrator pricing decisions.
 * Use one of the row-bound validators below whenever live item, packaging, or
 * charge facts are available; this generic check is for marker-only routing.
 * Partial markers stay editable/fail closed instead of being trusted by only
 * one stage of the pricing workflow.
 */
export function isTrustedAdminPricingSnapshot(value: unknown): boolean {
  const snapshot = record(value);
  const actual = record(snapshot.actual);
  const confirmation = record(snapshot.confirmation);
  const confirmedAt = nonEmptyText(confirmation.confirmedAt);

  return (
    snapshot.source === ADMIN_SNAPSHOT_CONFIRMATION_SOURCE &&
    snapshot.status === 'ADMIN_CONFIRMED' &&
    actual.provisional === false &&
    actual.requiresAdminConfirmation === false &&
    actual.automatic === false &&
    Number.isSafeInteger(snapshot.previousPriceRevision) &&
    Number(snapshot.previousPriceRevision) >= 0 &&
    nonEmptyText(confirmation.actorId) !== null &&
    confirmedAt !== null &&
    Number.isFinite(Date.parse(confirmedAt))
  );
}

/**
 * Returns whether a snapshot claims to be an administrator confirmation, even
 * when the rest of the trust envelope is absent or stale. Callers use this to
 * fail closed: a partial/legacy confirmation must be reopened for review, not
 * silently treated as automatic pricing.
 */
export function hasAdminPricingConfirmationMarker(value: unknown): boolean {
  const snapshot = record(value);
  return (
    nonEmptyText(snapshot.status)?.toUpperCase() === 'ADMIN_CONFIRMED' ||
    nonEmptyText(snapshot.source)?.toUpperCase() ===
      ADMIN_SNAPSHOT_CONFIRMATION_SOURCE
  );
}

function reasonMatches(
  actual: JsonRecord,
  confirmation: JsonRecord,
  expected: string | null,
): boolean {
  const expectedReason = nonEmptyText(expected);
  return (
    nonEmptyText(actual.overrideReason) === expectedReason &&
    nonEmptyText(confirmation.reason) === expectedReason
  );
}

/**
 * A confirmed item snapshot is usable only while every persisted pricing fact
 * it approved still matches the live row. Quantity is part of the trust
 * boundary because changing it without recomputing the subtotal would
 * otherwise let an old administrator marker approve a different order fact.
 */
export function isTrustedAdminItemPricingSnapshot(
  value: unknown,
  item: AdminItemPricingSnapshotFacts,
): boolean {
  if (!isTrustedAdminPricingSnapshot(value)) return false;
  const snapshot = record(value);
  const actual = record(snapshot.actual);
  const confirmation = record(snapshot.confirmation);

  try {
    return (
      matchesCanonicalFields(actual, canonicalItemActual(item)) &&
      reasonMatches(actual, confirmation, item.priceOverrideReason)
    );
  } catch {
    return false;
  }
}

/**
 * Packaging trust is bound to the bag count used by the calculation as well
 * as the persisted rate, subtotal, and administrator reason.
 */
export function isTrustedAdminPackagingPricingSnapshot(
  value: unknown,
  group: AdminPackagingPricingSnapshotFacts,
): boolean {
  if (!isTrustedAdminPricingSnapshot(value)) return false;
  const snapshot = record(value);
  const actual = record(snapshot.actual);
  const confirmation = record(snapshot.confirmation);

  try {
    return (
      matchesCanonicalFields(actual, canonicalPackagingActual(group)) &&
      reasonMatches(actual, confirmation, group.priceOverrideReason)
    );
  } catch {
    return false;
  }
}

/**
 * A persisted charge row is trusted only when its administrator envelope and
 * the complete accounting identity/amount/reason copied into that envelope
 * still agree with the live row. This prevents a repaired, copied, or partially
 * migrated row from borrowing an old confirmation marker for another charge.
 */
export function isTrustedAdminChargePricingSnapshot(
  value: unknown,
  charge: {
    orderId: string;
    businessKey: string;
    shipmentId: string | null;
    category: { code: string };
    status: string;
    priceBookId: string | null;
    sourceRuleId: string | null;
    quantity: MoneyLike | null;
    unit: string | null;
    unitPrice: MoneyLike | null;
    suggestedAmount: MoneyLike | null;
    amount: { toString(): string } | string | number | null;
    isAdjustment: boolean;
    approvalReference: string | null;
    overrideReason: string | null;
  },
): boolean {
  if (!isTrustedAdminPricingSnapshot(value) || charge.amount === null) {
    return false;
  }
  const snapshot = record(value);
  const actual = record(snapshot.actual);
  const confirmation = record(snapshot.confirmation);
  try {
    const expectedOrderId = nonEmptyText(charge.orderId);
    const expectedBusinessKey = nonEmptyText(charge.businessKey);
    const expectedCategoryCode = nonEmptyText(charge.category?.code);
    const expectedStatus = nonEmptyText(charge.status)?.toUpperCase() ?? null;
    const expectedShipmentId =
      charge.shipmentId === null ? null : nonEmptyText(charge.shipmentId);
    if (
      expectedOrderId === null ||
      expectedBusinessKey === null ||
      expectedCategoryCode === null ||
      expectedStatus === null ||
      expectedStatus === 'PENDING_AMOUNT' ||
      (charge.shipmentId !== null && expectedShipmentId === null)
    ) {
      return false;
    }
    const expected = canonicalChargeActual({
      ...charge,
      orderId: expectedOrderId,
      businessKey: expectedBusinessKey,
      shipmentId: expectedShipmentId,
      categoryCode: expectedCategoryCode,
      status: expectedStatus,
      amount: charge.amount,
    });
    return (
      matchesCanonicalFields(actual, expected) &&
      reasonMatches(actual, confirmation, charge.overrideReason)
    );
  } catch {
    return false;
  }
}
