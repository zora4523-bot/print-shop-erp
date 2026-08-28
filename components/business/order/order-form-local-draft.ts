import { OrderItemPricingRoute } from '@/generated/prisma/enums';
import { isNewOrderPricingRoute } from '@/lib/order/pricing-route';

const LOCAL_ORDER_DRAFT_VERSION = 5 as const;
const LEGACY_LOCAL_ORDER_DRAFT_VERSION = 4 as const;

export type LocalOrderFormDraftPricingScope = 'external-sales' | 'internal';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type LocalOrderFormDraft = {
  version: typeof LOCAL_ORDER_DRAFT_VERSION;
  pricingScope: LocalOrderFormDraftPricingScope;
  savedAt: string;
  values: JsonObject;
};

const ROOT_FACT_KEYS = [
  'customName',
  'customerPartyId',
  'customerRef',
  'receiverName',
  'receiverPhone',
  'receiverAddress',
  'expressCode',
  'destinationProvince',
  'quotedWeightKg',
  'packageRequirement',
  'remark',
  'promisedDate',
  'isUrgent',
  'isSfCollect',
  'nextItemFig',
] as const;

const ITEM_FACT_KEYS = [
  'fig',
  'name',
  'productId',
  'pricingRoute',
  'productStructure',
  'artworkVersion',
  'plateGroupId',
  'pricingGroup',
  'specification',
  'actualWidthMm',
  'actualHeightMm',
  'paperType',
  'paperWeightGsm',
  'quantity',
  'pack',
  'crafts',
  'frontFoilColors',
  'backFoilColors',
  'foilColors',
  'foilTechnique',
  'hasLocalFoil',
  'printColors',
  'isDoubleSided',
  'isDoubleColor',
  'remark',
] as const;

const ITEM_INTERNAL_PRICE_KEYS = [
  'unitPrice',
  'fixedFee',
  'suggestedSubtotal',
  'priceOverrideReason',
] as const;

const PACKAGING_GROUP_VALUE_KEYS = [
  'name',
  'mode',
  'actualBagCount',
  'itemUnitsPerBag',
] as const;

const SHIPMENT_FACT_KEYS = [
  'receiverName',
  'receiverPhone',
  'receiverAddress',
  'expressCode',
  'destinationProvince',
  'quotedWeightKg',
  'itemQuantities',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveNextOrderItemFig(value: unknown): number {
  if (!isRecord(value) || !Array.isArray(value.items)) return 1;
  const maximumFig = value.items.reduce((maximum, item, index) => {
    if (!isRecord(item)) return Math.max(maximum, index + 1);
    const fig = item.fig;
    return Number.isSafeInteger(fig) && Number(fig) > 0
      ? Math.max(maximum, Number(fig))
      : Math.max(maximum, index + 1);
  }, 0);
  const savedCounter = value.nextItemFig;
  return Number.isSafeInteger(savedCounter) && Number(savedCounter) > maximumFig
    ? Number(savedCounter)
    : maximumFig + 1;
}

function dateToYmd(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null;
  const year = value.getUTCFullYear().toString().padStart(4, '0');
  const month = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = value.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return dateToYmd(value);
  if (
    (typeof File !== 'undefined' && value instanceof File) ||
    (typeof Blob !== 'undefined' && value instanceof Blob)
  ) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const serializable = toJsonValue(entry);
      return serializable === undefined ? [] : [serializable];
    });
  }
  // RHF's order form values only need scalar values and scalar arrays. Do not
  // persist arbitrary nested objects: this deliberately excludes File-like
  // values and any future upload metadata from the browser draft.
  return undefined;
}

function pickValues(
  value: unknown,
  keys: readonly string[],
): JsonObject | null {
  if (!isRecord(value)) return null;
  const picked: JsonObject = {};
  for (const key of keys) {
    const serializable = toJsonValue(value[key]);
    if (serializable !== undefined) picked[key] = serializable;
  }
  return picked;
}

