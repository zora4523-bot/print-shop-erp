import Decimal from 'decimal.js';
import type { CreateOrderInput } from '../auth/schemas';

export function adminCreatePriceFactsKey(
  item: Partial<CreateOrderInput['items'][number]>,
): string {
  return JSON.stringify([
    item.quantity ?? null,
    item.productId || null,
    item.pricingRoute ?? null,
    item.paperType || null,
    item.paperWeightGsm ?? null,
    item.specification || null,
    item.actualWidthMm ?? null,
    item.actualHeightMm ?? null,
    item.manualQuoteReason || null,
    item.frontFoilColors ?? [],
    item.backFoilColors ?? [],
    item.foilTechnique ?? null,
    item.hasLocalFoil ?? null,
    item.lamination ?? null,
    item.crafts ?? [],
    item.productStructure ?? null,
    item.printColors ?? [],
    item.isDoubleSided ?? null,
    item.isDoubleColor ?? null,
  ]);
}

export function adminPackagingPriceFactsKey(
  group: CreateOrderInput['packagingGroups'][number],
  quantities: readonly number[],
  allocations: readonly (readonly number[])[],
): string {
  return JSON.stringify([
    group.mode,
    group.itemUnitsPerBag,
    quantities,
    allocations,
  ]);
}

export function calculateAdminPackagingPrice(
  input: { amount: string; reason: string },
  count: number,
): { unitPrice: string; subtotal: string; priceOverrideReason: string } {
  if (!/^\d{1,6}(\.\d{1,4})?$/.test(input.amount.trim()))
    throw new Error('包装单价最多四位小数');
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error('包装数量无效');
  const rate = new Decimal(input.amount.trim());
  const subtotal = rate.times(count).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (subtotal.gt('9999999999.99')) throw new Error('包装金额超出范围');
  const reason = input.reason.trim();
  if (reason.length < 2 || reason.length > 200)
    throw new Error('定价原因须为 2 至 200 字');
  return {
    unitPrice: rate.toFixed(4),
    subtotal: subtotal.toFixed(2),
    priceOverrideReason: reason,
  };
}

/** An agreed style amount is stored as a fixed fee to avoid unit-rate rounding drift. */
export function calculateAdminCreatePrice(input: {
  amount: string;
  reason: string;
}) {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(input.amount.trim())) {
    throw new Error('请填写有效价格（最多两位小数）');
  }
  const amount = new Decimal(input.amount.trim()).toFixed(2);
  const reason = input.reason.trim();
  if (reason.length < 2 || reason.length > 200)
    throw new Error('定价原因须为 2 至 200 字');
  return {
    unitPrice: '0.0000',
    fixedFee: amount,
    subtotal: amount,
    priceOverrideReason: reason,
  };
}

/** Null means a pending component, excluded from the explicitly labelled known total. */
export function sumCreateKnownAmounts(
  amounts: readonly (string | null | undefined)[],
): string {
  return amounts
    .reduce<Decimal>(
      (sum, amount) => (amount == null ? sum : sum.plus(amount)),
      new Decimal(0),
    )
    .toFixed(2);
}
