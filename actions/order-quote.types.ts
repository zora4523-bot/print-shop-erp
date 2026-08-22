import type { QuoteResult } from '@/lib/price/quote';

export type QuoteOrderItemsMutationResult =
  | { status: 'success'; items: QuoteResult[] }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
