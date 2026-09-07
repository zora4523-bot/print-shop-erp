import { OrderStatus } from '../../generated/prisma/enums';

/** Financial correction does not change any production/work-order state. */
export const FULFILLMENT_PRICING_STATUSES = [
  OrderStatus.CONFIRMED,
  OrderStatus.ON_HOLD,
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
  OrderStatus.SCHEDULING,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.COMPLETED,
  OrderStatus.SHIPPED,
] as const;

const statuses: ReadonlySet<string> = new Set(FULFILLMENT_PRICING_STATUSES);

export function isFulfillmentPricingStatus(status: string): boolean {
  return statuses.has(status);
}
