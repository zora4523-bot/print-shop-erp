import type { ExternalOrderChargeQuote } from '@/lib/price/external-order-charges';

export type QuoteExternalOrderChargesMutationResult =
  | { status: 'success'; quote: ExternalOrderChargeQuote }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
