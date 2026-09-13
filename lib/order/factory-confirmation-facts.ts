import type { Prisma } from '../../generated/prisma/client';
import { OrderChangeRequestStatus, OrderCustomerChargeStatus, OrderItemQuoteDisposition } from '../../generated/prisma/enums';
import {
  hasAdminPricingConfirmationMarker, isTrustedAdminChargePricingSnapshot,
  isTrustedAdminItemPricingSnapshot, isTrustedAdminPackagingPricingSnapshot,
  isTrustedAdminPricingSnapshot,
} from './admin-pricing-snapshot';

export const workflowOrderSelect = {
  id: true,
  orderNo: true,
  status: true,
  revision: true,
  workOrderVersion: true,
  pricingStatus: true,
  quotedFeeCompleteness: true,
  quotedFee: true,
  confirmedFee: true,
  totalAmount: true,
  billingMode: true,
  items: {
    select: {
      id: true,
      orderId: true,
      fig: true,
      productId: true,
      pricingRoute: true,
      craft: true,
      productStructure: true,
      plateGroupId: true,
      pricingGroup: true,
      specification: true,
      actualWidthMm: true,
      actualHeightMm: true,
      paperType: true,
      paperWeightGsm: true,
      quantity: true,
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
      priceOverrideReason: true,
      quoteDisposition: true,
      manualQuoteReason: true,
      pricingSnapshot: true,
    },
  },
  shipments: {select: {lines: {select: {orderItemId: true, quantity: true}}}},
  packagingGroups: {
    select: {
      id: true,
      orderId: true,
      mode: true,
      actualBagCount: true,
      unitPrice: true,
      subtotal: true,
      priceOverrideReason: true,
      pricingSnapshot: true,
      lines: { select: { orderItemId: true, unitsPerBag: true } },
    },
  },
  customerCharges: {
    select: {
      orderId: true,
      businessKey: true,
      shipmentId: true,
      priceBookId: true,
      sourceRuleId: true,
      status: true,
      quantity: true,
      unit: true,
      unitPrice: true,
      suggestedAmount: true,
      amount: true,
      isAdjustment: true,
      approvalReference: true,
      overrideReason: true,
      pricingSnapshot: true,
      category: { select: { code: true } },
    },
  },
  _count: {
    select: {
      changeRequests: {
        where: { status: OrderChangeRequestStatus.PENDING },
      },
    },
  },
} satisfies Prisma.OrderSelect;

export type WorkflowOrder = Prisma.OrderGetPayload<{
  select: typeof workflowOrderSelect;
}>;

function jsonRecord(value: Prisma.JsonValue | null): Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function snapshotText(value: Prisma.JsonValue | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function pricingSnapshotStillRequiresManual(
  value: Prisma.JsonValue | null,
): boolean {
  const snapshot = jsonRecord(value);
  const actual = jsonRecord(snapshot.actual ?? null);
  const status = snapshotText(snapshot.status);
  const source = snapshotText(snapshot.source);
  return (
    status === 'MANUAL_PRICING_REQUIRED' ||
    status === 'PENDING_AMOUNT' ||
    status === 'EXCLUDED_MANUAL' ||
    snapshot.complete === false ||
    actual.provisional === true ||
    actual.requiresAdminConfirmation === true ||
    source.includes('MANUAL_REQUIRED')
  );
}

export function hasUnresolvedManualPricing(order: WorkflowOrder): boolean {
  const itemPending = order.items.some((item) => {
    if (isTrustedAdminItemPricingSnapshot(item.pricingSnapshot, item)) {
      return false;
    }
    return (
      isTrustedAdminPricingSnapshot(item.pricingSnapshot) ||
      hasAdminPricingConfirmationMarker(item.pricingSnapshot) ||
      item.quoteDisposition ===
        OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED ||
      Boolean(item.manualQuoteReason?.trim()) ||
      pricingSnapshotStillRequiresManual(item.pricingSnapshot)
    );
  });
  const packagingPending = order.packagingGroups.some((group) => {
    if (
      isTrustedAdminPackagingPricingSnapshot(group.pricingSnapshot, group)
    ) {
      return false;
    }
    return (
      isTrustedAdminPricingSnapshot(group.pricingSnapshot) ||
      hasAdminPricingConfirmationMarker(group.pricingSnapshot) ||
      pricingSnapshotStillRequiresManual(group.pricingSnapshot)
    );
  });
  const chargePending = order.customerCharges.some((charge) => {
    if (charge.status === OrderCustomerChargeStatus.WAIVED) {
      return charge.amount === null || !charge.amount.isZero();
    }
    if (charge.amount === null) return true;
    if (
      isTrustedAdminChargePricingSnapshot(charge.pricingSnapshot, charge)
    ) {
      return false;
    }
    if (
      isTrustedAdminPricingSnapshot(charge.pricingSnapshot) ||
      hasAdminPricingConfirmationMarker(charge.pricingSnapshot)
    ) {
      return true;
    }
    return (
      charge.status === OrderCustomerChargeStatus.PENDING_AMOUNT ||
      pricingSnapshotStillRequiresManual(charge.pricingSnapshot)
    );
  });
  return itemPending || packagingPending || chargePending;
}
