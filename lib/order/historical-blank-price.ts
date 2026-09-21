import Decimal from 'decimal.js';
import {
  canonicalizeCreateOrderPaperFact,
  canonicalizeCreateOrderSpecification,
} from '@/lib/price/create-order/canonical-facts';

export type HistoricalBlankIdentity = {
  pricingRoute: string;
  paperType: string | null;
  paperWeightGsm: number | null;
  specification: string | null;
  actualWidthMm?: { toString(): string } | string | number | null;
  actualHeightMm?: { toString(): string } | string | number | null;
};

/** Only persisted, accepted order items may be passed to the quote service. */
export type HistoricalBlankItem = HistoricalBlankIdentity & {
  id: string;
  orderId: string;
  quantity: number;
  unitPrice: { toString(): string } | string;
  fixedFee: { toString(): string } | string;
  subtotal: { toString(): string } | string;
  pricingSnapshot: unknown;
};

export type ConfirmedHistoricalBlankPrice = {
  unitPrice: string;
  source: 'CONFIRMED_ITEM_MATERIAL_LINE' | 'ADMIN_MATERIAL_CONFIRMATION';
  sourcePriceBookId: string | null;
  sourcePriceBookVersion: number | null;
  confirmedAt: string | null;
  actorId: string | null;
  sourceItemId: string;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function decimal(value: unknown, scale: number): Decimal | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() && !parsed.isNegative() && parsed.decimalPlaces() <= scale
      ? parsed : null;
  } catch { return null; }
}

function identity(value: HistoricalBlankIdentity): string | null {
  if (value.pricingRoute !== 'STOCK_BLANK') return null;
  const paper = canonicalizeCreateOrderPaperFact(value.paperType ?? '', value.paperWeightGsm);
  const specification = canonicalizeCreateOrderSpecification(value.specification ?? '');
  return paper && specification
    ? JSON.stringify([paper.paperType, paper.paperWeightGsm, specification]) : null;
}

function dimension(value: HistoricalBlankIdentity['actualWidthMm']): string | null {
  if (value == null) return null;
  const parsed = decimal(value.toString(), 4);
  return parsed?.toString() ?? 'INVALID';
}

export function sameHistoricalBlankIdentity(
  stored: HistoricalBlankIdentity,
  projected: HistoricalBlankIdentity,
): boolean {
  const key = identity(stored);
  return key !== null && key === identity(projected) &&
    dimension(stored.actualWidthMm) === dimension(projected.actualWidthMm) &&
    dimension(stored.actualHeightMm) === dimension(projected.actualHeightMm);
}

