import type { CreateOrderInput } from '@/lib/auth/schemas';

/**
 * Browser payload sanitization mirrors the strict external-sales command
 * boundary. Keep this module runtime-free so the B form can import it without
 * pulling server command code into the client bundle.
 */
export const EXTERNAL_CREATE_PAYLOAD_SERVER_OWNED_FIELDS = {
  root: [
    'quotedFee',
    'confirmedFee',
    'settledFee',
    'status',
    'pricingStatus',
    'priceVersion',
    'quotedWeightKg',
    'shippingFee',
    'packingMaterialFee',
    'customerChargeOverrideReason',
  ],
  item: [
    'unitPrice',
    'fixedFee',
    'subtotal',
    'suggestedSubtotal',
    'quotedAmount',
    'quoteDisposition',
    'priceOverrideReason',
  ],
  shipment: [
    'weightKg',
    'quotedWeightKg',
    'billableWeightKg',
    'shippingFee',
    'packingMaterialFee',
    'customerChargeOverrideReason',
  ],
} as const;

type RootServerOwnedField =
  (typeof EXTERNAL_CREATE_PAYLOAD_SERVER_OWNED_FIELDS.root)[number];
type ItemServerOwnedField =
  (typeof EXTERNAL_CREATE_PAYLOAD_SERVER_OWNED_FIELDS.item)[number];
type ShipmentServerOwnedField =
  (typeof EXTERNAL_CREATE_PAYLOAD_SERVER_OWNED_FIELDS.shipment)[number];

export type ExternalCreateOrderPayload = Omit<
  CreateOrderInput,
  RootServerOwnedField | 'items' | 'additionalShipments'
> & {
  items: Array<
    Omit<CreateOrderInput['items'][number], ItemServerOwnedField>
  >;
  additionalShipments: Array<
    Omit<
      CreateOrderInput['additionalShipments'][number],
      ShipmentServerOwnedField
    >
  >;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const result = { ...value };
  for (const field of fields) {
    delete result[field];
  }
  return result;
}

function sanitizeShipment(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return withoutFields(
    value,
    EXTERNAL_CREATE_PAYLOAD_SERVER_OWNED_FIELDS.shipment,
  );
}

/**
 * Converts the B form's compatibility input into an external-sales create
 * command. Server-owned values are omitted rather than reset to `null`,
 * because the strict command boundary rejects even explicit nulls.
 *
 * The source object is never mutated. Unknown non-pricing facts are preserved
 * so canonical additions such as `craft` can cross this compatibility layer.
 */
export function buildExternalCreateOrderPayload(
  input: CreateOrderInput,
): ExternalCreateOrderPayload {
  const source = input as unknown as Record<string, unknown>;
  const payload = withoutFields(
    source,
    EXTERNAL_CREATE_PAYLOAD_SERVER_OWNED_FIELDS.root,
  );

  payload.items = input.items.map((item) =>
    withoutFields(
      item as unknown as Record<string, unknown>,
      EXTERNAL_CREATE_PAYLOAD_SERVER_OWNED_FIELDS.item,
    ),
  );
  payload.additionalShipments = input.additionalShipments.map((shipment) =>
    sanitizeShipment(shipment),
  );

  // The B form currently models the primary shipment at the root and extra
  // destinations as `additionalShipments`. Clean the canonical aliases too so
  // this adapter remains safe while the persistence shape is being retired.
  if (Array.isArray(payload.shipments)) {
    payload.shipments = payload.shipments.map(sanitizeShipment);
  }
  if (isRecord(payload.shipment)) {
    payload.shipment = sanitizeShipment(payload.shipment);
  }

  return payload as ExternalCreateOrderPayload;
}
