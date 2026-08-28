import Decimal from 'decimal.js';
import type { ExternalOrderChargeQuote } from '../price/external-order-charges';
import type { OrderPackagingQuoteResult } from '../price/order-packaging-quote';
import type { QuoteResult } from '../price/quote';

export type ExternalCreateOrderQuoteSummary = {
  knownTotal: string;
  total: string | null;
  hasManualPricing: boolean;
  totalSemantics: 'COMPLETE' | 'EXCLUDES_MANUAL_ITEMS';
};

function addKnownAmount(total: Decimal, amount: string | null): Decimal {
  if (amount === null) return total;
  try {
    const parsed = new Decimal(amount);
    return parsed.isFinite() && !parsed.isNegative()
      ? total.plus(parsed)
      : total;
  } catch {
    return total;
  }
}

/** Keeps preview and submit-time QUOTE_CHANGED summaries bit-for-bit aligned. */
export function summarizeExternalCreateOrderQuote(args: {
  items: readonly QuoteResult[];
  packaging: OrderPackagingQuoteResult;
  logistics: ExternalOrderChargeQuote;
}): ExternalCreateOrderQuoteSummary {
  let known = new Decimal(0);
  for (const item of args.items) {
    if (item.complete) known = addKnownAmount(known, item.suggestedSubtotal);
  }
  for (const group of args.packaging.groups) {
    if (group.complete) {
      known = addKnownAmount(known, group.suggestedSubtotal);
    }
  }
  for (const component of args.logistics.components) {
    if (component.complete) known = addKnownAmount(known, component.amount);
  }

  const allKnown =
    args.items.every((item) => item.complete) &&
    args.packaging.groups.every((group) => group.complete) &&
    args.logistics.complete;
  const knownTotal = known.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  return {
    knownTotal,
    total: allKnown ? knownTotal : null,
    hasManualPricing: !allKnown,
    totalSemantics: allKnown ? 'COMPLETE' : 'EXCLUDES_MANUAL_ITEMS',
  };
}