export function sanitizeOrderFormDraftValues(
  value: unknown,
  pricingScope: LocalOrderFormDraftPricingScope,
): JsonObject | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.items) || value.items.length === 0) return null;
  if (!Array.isArray(value.additionalShipments)) return null;
  if (!Array.isArray(value.packagingGroups)) return null;
  const packagingGroupValues = value.packagingGroups as unknown[];

  const includeInternalPrices = pricingScope === 'internal';
  const root = pickValues(value, ROOT_FACT_KEYS);
  if (!root) return null;
  const items = value.items.map((item, itemIndex) => {
    const picked = pickValues(item, [
      ...ITEM_FACT_KEYS,
      ...(includeInternalPrices ? ITEM_INTERNAL_PRICE_KEYS : []),
    ]);
    if (
      !picked ||
      typeof picked.pricingRoute !== 'string' ||
      !isNewOrderPricingRoute(picked.pricingRoute as OrderItemPricingRoute)
    )
      return null;
    if (!Number.isSafeInteger(picked.fig) || Number(picked.fig) < 1) {
      picked.fig = itemIndex + 1;
    }
    if (!Number.isSafeInteger(picked.pack) || Number(picked.pack) < 1) {
      const legacyPack = packagingGroupValues
        .filter(isRecord)
        .map((group) => group.itemUnitsPerBag)
        .filter(Array.isArray)
        .map((units) => units[itemIndex])
        .find((units) => Number.isSafeInteger(units) && Number(units) > 0);
      picked.pack = legacyPack === undefined ? null : Number(legacyPack);
    }
    return picked;
  });
  const shipments = value.additionalShipments.map((shipment) =>
    pickValues(shipment, SHIPMENT_FACT_KEYS),
  );
  const packagingGroups = packagingGroupValues.map((group) =>
    pickValues(group, PACKAGING_GROUP_VALUE_KEYS),
  );
  if (items.some((item) => item === null)) return null;
  if (shipments.some((shipment) => shipment === null)) return null;
  if (packagingGroups.some((group) => group === null)) return null;

  root.nextItemFig = resolveNextOrderItemFig({
    ...root,
    items,
  });
  root.items = items as JsonObject[];
  root.additionalShipments = shipments as JsonObject[];
  root.packagingGroups = packagingGroups as JsonObject[];
  return root;
}

export function serializeLocalOrderFormDraft(
  values: unknown,
  pricingScope: LocalOrderFormDraftPricingScope,
  now: Date = new Date(),
): string | null {
  const sanitized = sanitizeOrderFormDraftValues(values, pricingScope);
  if (!sanitized || Number.isNaN(now.getTime())) return null;
  return JSON.stringify({
    version: LOCAL_ORDER_DRAFT_VERSION,
    pricingScope,
    savedAt: now.toISOString(),
    values: sanitized,
  } satisfies LocalOrderFormDraft);
}

export function parseLocalOrderFormDraft(
  serialized: string,
  expectedPricingScope: LocalOrderFormDraftPricingScope,
): LocalOrderFormDraft | null {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (
      !isRecord(parsed) ||
      (parsed.version !== LOCAL_ORDER_DRAFT_VERSION &&
        parsed.version !== LEGACY_LOCAL_ORDER_DRAFT_VERSION)
    ) {
      return null;
    }
    if (parsed.pricingScope !== expectedPricingScope) return null;
    if (
      typeof parsed.savedAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.savedAt))
    ) {
      return null;
    }
    const values = sanitizeOrderFormDraftValues(
      parsed.values,
      expectedPricingScope,
    );
    if (!values) return null;
    return {
      version: LOCAL_ORDER_DRAFT_VERSION,
      pricingScope: expectedPricingScope,
      savedAt: parsed.savedAt,
      values,
    };
  } catch {
    return null;
  }
}

export function localOrderFormDraftStorageKey(
  userScope: string,
  usesExternalSalesPricing: boolean,
): string {
  const pricingScope = usesExternalSalesPricing ? 'external-sales' : 'internal';
  return `print-shop-erp:order-form-draft:v4:${encodeURIComponent(userScope)}:${pricingScope}`;
}
