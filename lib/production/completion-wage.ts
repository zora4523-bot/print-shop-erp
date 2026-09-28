import Decimal from 'decimal.js';
import type { CompletionPricingBasis } from './completion-pricing';
import { calculateFoilJobWage } from '@/lib/salary/foil-wage';

/** Actual pieces select the band; the original snapshot supplies passes/colours. */
export function priceCompletionQuantity(basis: CompletionPricingBasis, quantity: Decimal): string | null {
  if (basis.mode !== 'AUTOMATIC') return null;
  return basis.smallOrderAmount !== null && basis.setupAmount !== null
    ? calculateFoilJobWage(quantity.toNumber(), basis.multiplier, { pieceRate: basis.rate, smallOrderAmount: basis.smallOrderAmount, setupAmount: basis.setupAmount }).totalAmount
    : quantity.mul(basis.multiplier).mul(basis.rate).toFixed(2, Decimal.ROUND_HALF_UP);
}
