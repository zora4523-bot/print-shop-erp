const LOCAL_ORDER_DRAFT_VERSION = 1 as const;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type LocalOrderFormDraft = {
  version: typeof LOCAL_ORDER_DRAFT_VERSION;
  savedAt: string;
  values: JsonObject;
};

const ROOT_VALUE_KEYS = [
  'customName',
  'customerRef',
  'receiverName',
  'receiverPhone',
  'receiverAddress',
  'expressCode',
  'destinationProvince',
  'quotedWeightKg',
  'shippingFee',
  'packingMaterialFee',
  'customerChargeOverrideReason',
  'packageRequirement',
  'remark',
  'promisedDate',
  'isUrgent',
  'isSfCollect',
] as const;

const ITEM_VALUE_KEYS = [
  'name',
  'productId',
  'specification',
  'paperType',
  'quantity',
  'crafts',
  'foilColors',
  'isDoubleSided',
  'isDoubleColor',
  'unitPrice',
  'fixedFee',
  'suggestedSubtotal',
  'priceOverrideReason',
  'remark',
] as const;

const SHIPMENT_VALUE_KEYS = [
  'receiverName',
  'receiverPhone',
  'receiverAddress',
  'expressCode',
  'destinationProvince',
  'quotedWeightKg',
  'shippingFee',
  'packingMaterialFee',
  'customerChargeOverrideReason',
  'itemQuantities',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function sanitizeOrderFormDraftValues(value: unknown): JsonObject | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.items) || value.items.length === 0) return null;
  if (!Array.isArray(value.additionalShipments)) return null;

  const root = pickValues(value, ROOT_VALUE_KEYS);
  if (!root) return null;
  const items = value.items.map((item) => pickValues(item, ITEM_VALUE_KEYS));
  const shipments = value.additionalShipments.map((shipment) =>
    pickValues(shipment, SHIPMENT_VALUE_KEYS),
  );
  if (items.some((item) => item === null)) return null;
  if (shipments.some((shipment) => shipment === null)) return null;

  root.items = items as JsonObject[];
  root.additionalShipments = shipments as JsonObject[];
  return root;
}

export function serializeLocalOrderFormDraft(
  values: unknown,
  now: Date = new Date(),
): string | null {
  const sanitized = sanitizeOrderFormDraftValues(values);
  if (!sanitized || Number.isNaN(now.getTime())) return null;
  return JSON.stringify({
    version: LOCAL_ORDER_DRAFT_VERSION,
    savedAt: now.toISOString(),
    values: sanitized,
  } satisfies LocalOrderFormDraft);
}

export function parseLocalOrderFormDraft(
  serialized: string,
): LocalOrderFormDraft | null {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || parsed.version !== LOCAL_ORDER_DRAFT_VERSION) {
      return null;
    }
    if (
      typeof parsed.savedAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.savedAt))
    ) {
      return null;
    }
    const values = sanitizeOrderFormDraftValues(parsed.values);
    if (!values) return null;
    return {
      version: LOCAL_ORDER_DRAFT_VERSION,
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
  return `print-shop-erp:order-form-draft:v1:${encodeURIComponent(userScope)}:${pricingScope}`;
}
