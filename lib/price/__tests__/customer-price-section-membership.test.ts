import { describe, expect, it } from 'vitest';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
} from '@/generated/prisma/enums';
import { customerPriceSectionForRule } from '@/lib/price/customer-price-section-membership';

const BASE_RULE = {
  code: 'RULE',
  exclusiveGroup: null,
  kind: CustomerPriceRuleKind.BASE,
  calculationType: CustomerPriceCalculationType.PER_PIECE,
};

describe('customerPriceSectionForRule', () => {
  it.each([
    [
      'blank',
      CustomerPriceBookPurpose.PROCESSING,
      { ...BASE_RULE, exclusiveGroup: 'STOCK_BASE' },
    ],
    [
      'machine',
      CustomerPriceBookPurpose.PROCESSING,
      { ...BASE_RULE, exclusiveGroup: 'STOCK_LOCAL_FOIL_MACHINE' },
    ],
    [
      'tiers',
      CustomerPriceBookPurpose.PROCESSING,
      { ...BASE_RULE, exclusiveGroup: 'CUSTOM_BASE' },
    ],
    [
      'adds',
      CustomerPriceBookPurpose.PROCESSING,
      {
        ...BASE_RULE,
        code: 'CUSTOM_PAPER_RED_CARD_180',
        kind: CustomerPriceRuleKind.ADD_ON,
      },
    ],
    [
      'print',
      CustomerPriceBookPurpose.PROCESSING,
      { ...BASE_RULE, exclusiveGroup: 'COLOR_BASE' },
    ],
    [
      'ship',
      CustomerPriceBookPurpose.LOGISTICS,
      { ...BASE_RULE, exclusiveGroup: 'ZTO_PROVINCE_RATE' },
    ],
    [
      'ship',
      CustomerPriceBookPurpose.PROCESSING,
      {
        ...BASE_RULE,
        code: 'PACKAGING_SINGLE_STYLE_PER_BAG',
        kind: CustomerPriceRuleKind.ADD_ON,
        calculationType: CustomerPriceCalculationType.PER_BAG,
      },
    ],
  ])('maps a persisted rule identity to %s', (expected, purpose, rule) => {
    expect(customerPriceSectionForRule(purpose, rule)).toBe(expected);
  });

  it('does not guess a section for an unknown processing rule', () => {
    expect(
      customerPriceSectionForRule(
        CustomerPriceBookPurpose.PROCESSING,
        BASE_RULE,
      ),
    ).toBeNull();
  });
});