/** Never infer the material price from a whole-item total or an override. */
export function readConfirmedHistoricalBlankPrice(
  item: HistoricalBlankItem,
): ConfirmedHistoricalBlankPrice | null {
  const key = identity(item);
  if (!key) return null;
  const snapshot = record(item.pricingSnapshot);
  const confirmation = record(snapshot.blankMaterialConfirmation);
  if (Object.keys(confirmation).length > 0) {
    const rate = decimal(confirmation.unitPrice, 4);
    if (confirmation.source !== 'ADMIN_MATERIAL_CONFIRMATION' ||
      confirmation.identity !== key || confirmation.orderId !== item.orderId ||
      confirmation.itemId !== item.id || confirmation.actualWidthMm !== dimension(item.actualWidthMm) ||
      confirmation.actualHeightMm !== dimension(item.actualHeightMm) || !rate || !rate.gt(0) || rate.gt('999999.9999') ||
      typeof confirmation.actorId !== 'string' || !confirmation.actorId.trim() ||
      typeof confirmation.confirmedAt !== 'string' || !Number.isFinite(Date.parse(confirmation.confirmedAt)) ||
      typeof confirmation.reason !== 'string' || !confirmation.reason.trim() ||
      !Number.isSafeInteger(confirmation.previousPriceRevision)) return null;
    return {
      unitPrice: rate.toFixed(4), source: 'ADMIN_MATERIAL_CONFIRMATION',
      sourcePriceBookId: null, sourcePriceBookVersion: null,
      confirmedAt: confirmation.confirmedAt, actorId: confirmation.actorId,
      sourceItemId: item.id,
    };
  }
  if (snapshot.engineVersion !== 'CREATE_ORDER_PURE_V1' || snapshot.complete !== true ||
    snapshot.status !== 'QUOTED' || !Array.isArray(snapshot.lines)) return null;
  const input = record(snapshot.input);
  if (input.craft !== 'PARTIAL' || record(input.configuration).specification !== 'CATALOG' ||
    identity({ pricingRoute: 'STOCK_BLANK', paperType: typeof input.paperType === 'string' ? input.paperType : null,
      paperWeightGsm: typeof input.paperWeightGsm === 'number' ? input.paperWeightGsm : null,
      specification: typeof input.specification === 'string' ? input.specification : null }) !== key ||
    input.quantity !== item.quantity) return null;
  for (const [snapshotField, actual, scale] of [
    ['suggestedUnitPrice', item.unitPrice, 4],
    ['suggestedFixedFee', item.fixedFee, 2],
    ['suggestedSubtotal', item.subtotal, 2],
  ] as const) {
    const value = decimal(snapshot[snapshotField], scale);
    if (!value || !value.eq(actual.toString())) return null;
  }
  const lines = snapshot.lines.map(record).filter((line) => line.code === 'PARTIAL_BLANK');
  if (lines.length !== 1) return null;
  const line = lines[0]!;
  const basis = record(line.basis);
  const rate = decimal(basis.unitPrice, 4);
  const amount = decimal(line.amount, 2);
  if (line.status !== 'QUOTED' || line.includedInKnownTotal !== true ||
    basis.quantity !== item.quantity || !rate || rate.gt('999999.9999') || !amount ||
    !rate.times(item.quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).eq(amount)) return null;
  const historicalSource = basis.historicalPriceSource;
  if (historicalSource !== undefined) {
    if ((historicalSource !== 'ADMIN_MATERIAL_CONFIRMATION' && historicalSource !== 'CONFIRMED_ITEM_MATERIAL_LINE') ||
      basis.sourceItemId !== item.id) return null;
    if (historicalSource === 'ADMIN_MATERIAL_CONFIRMATION' &&
      (typeof basis.actorId !== 'string' || !basis.actorId || typeof basis.confirmedAt !== 'string' ||
        !Number.isFinite(Date.parse(basis.confirmedAt)))) return null;
    if (historicalSource === 'CONFIRMED_ITEM_MATERIAL_LINE' &&
      (typeof basis.sourcePriceBookId !== 'string' || !basis.sourcePriceBookId ||
        !Number.isSafeInteger(basis.sourcePriceBookVersion))) return null;
    return { unitPrice: rate.toFixed(4), source: historicalSource,
      sourcePriceBookId: typeof basis.sourcePriceBookId === 'string' ? basis.sourcePriceBookId : null,
      sourcePriceBookVersion: typeof basis.sourcePriceBookVersion === 'number' ? basis.sourcePriceBookVersion : null,
      confirmedAt: typeof basis.confirmedAt === 'string' ? basis.confirmedAt : null,
      actorId: typeof basis.actorId === 'string' ? basis.actorId : null, sourceItemId: item.id };
  }
  const version = record(record(snapshot.priceVersion).processing);
  if (typeof version.id !== 'string' || !version.id || !Number.isSafeInteger(version.version)) return null;
  return {
    unitPrice: rate.toFixed(4), source: 'CONFIRMED_ITEM_MATERIAL_LINE',
    sourcePriceBookId: version.id, sourcePriceBookVersion: version.version as number,
    confirmedAt: null, actorId: null, sourceItemId: item.id,
  };
}

export function buildBlankMaterialConfirmation(input: {
  item: HistoricalBlankItem; unitPrice: string; reason: string; actorId: string;
  previousPriceRevision: number; now: Date;
}): Record<string, string | number | null> {
  const key = identity(input.item);
  const rate = decimal(input.unitPrice, 4);
  if (!key || !rate?.gt(0) || rate.gt('999999.9999') || !input.reason.trim()) {
    throw new Error('请填写大于 0、最多四位小数的材料单价及定价依据');
  }
  return {
    source: 'ADMIN_MATERIAL_CONFIRMATION', identity: key,
    orderId: input.item.orderId, itemId: input.item.id,
    actualWidthMm: dimension(input.item.actualWidthMm), actualHeightMm: dimension(input.item.actualHeightMm),
    unitPrice: rate.toFixed(4), reason: input.reason.trim(), actorId: input.actorId,
    confirmedAt: input.now.toISOString(), previousPriceRevision: input.previousPriceRevision,
  };
}
