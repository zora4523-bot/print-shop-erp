import { externalShipmentContactIssues } from './external-shipment-contact';
import type { z } from 'zod';
import {
  createOrderSchema,
  type CreateOrderInput,
} from '@/lib/auth/schemas';
import {
  externalCreateOrderIssues,
  externalCreateOrderSubmitSchema,
  type ExternalCreateOrderSubmitInput,
} from '@/lib/auth/external-create-order-schema';

type PropertyPath = readonly PropertyKey[];

export type ExternalCreateOrderCommandIssue = {
  path: PropertyPath;
  message: string;
  fig: number | null;
};

export type ExternalCreateOrderCommandResult =
  | {
      success: true;
      data: CreateOrderInput;
      facts: ExternalCreateOrderSubmitInput;
    }
  | {
      success: false;
      issues: ExternalCreateOrderCommandIssue[];
    };

/**
 * Fields owned by server-side quoting, status transitions, or immutable price
 * snapshots. External clients must omit them completely; an explicit `null`
 * is still an attempt to write a server-owned fact and is rejected.
 */
export const EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS = {
  root: [
    'externalSalesUserId',
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
    'manualQuoteReason',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function rawItemFig(raw: unknown, index: number): number | null {
  if (!isRecord(raw)) return null;
  const fig = raw.fig;
  return Number.isSafeInteger(fig) && Number(fig) > 0
    ? Number(fig)
    : index + 1;
}

function forbiddenFieldIssue(
  path: PropertyPath,
  field: string,
  fig: number | null,
): ExternalCreateOrderCommandIssue {
  return {
    path,
    fig,
    message: `外部销售创建工单不得提交“${field}”，该字段由服务端生成`,
  };
}

function collectForbiddenFieldIssues(
  raw: unknown,
): ExternalCreateOrderCommandIssue[] {
  if (!isRecord(raw)) return [];

  const issues: ExternalCreateOrderCommandIssue[] = [];
  for (const field of EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.root) {
    if (hasOwn(raw, field)) {
      issues.push(forbiddenFieldIssue([field], field, null));
    }
  }

  if (Array.isArray(raw.items)) {
    raw.items.forEach((candidate, index) => {
      if (!isRecord(candidate)) return;
      const fig = rawItemFig(candidate, index);
      for (const field of EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.item) {
        if (hasOwn(candidate, field)) {
          issues.push(
            forbiddenFieldIssue(['items', index, field], field, fig),
          );
        }
      }
    });
  }

  const shipmentCollections: Array<{
    key: string;
    value: unknown;
  }> = [
    { key: 'additionalShipments', value: raw.additionalShipments },
    { key: 'shipments', value: raw.shipments },
  ];
  for (const collection of shipmentCollections) {
    if (!Array.isArray(collection.value)) continue;
    collection.value.forEach((candidate, index) => {
      if (!isRecord(candidate)) return;
      for (const field of EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.shipment) {
        if (hasOwn(candidate, field)) {
          issues.push(
            forbiddenFieldIssue(
              [collection.key, index, field],
              field,
              null,
            ),
          );
        }
      }
    });
  }

  if (isRecord(raw.shipment)) {
    for (const field of EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.shipment) {
      if (hasOwn(raw.shipment, field)) {
        issues.push(
          forbiddenFieldIssue(['shipment', field], field, null),
        );
      }
    }
  }

  return issues;
}

function figForIssue(
  path: PropertyPath,
  raw: unknown,
): number | null {
  if (
    path[0] !== 'items' ||
    typeof path[1] !== 'number' ||
    !isRecord(raw) ||
    !Array.isArray(raw.items)
  ) {
    return null;
  }
  return rawItemFig(raw.items[path[1]], path[1]);
}

function compatibilityIssues(
  error: z.ZodError,
  raw: unknown,
): ExternalCreateOrderCommandIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    fig: figForIssue(issue.path, raw),
  }));
}

function canonicalCraft(
  route: CreateOrderInput['items'][number]['pricingRoute'],
): unknown {
  switch (route) {
    case 'STOCK_BLANK':
      return 'PARTIAL';
    case 'CUSTOM_SINGLE_FLAT_FOIL':
      return 'FULL';
    case 'COLOR_PRINT':
      return 'PRINT';
    case 'MANUAL_QUOTE':
      return 'MANUAL_QUOTE';
  }
}

