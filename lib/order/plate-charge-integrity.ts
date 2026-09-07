import Decimal from 'decimal.js';
import { OrderItemPricingRoute } from '../../generated/prisma/enums';
import { deriveLegacyOrderItemFoilFacts } from './pricing-route';

type PlateItem = {
  id: string;
  pricingRoute: OrderItemPricingRoute;
  frontFoilColors?: readonly string[];
  backFoilColors?: readonly string[];
  foilColors?: readonly string[];
  isDoubleSided?: boolean;
};

type PlateCharge = {
  businessKey: string;
  status: string;
  amount: { toString(): string } | string | number | null;
  pricingSnapshot: unknown;
  category: { code: string };
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function decimal(value: unknown): Decimal | null {
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    !(typeof value === 'object' && value !== null && 'toString' in value)
  ) {
    return null;
  }
  try {
    const parsed = new Decimal(String(value));
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

export function itemAllowsIndependentPlateDetail(item: PlateItem): boolean {
  if (item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT) return false;
  const foil = deriveLegacyOrderItemFoilFacts(item);
  return foil.frontFoilColors.length > 0 || foil.backFoilColors.length > 0;
}

function isTrustedActivePlateDetailCharge(
  charge: PlateCharge,
  itemById: ReadonlyMap<string, PlateItem>,
): boolean {
  if (
    charge.category.code !== 'PLATE_MAKING_FEE' ||
    !charge.businessKey.startsWith('PLATE_DETAIL:') ||
    charge.status !== 'FINAL' ||
    charge.amount === null
  ) {
    return false;
  }
  const snapshot = record(charge.pricingSnapshot);
  const actual = record(snapshot.actual);
  const plateDetailId =
    typeof snapshot.plateDetailId === 'string' ? snapshot.plateDetailId : null;
  const orderItemId =
    typeof snapshot.orderItemId === 'string' ? snapshot.orderItemId : null;
  const quantity = decimal(actual.quantity);
  const unitPrice = decimal(actual.unitPrice);
  const actualAmount = decimal(actual.amount);
  const storedAmount = decimal(charge.amount);
  const item = orderItemId ? itemById.get(orderItemId) : undefined;

  return Boolean(
    snapshot.source === 'ORDER_ITEM_PLATE_DETAIL' &&
      plateDetailId &&
      charge.businessKey === `PLATE_DETAIL:${plateDetailId}` &&
      item &&
      itemAllowsIndependentPlateDetail(item) &&
      quantity?.isInteger() &&
      quantity.isPositive() &&
      unitPrice?.isFinite() &&
      !unitPrice.isNegative() &&
      actualAmount?.isFinite() &&
      !actualAmount.isNegative() &&
      storedAmount?.isFinite() &&
      !storedAmount.isNegative() &&
      unitPrice.times(quantity).toDecimalPlaces(2).eq(actualAmount) &&
      actualAmount.eq(storedAmount),
  );
}

/**
 * Structured plate details can replace the aggregate manual plate charge only
 * when every active row is internally consistent and every other plate charge
 * is a zero-value waiver. This prevents both missing and duplicate plate fees.
 */
export function hasExclusiveTrustedStructuredPlateCoverage(input: {
  items: readonly PlateItem[];
  charges: readonly PlateCharge[];
}): boolean {
  const plateCharges = input.charges.filter(
    (charge) => charge.category.code === 'PLATE_MAKING_FEE',
  );
  const activeDetails = plateCharges.filter(
    (charge) =>
      charge.businessKey.startsWith('PLATE_DETAIL:') &&
      charge.status !== 'WAIVED',
  );
  if (activeDetails.length === 0) return false;

  const itemById = new Map(input.items.map((item) => [item.id, item]));
  if (
    !activeDetails.every((charge) =>
      isTrustedActivePlateDetailCharge(charge, itemById),
    )
  ) {
    return false;
  }

  return plateCharges
    .filter((charge) => !activeDetails.includes(charge))
    .every((charge) => {
      const amount = decimal(charge.amount);
      return charge.status === 'WAIVED' && amount !== null && amount.isZero();
    });
}
