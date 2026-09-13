import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import release from '../../../config/customer-price-books/custom-tiers-20260913.json';
import { calculateCreateOrderQuote, selectFullUnitPrice } from '../create-order';
import { CREATE_ORDER_GOLDEN_SNAPSHOT, createGoldenOrderInput, createGoldenOrderItem } from './fixtures/create-order-golden-fixtures';

const snapshot = {
  ...CREATE_ORDER_GOLDEN_SNAPSHOT,
  full: {
    ...CREATE_ORDER_GOLDEN_SNAPSHOT.full,
    unitPrices: release.tiers.flatMap((tier, index) => (['MID', 'LARGE'] as const).map(pricingGroup => ({
      tierCode: `Q${tier.quantity}`, pricingGroup,
      minQuantity: index === 0 ? 1 : tier.quantity,
      maxQuantity: (release.tiers[index + 1]?.quantity ?? 10_000_000) - 1,
      unitPrice: pricingGroup === 'MID' ? tier.middle : tier.large,
    }))),
  },
};

// Independent screenshot expectations cover both sides of every boundary.
const expected = [
  [1, 499, '0.96', '1'], [500, 999, '0.48', '0.52'],
  [1000, 1999, '0.31', '0.325'], [2000, 2999, '0.27', '0.285'],
  [3000, 3999, '0.25', '0.27'], [4000, 4999, '0.23', '0.245'],
  [5000, 9999, '0.2', '0.22'], [10000, 19999, '0.18', '0.2'],
  [20000, 29999, '0.17', '0.19'], [30000, 49999, '0.17', '0.19'],
  [50000, 9999999, '0.16', '0.18'],
] as const;

describe('2026-09-13 confirmed custom tiers', () => {
  for (const [lower, upper, middle, large] of expected) {
    it.each([lower, upper])(`quotes exact prices in ${lower}..${upper}: %i`, quantity => {
      for (const pricingGroup of ['MID', 'LARGE'] as const) {
        const item = createGoldenOrderItem({ craft: 'FULL', pricingGroup,
          specification: pricingGroup === 'MID' ? '中号封' : '大号封', quantity,
          paperType: '珠光艳闪', paperWeightGsm: 160, frontColors: ['哑金'], backColors: [] });
        const unitPrice = pricingGroup === 'MID' ? middle : large;
        expect(new Decimal(selectFullUnitPrice(item, snapshot.full)!.unitPrice!).toString()).toBe(unitPrice);
        if (quantity < 9999999) {
          const quote = calculateCreateOrderQuote(createGoldenOrderInput([item]), snapshot);
          expect(quote.items[0]?.processingAmount).toBe(new Decimal(unitPrice).times(quantity).toFixed(2));
        }
      }
    });
  }
  it('keeps the old midpoint snapshot unchanged when quoting new prices', () => {
    const item = createGoldenOrderItem({ craft: 'FULL', pricingGroup: 'LARGE', specification: '大号封', quantity: 4600 });
    expect(selectFullUnitPrice(item, CREATE_ORDER_GOLDEN_SNAPSHOT.full)?.unitPrice).toBe('0.2200');
    expect(selectFullUnitPrice(item, snapshot.full)?.unitPrice).toBe('0.245');
    expect(selectFullUnitPrice({ ...item, quantity: 800 }, snapshot.full)?.unitPrice).toBe('0.52');
  });
});
