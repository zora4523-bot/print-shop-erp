import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { priceCompletionQuantity } from '../completion-wage';
import type { CompletionPricingBasis } from '../completion-pricing';

const automatic = { mode: 'AUTOMATIC', priceBookId: 'book', priceBookVersion: 1, ruleSetSha256: 'hash', source: 'UNIFIED', policyBookId: null, policyBookVersion: null, useUnifiedRates: true,
  rate: '0.007', smallOrderAmount: '12', setupAmount: '5', multiplier: 2 } satisfies CompletionPricingBasis;
describe('actual production wage from frozen original pricing', () => {
  it.each(['MANUAL_REVISION', 'MANUAL_MIXED_COLORS', 'NON_PIECEWORK'] as const)('does not invent a zero wage for %s', mode => {
    expect(priceCompletionQuantity({ mode }, new Decimal(1000))).toBeNull();
  });
  it.each([[990, '24.00'], [1000, '24.00'], [1001, '24.01'], [1300, '28.20']])('uses actual pieces %s and original two passes', (qty, amount) => {
    expect(priceCompletionQuantity(automatic, new Decimal(qty))).toBe(amount);
  });
  it('supports the original flat rate and rounds once after decimal multiplication', () => {
    expect(priceCompletionQuantity({ ...automatic, smallOrderAmount: null, setupAmount: null, rate: '0.0025' }, new Decimal(999))).toBe('5.00');
    expect(priceCompletionQuantity({ ...automatic, setupAmount: null }, new Decimal(990))).toBe('13.86');
  });
});
