import { describe, expect, it, vi } from 'vitest';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
} from '../../../generated/prisma/enums';
import type {
  CustomerPriceRuleBusinessDto,
  CustomerPriceRuleWorkspaceGroupDto,
} from '../customer-price-book-workspace';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  db: { customerPriceBook: { findMany: vi.fn() } },
}));

import {
  parseCustomerPriceShippingWeightPolicy,
  projectCustomerPriceSectionRules,
} from '../customer-price-section-workspace';

type SectionTestRule = Omit<CustomerPriceRuleBusinessDto, 'product'> & {
  code: string;
  exclusiveGroup: string | null;
  product: {
    id: string;
    code: string;
    name: string;
    specification: string | null;
    paperType: string | null;
  } | null;
};

function rule(
  code: string,
  overrides: Partial<SectionTestRule> = {},
): SectionTestRule {
  return {
    id: `rule-${code}`,
    code,
    name: code,
    category: { id: 'category', name: '收费项' },
    product: {
      id: 'product',
      code: 'EXT-CUSTOM-MID',
      name: '专版中号封',
      specification: '80×115',
      paperType: '160g珠光艳闪',
    },
    kind: CustomerPriceRuleKind.BASE,
    calculationType: CustomerPriceCalculationType.PER_PIECE,
    unitsPerSheet: null,
    amount: '0.48',
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty: 1,
    maxQty: 750,
    exclusiveGroup: null,
    scopeLabel: null,
    automation: 'AUTOMATIC',
    blocksAutomaticQuote: false,
    isActive: true,
    ...overrides,
  };
}

function group(
  current: SectionTestRule | null,
  draft: SectionTestRule | null = null,
): CustomerPriceRuleWorkspaceGroupDto {
  const selected = draft ?? current ?? rule('EMPTY');
  return {
    id: selected.id,
    name: selected.name,
    category: selected.category,
    product: selected.product
      ? {
          id: selected.product.id,
          name: selected.product.name,
          specification: selected.product.specification,
          paperType: selected.product.paperType,
        }
      : null,
    kind: selected.kind,
    calculationType: selected.calculationType,
    unitsPerSheet: selected.unitsPerSheet,
    scopeLabel: selected.scopeLabel,
    automation: selected.automation,
    blocksAutomaticQuote: selected.blocksAutomaticQuote,
    tierCount: 1,
    activeTierCount: 1,
    changed: draft !== null,
    tiers: [
      {
        id: selected.id,
        current,
        draft,
        changed: draft !== null,
        expectedUpdatedAt: draft ? '2026-08-28T06:00:00.000Z' : null,
      },
    ],
  };
}

