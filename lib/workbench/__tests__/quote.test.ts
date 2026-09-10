import { describe, expect, it } from 'vitest';
import { suggestWorkbenchAmount, workbenchQuoteSchema } from '../quote';

describe('workbench markup', () => {
  it.each([
    ['365.00', 35, '492.75', '127.75'],
    ['0.10', 35, '0.14', '0.04'],
    ['170.00', 0, '170.00', '0.00'],
    ['170.00', 100, '340.00', '170.00'],
  ])(
    'prices %s at %s percent with decimal half-up rounding',
    (base, markup, suggestedAmount, markupAmount) => {
      expect(suggestWorkbenchAmount(base, markup)).toEqual({
        suggestedAmount,
        markupAmount,
      });
    },
  );
  it('does not turn unknown costs into zero or partial totals', () => {
    expect(suggestWorkbenchAmount(null, 35)).toEqual({
      suggestedAmount: null,
      markupAmount: null,
    });
  });
  it.each([0, -1, 1.5, Infinity, NaN, 10_000_000])(
    'rejects invalid quantity %s',
    (quantity) => {
      expect(
        workbenchQuoteSchema.safeParse({
          productId: 'p',
          specification: '大号封',
          paperType: '160g珠光艳闪',
          pricingRoute: 'STOCK_BLANK',
          quantity,
          frontFoilColors: ['哑金'],
          backFoilColors: [],
          foilTechnique: 'FLAT',
          markup: 35,
        }).success,
      ).toBe(false);
    },
  );
});
