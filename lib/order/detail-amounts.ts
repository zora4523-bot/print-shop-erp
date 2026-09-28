import Decimal from 'decimal.js';
import type { getOrderDetail } from '@/lib/order';
import { OrderPricingStatus } from '@/generated/prisma/enums';
import {
  hasAdminPricingConfirmationMarker,
  isTrustedAdminItemPricingSnapshot,
  isTrustedAdminPackagingPricingSnapshot,
  isTrustedAdminPricingSnapshot,
} from './admin-pricing-snapshot';
import { selectOrderCustomerFee } from './customer-fee';
import { isAwaitingFactoryConfirmation } from './factory-confirmation-preflight';

type DetailOrder = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function decimal(value: unknown): Decimal | null {
  if (typeof value !== 'string' && typeof value !== 'number' && !Decimal.isDecimal(value)) return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch { return null; }
}

function hasTrustedManualItemPrice(item: DetailOrder['items'][number]): boolean {
  const fields = record(item);
  const unitPrice = decimal(fields.unitPrice);
  const fixedFee = decimal(fields.fixedFee);
  const subtotal = decimal(fields.subtotal);
  if (!unitPrice || !fixedFee || !subtotal) return false;
  return isTrustedAdminItemPricingSnapshot(fields.pricingSnapshot, {
    ...item, unitPrice: unitPrice.toString(), fixedFee: fixedFee.toString(), subtotal: subtotal.toString(),
    manualQuoteReason: typeof fields.manualQuoteReason === 'string' ? fields.manualQuoteReason : null,
    priceOverrideReason: typeof fields.priceOverrideReason === 'string' ? fields.priceOverrideReason : null,
  });
}

function hasTrustedPackagingPrice(order: DetailOrder, group: DetailOrder['packagingGroups'][number]): boolean {
  const fields = record(group);
  const unitPrice = decimal(fields.unitPrice);
  const subtotal = decimal(fields.subtotal);
  return Boolean(unitPrice && subtotal && isTrustedAdminPackagingPricingSnapshot(fields.pricingSnapshot, {
    ...group, orderId: order.id, unitPrice: unitPrice.toString(), subtotal: subtotal.toString(),
    priceOverrideReason: typeof fields.priceOverrideReason === 'string' ? fields.priceOverrideReason : null,
    lines: group.lines.map((line) => ({ orderItemId: line.orderItem.id, unitsPerBag: line.unitsPerBag })),
  }));
}

function packagingHasUnknownAmount(order: DetailOrder, group: DetailOrder['packagingGroups'][number]): boolean {
  if (hasTrustedPackagingPrice(order, group)) return false;
  const snapshot = record(group).pricingSnapshot;
  if (isTrustedAdminPricingSnapshot(snapshot) || hasAdminPricingConfirmationMarker(snapshot)) return true;
  const data = record(snapshot);
  const actual = record(data.actual);
  const status = typeof data.status === 'string' ? data.status.toUpperCase() : '';
  const source = typeof data.source === 'string' ? data.source.toUpperCase() : '';
  // Preserve historical known amounts. Only an explicit missing-amount
  // envelope or stale administrator binding hides a persisted zero.
  const requiresManual = ['MANUAL_PRICING_REQUIRED', 'PENDING_AMOUNT', 'EXCLUDED_MANUAL'].includes(status) ||
    data.complete === false || actual.provisional === true || actual.requiresAdminConfirmation === true || source.includes('MANUAL_REQUIRED');
  return requiresManual && (actual.amount === null || actual.provisional === true || actual.requiresAdminConfirmation === true);
}

/** Shared read-only money facts for both detail layouts; never recalculates a quote. */
export function orderDetailAmounts(order: DetailOrder) {
  const fields = record(order);
  const pricingStatus = Object.values(OrderPricingStatus).find((value) => value === fields.pricingStatus);
  const hasConfirmedFee = fields.confirmedFee != null || fields.settledFee != null;
  const pendingProcessing = fields.pricingStatus === 'PENDING_ADMIN_CONFIRMATION' && !hasConfirmedFee;
  const unquotedDraft = order.status === 'DRAFT' && fields.quotedFee === null && fields.confirmedFee === null && fields.settledFee === null;
  const itemAmounts = new Map(order.items.map((item) => [item.id,
    unquotedDraft || (item.quoteDisposition === 'MANUAL_PRICING_REQUIRED' && !hasTrustedManualItemPrice(item))
      ? null : decimal(record(item).subtotal)?.toFixed(2) ?? null,
  ]));
  const itemEstimated = new Map(order.items.map((item) => [item.id,
    itemAmounts.get(item.id) !== null && pendingProcessing && !hasTrustedManualItemPrice(item),
  ]));
  const packagingAmount = unquotedDraft || order.packagingGroups.some((group) => packagingHasUnknownAmount(order, group))
    ? null : decimal(fields.packagingAmount)?.toFixed(2) ?? null;
  const processing = decimal(fields.processingAmount);
  const packaging = decimal(fields.packagingAmount);
  const itemProcessingAmount = unquotedDraft || [...itemAmounts.values()].some((value) => value === null) || !processing || !packaging
    ? null : processing.minus(packaging).toFixed(2);
  const processingAmount = itemProcessingAmount === null || packagingAmount === null ? null : processing?.toFixed(2) ?? null;
  const selectedFee = 'totalAmount' in order ? selectOrderCustomerFee(order) : null;
  const incomplete = !hasConfirmedFee && (fields.quotedFeeCompleteness === 'EXCLUDES_MANUAL_ITEMS' ||
    processingAmount === null || order.customerCharges.some((charge) => charge.status !== 'WAIVED' && charge.amount === null));
  const feeSource: 'PENDING' | 'INCOMPLETE' | NonNullable<typeof selectedFee>['source'] = unquotedDraft || (incomplete && isAwaitingFactoryConfirmation(order.status))
    ? 'PENDING' : incomplete ? 'INCOMPLETE' : selectedFee?.source ?? 'PENDING';
  return {
    pricingStatus, feeSource,
    itemAmounts, itemEstimated, itemProcessingAmount, packagingAmount, processingAmount,
    totalAmount: unquotedDraft || incomplete ? null : selectedFee?.amount ?? null,
    // A later estimated shipping line cannot turn already confirmed production
    // components into estimates. Current total still reflects estimated charges;
    // the settled amount is an immutable final amount.
    processingEstimated: pendingProcessing && [...itemEstimated.values()].some(Boolean),
    packagingEstimated: pendingProcessing && packagingAmount !== null &&
      order.packagingGroups.some((group) => !hasTrustedPackagingPrice(order, group)),
    estimated: selectedFee?.source !== 'SETTLED' && (Boolean(selectedFee?.estimated) ||
      order.customerCharges.some((charge) => charge.status === 'ESTIMATED')),
    incomplete,
  };
}
