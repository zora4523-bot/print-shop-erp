import type { FulfillmentPricingPreview, finalizeFulfillmentPricing } from '@/lib/order/fulfillment-pricing';

export type FulfillmentPricingFailure =
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type PreviewFulfillmentPricingResult =
  | { status: 'success'; preview: FulfillmentPricingPreview }
  | FulfillmentPricingFailure;

export type FinalizeFulfillmentPricingResult =
  | ({ status: 'success'; result: Awaited<ReturnType<typeof finalizeFulfillmentPricing>>; orderId: string })
  | FulfillmentPricingFailure;