function canonicalPrintFoilMode(
  item: CreateOrderInput['items'][number],
): unknown {
  if (item.pricingRoute !== 'COLOR_PRINT') return 'NONE';
  if (item.frontFoilColors.length + item.backFoilColors.length === 0) {
    return 'NONE';
  }
  if (item.hasLocalFoil === true) return 'PARTIAL';
  if (item.hasLocalFoil === false) return 'FULL';
  return 'UNSPECIFIED';
}

function toCanonicalFacts(data: CreateOrderInput): unknown {
  return {
    clientSubmissionId: data.clientSubmissionId,
    customName: data.customName,
    customerPartyId: data.customerPartyId,
    customerRef: data.customerRef,
    receiverName: data.receiverName,
    receiverPhone: data.receiverPhone,
    receiverAddress: data.receiverAddress,
    destinationProvince: data.destinationProvince,
    isSfCollect: data.isSfCollect,
    packRaw: data.packageRequirement,
    remark: data.remark,
    styles: data.items.map((item, index) => ({
      fig: item.fig ?? index + 1,
      craft: canonicalCraft(item.pricingRoute),
      productId: item.productId,
      paperType: item.paperType,
      weight: item.paperWeightGsm,
      specification: item.specification,
      widthMm: item.actualWidthMm,
      heightMm: item.actualHeightMm,
      quantity: item.quantity,
      frontColors: item.frontFoilColors,
      backColors: item.backFoilColors,
      printFoilMode: canonicalPrintFoilMode(item),
      foilTechnique: item.foilTechnique,
      lamination: item.lamination,
      packagingMode: data.packagingGroups.find((group) => (group.itemUnitsPerBag[index] ?? 0) > 0)?.mode,
      pack: item.pack ?? null,
      remark: item.remark,
    })),
  };
}

const canonicalToCompatibilityField: Readonly<Record<string, string>> = {
  styles: 'items',
  craft: 'pricingRoute',
  weight: 'paperWeightGsm',
  widthMm: 'actualWidthMm',
  heightMm: 'actualHeightMm',
  frontColors: 'frontFoilColors',
  backColors: 'backFoilColors',
  printFoilMode: 'hasLocalFoil',
  packRaw: 'packageRequirement',
};

function toCompatibilityPath(path: PropertyPath): PropertyPath {
  return path.map((segment) =>
    typeof segment === 'string'
      ? (canonicalToCompatibilityField[segment] ?? segment)
      : segment,
  );
}

/**
 * Strict external-sales command boundary.
 *
 * Validation is intentionally staged: reject server-owned keys from the raw
 * object before Zod can strip them, normalize the still-supported persistence
 * shape, then prove that it can be represented by the canonical create-order facts.
 */
export function parseExternalCreateOrderCommand(
  raw: unknown,
): ExternalCreateOrderCommandResult {
  const forbiddenIssues = collectForbiddenFieldIssues(raw);
  if (forbiddenIssues.length > 0) {
    return { success: false, issues: forbiddenIssues };
  }

  const compatible = createOrderSchema.safeParse(raw);
  if (!compatible.success) {
    return {
      success: false,
      issues: compatibilityIssues(compatible.error, raw),
    };
  }

  const contactIssues = externalShipmentContactIssues(compatible.data.additionalShipments);
  if (contactIssues.length) return {
    success: false,
    issues: contactIssues.map((issue) => ({ ...issue, fig: null })),
  };

  const canonicalInput = toCanonicalFacts(compatible.data);
  const canonical = externalCreateOrderSubmitSchema.safeParse(canonicalInput);
  if (!canonical.success) {
    const issues = externalCreateOrderIssues(canonical.error, canonicalInput);
    return {
      success: false,
      issues: issues.map((issue) => ({
        path: toCompatibilityPath(issue.path),
        fig: issue.fig,
        message: issue.message,
      })),
    };
  }

  return {
    success: true,
    data: compatible.data,
    facts: canonical.data,
  };
}