describe('projectCustomerPriceSectionRules', () => {
  it.each([
    ['blank', 'STOCK_BASE'],
    ['machine', 'STOCK_LOCAL_FOIL_MACHINE'],
    ['tiers', 'CUSTOM_BASE'],
    ['print', 'COLOR_BASE'],
    ['print', 'COLOR_SINGLE_FRONT_FOIL'],
  ] as const)('projects only the %s section whitelist', (section, exclusiveGroup) => {
    const included = rule(`INCLUDED_${section}`, { exclusiveGroup });
    const excluded = rule(`EXCLUDED_${section}`, {
      exclusiveGroup: 'UNRELATED',
    });
    const result = projectCustomerPriceSectionRules(section, [
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        groups: [group(included), group(excluded)],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: included.code,
      purpose: CustomerPriceBookPurpose.PROCESSING,
      current: {
        product: {
          code: 'EXT-CUSTOM-MID',
          specification: '80×115',
          paperType: '160g珠光艳闪',
        },
        minQty: 1,
        maxQty: 750,
        amount: '0.48',
      },
    });
  });

  it('uses the same explicit add-on whitelist as the write path', () => {
    const current = rule('CUSTOM_DOUBLE_COLOR', {
      kind: CustomerPriceRuleKind.ADD_ON,
      amount: '0.09',
      minQty: null,
      maxQty: null,
    });
    const draft = rule('CUSTOM_DOUBLE_COLOR', {
      id: 'draft-custom-double-color',
      kind: CustomerPriceRuleKind.ADD_ON,
      amount: '0.10',
      minQty: null,
      maxQty: null,
    });
    const reference = rule('CUSTOM_THREE_PLUS_COLORS_MANUAL', {
      kind: CustomerPriceRuleKind.REFERENCE,
    });
    const unrelated = rule('PACKAGING_SINGLE_STYLE_PER_BAG', {
      kind: CustomerPriceRuleKind.ADD_ON,
    });
    const unknownCustomAddOn = rule('CUSTOM_FUTURE_UNMAPPED_FEE', {
      kind: CustomerPriceRuleKind.ADD_ON,
    });
    const result = projectCustomerPriceSectionRules('adds', [
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        groups: [
          group(current, draft),
          group(reference),
          group(unrelated),
          group(unknownCustomAddOn),
        ],
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'draft-custom-double-color',
        code: 'CUSTOM_DOUBLE_COLOR',
        changed: true,
        expectedUpdatedAt: '2026-08-28T06:00:00.000Z',
        current: expect.objectContaining({ amount: '0.09' }),
        draft: expect.objectContaining({ amount: '0.10' }),
      }),
    ]);
  });

  it('combines whitelisted logistics and PROCESSING per-bag packaging rules', () => {
    const carton = rule('CARTON_TIER_1', {
      exclusiveGroup: 'CARTON_ORDER_QUANTITY_TIER',
    });
    const zto = rule('ZTO_GUANGDONG', {
      exclusiveGroup: 'ZTO_PROVINCE_RATE',
      includedUnits: '1',
      incrementUnits: '1',
      incrementAmount: '2',
    });
    const bag = rule('PACKAGING_SINGLE_STYLE_PER_BAG', {
      kind: CustomerPriceRuleKind.ADD_ON,
      calculationType: CustomerPriceCalculationType.PER_BAG,
      amount: '0.1',
    });
    const fakeBag = rule('PACKAGING_WRONG_KIND', {
      kind: CustomerPriceRuleKind.BASE,
      calculationType: CustomerPriceCalculationType.PER_BAG,
    });
    const result = projectCustomerPriceSectionRules('ship', [
      {
        purpose: CustomerPriceBookPurpose.LOGISTICS,
        groups: [group(carton), group(zto)],
      },
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        groups: [group(bag), group(fakeBag)],
      },
    ]);

    expect(result.map(({ code, purpose }) => [code, purpose])).toEqual([
      ['CARTON_TIER_1', CustomerPriceBookPurpose.LOGISTICS],
      ['ZTO_GUANGDONG', CustomerPriceBookPurpose.LOGISTICS],
      ['PACKAGING_SINGLE_STYLE_PER_BAG', CustomerPriceBookPurpose.PROCESSING],
    ]);
    expect(result[1]?.current).toMatchObject({
      includedUnits: '1',
      incrementUnits: '1',
      incrementAmount: '2',
    });
  });
});

describe('parseCustomerPriceShippingWeightPolicy', () => {
  it('safely projects a complete server-estimate policy', () => {
    expect(
      parseCustomerPriceShippingWeightPolicy({
        ruleVersion: ' 2026-08-27-logistics-weight-v3 ',
        shipping: {
          billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
          weightResolutionOrder: [
            'ACTUAL_FULFILLMENT_WEIGHT',
            'SERVER_ESTIMATE',
          ],
          maxOrderQuantity: 2_000,
          billableWeightRounding: 'CEIL_KG',
          minimumBillableWeightKg: 1,
          gramsPerItemByPaperWeightGsm: { '160': 6, '230': 10 },
          tenThousandEnvelopeGramsPerItem: 10,
          ignoredUnsafeMetadata: { secret: true },
        },
      }),
    ).toEqual({
      ruleVersion: '2026-08-27-logistics-weight-v3',
      billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
      weightResolutionOrder: [
        'ACTUAL_FULFILLMENT_WEIGHT',
        'SERVER_ESTIMATE',
      ],
      maxOrderQuantity: 2_000,
      billableWeightRounding: 'CEIL_KG',
      minimumBillableWeightKg: '1',
      gramsPerItemByPaperWeightGsm: { '160': '6', '230': '10' },
      tenThousandEnvelopeGramsPerItem: '10',
    });
  });

  it('accepts the bounded legacy policy and rejects malformed notes', () => {
    expect(
      parseCustomerPriceShippingWeightPolicy({
        ruleVersion: 'legacy-v1',
        shipping: {
          billableWeightInput: 'CARRIER_CONFIRMED',
          ztoMaximumOrderQuantity: 2_000,
        },
      }),
    ).toEqual({
      ruleVersion: 'legacy-v1',
      billableWeightInput: 'CARRIER_CONFIRMED',
      weightResolutionOrder: ['ACTUAL_FULFILLMENT_WEIGHT'],
      maxOrderQuantity: 2_000,
    });
    expect(
      parseCustomerPriceShippingWeightPolicy({
        ruleVersion: 'bad-v3',
        shipping: {
          billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
          weightResolutionOrder: ['SERVER_ESTIMATE'],
          maxOrderQuantity: 2_000,
        },
      }),
    ).toBeNull();
    expect(parseCustomerPriceShippingWeightPolicy(null)).toBeNull();
  });
});
