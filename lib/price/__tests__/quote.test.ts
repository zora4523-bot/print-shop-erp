import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { NO_FOIL_COLOR } from '@/lib/order/foil-colors';
import {
  calculateQuote,
  type QuoteAdjustment,
  type QuoteInput,
} from '../quote';

function moneyForTest(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function input(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    quantity: 1_000,
    productId: 'product-1',
    craftIds: ['craft-foil', 'craft-glue'],
    specification: '大号',
    paperType: '艳红珠光纸',
    foilColors: ['哑金'],
    isDoubleSided: true,
    isDoubleColor: false,
    settlementType: 'EXTERNAL_SALES',
    baseUnitPrice: '0.2500',
    priceTiers: [],
    adjustments: [],
    ...overrides,
  };
}

function adjustment(
  overrides: Partial<QuoteAdjustment> = {},
): QuoteAdjustment {
  return {
    id: 'adjustment-1',
    name: '测试加价',
    adjustmentType: 'PER_ORDER',
    amount: '1.0000',
    triggerCondition: null,
    isActive: true,
    ...overrides,
  };
}

describe('calculateQuote', () => {
  it('selects the greatest applicable tier at inclusive quantity boundaries', () => {
    const tiers = [
      { id: 'tier-1', productId: 'product-1', minQty: 1, unitPrice: '0.2000' },
      {
        id: 'tier-1000',
        productId: 'product-1',
        minQty: 1_000,
        unitPrice: '0.1800',
      },
      { id: 'other-product', productId: 'product-2', minQty: 1, unitPrice: '0.0100' },
    ];

    const below = calculateQuote(input({ quantity: 999, priceTiers: tiers }));
    const boundary = calculateQuote(input({ quantity: 1_000, priceTiers: tiers }));

    expect(below.snapshot.base).toEqual({
      source: 'PRICE_TIER',
      sourceId: 'tier-1',
      minQty: 1,
      unitPrice: '0.2000',
    });
    expect(below.suggestedUnitPrice).toBe('0.2000');
    expect(boundary.snapshot.base.sourceId).toBe('tier-1000');
    expect(boundary.suggestedUnitPrice).toBe('0.1800');
  });

  it('falls back to the product base price and reports an incomplete quote when neither source exists', () => {
    const fallback = calculateQuote(input({ baseUnitPrice: '0.1234' }));
    const missing = calculateQuote(
      input({ baseUnitPrice: null, priceTiers: [] }),
    );

    expect(fallback.snapshot.base.source).toBe('PRODUCT_BASE');
    expect(fallback.suggestedUnitPrice).toBe('0.1234');
    expect(missing.complete).toBe(false);
    expect(missing.suggestedSubtotal).toBeNull();
    expect(missing.errors).toEqual([
      '未找到适用的价格阶梯，产品也没有基础单价',
    ]);
  });

  it('fails closed below the product minimum order quantity', () => {
    const result = calculateQuote(
      input({ quantity: 999, minOrderQty: 1_000 }),
    );

    expect(result.complete).toBe(false);
    expect(result.suggestedUnitPrice).toBeNull();
    expect(result.suggestedFixedFee).toBeNull();
    expect(result.suggestedSubtotal).toBeNull();
    expect(result.errors).toContain('数量低于产品最小起订量 1000');
    expect(result.snapshot.input.minOrderQty).toBe(1_000);
  });

  it('accepts the product minimum order quantity at its inclusive boundary', () => {
    const result = calculateQuote(
      input({ quantity: 1_000, minOrderQty: 1_000 }),
    );

    expect(result.complete).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.suggestedSubtotal).toBe('250.00');
  });

  it('fails closed when the configured minimum order quantity is invalid', () => {
    const result = calculateQuote(input({ minOrderQty: 0 }));

    expect(result.complete).toBe(false);
    expect(result.errors).toContain('产品最小起订量配置非法');
  });

  it('matches every supported business condition with ALL craft semantics and inclusive quantity bounds', () => {
    const matched = adjustment({
      id: 'all-fields',
      triggerCondition: {
        productIds: ['product-1'],
        craftIds: ['craft-foil', 'craft-glue'],
        craftMode: 'ALL',
        specifications: ['大号'],
        paperTypes: ['艳红珠光纸'],
        foilColors: ['哑金', '红金'],
        isDoubleSided: true,
        isDoubleColor: false,
        minQty: 1_000,
        maxQty: 1_000,
        settlementTypes: ['EXTERNAL_SALES'],
        perFoilColor: false,
      },
    });
    const notMatched = adjustment({
      id: 'wrong-paper',
      triggerCondition: { paperTypes: ['铜版纸'] },
    });

    const result = calculateQuote(
      input({ adjustments: [matched, notMatched] }),
    );

    expect(result.complete).toBe(true);
    expect(result.components.map((component) => component.sourceId)).toEqual([
      'product-1',
      'all-fields',
    ]);
    expect(result.snapshot.appliedAdjustments.map((rule) => rule.id)).toEqual([
      'all-fields',
    ]);
  });

  it('defaults craft matching to ANY and requires all requested crafts in ALL mode', () => {
    const any = adjustment({
      id: 'any',
      amount: '1.0000',
      triggerCondition: { craftIds: ['not-present', 'craft-foil'] },
    });
    const allMiss = adjustment({
      id: 'all-miss',
      amount: '9.0000',
      triggerCondition: {
        craftIds: ['craft-foil', 'not-present'],
        craftMode: 'ALL',
      },
    });

    const result = calculateQuote(input({ adjustments: [any, allMiss] }));

    expect(result.components.map((component) => component.sourceId)).toEqual([
      'product-1',
      'any',
    ]);
  });

  it('calculates all four adjustment units, rounds each component half-up, then reconciles unit plus fixed fee', () => {
    const result = calculateQuote(
      input({
        quantity: 1_001,
        baseUnitPrice: '0.0050',
        adjustments: [
          adjustment({
            id: 'piece',
            adjustmentType: 'PER_PIECE',
            amount: '0.0050',
          }),
          adjustment({
            id: 'sheet',
            adjustmentType: 'PER_SHEET',
            amount: '0.3333',
            triggerCondition: { unitsPerSheet: 500 },
          }),
          adjustment({
            id: 'ten-thousand',
            adjustmentType: 'PER_10K',
            amount: '10.0000',
          }),
          adjustment({
            id: 'order',
            adjustmentType: 'PER_ORDER',
            amount: '0.0050',
          }),
        ],
      }),
    );

    expect(result.components.map(({ sourceId, units, amount }) => ({
      sourceId,
      units,
      amount,
    }))).toEqual([
      { sourceId: 'product-1', units: '1001', amount: '5.01' },
      { sourceId: 'piece', units: '1001', amount: '5.01' },
      { sourceId: 'sheet', units: '3', amount: '1.00' },
      { sourceId: 'ten-thousand', units: '0.1001', amount: '1.00' },
      { sourceId: 'order', units: '1', amount: '0.01' },
    ]);
    expect(result.suggestedUnitPrice).toBe('0.0100');
    expect(result.suggestedFixedFee).toBe('2.02');
    expect(result.suggestedSubtotal).toBe('12.03');

    const reconciled = new Decimal(result.suggestedUnitPrice as string)
      .times(1_001)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .plus(result.suggestedFixedFee as string);
    expect(reconciled.toFixed(2)).toBe(result.suggestedSubtotal);
  });

  it('never suggests a negative fixed fee when tiny PER_PIECE components round down independently', () => {
    const result = calculateQuote(
      input({
        quantity: 3,
        baseUnitPrice: '0.0000',
        adjustments: [
          adjustment({
            id: 'tiny-piece-1',
            adjustmentType: 'PER_PIECE',
            amount: '0.0015',
          }),
          adjustment({
            id: 'tiny-piece-2',
            adjustmentType: 'PER_PIECE',
            amount: '0.0015',
          }),
        ],
      }),
    );

    expect(result.components.map((component) => component.amount)).toEqual([
      '0.00',
      '0.00',
      '0.00',
    ]);
    expect(result.suggestedUnitPrice).toBe('0.0000');
    expect(result.suggestedFixedFee).toBe('0.00');
    expect(result.suggestedSubtotal).toBe('0.00');
  });

  it.each([
    {
      quantity: 3,
      baseUnitPrice: '0.0015',
      adjustments: [
        adjustment({
          id: 'piece-a',
          adjustmentType: 'PER_PIECE',
          amount: '0.0015',
        }),
        adjustment({
          id: 'fixed-a',
          adjustmentType: 'PER_ORDER',
          amount: '0.0050',
        }),
      ],
    },
    {
      quantity: 7,
      baseUnitPrice: '0.1234',
      adjustments: [
        adjustment({
          id: 'piece-b',
          adjustmentType: 'PER_PIECE',
          amount: '0.0067',
        }),
        adjustment({
          id: 'sheet-b',
          adjustmentType: 'PER_SHEET',
          amount: '0.3333',
          triggerCondition: { unitsPerSheet: 3 },
        }),
        adjustment({
          id: 'ten-k-b',
          adjustmentType: 'PER_10K',
          amount: '9.9999',
        }),
      ],
    },
    {
      quantity: 1_001,
      baseUnitPrice: '0.0050',
      adjustments: [
        adjustment({
          id: 'piece-c',
          adjustmentType: 'PER_PIECE',
          amount: '0.0050',
        }),
      ],
    },
  ])(
    'keeps suggested unit/fixed non-negative and exactly reconciled: %#',
    ({ quantity, baseUnitPrice, adjustments }) => {
      const result = calculateQuote(
        input({ quantity, baseUnitPrice, adjustments }),
      );

      expect(result.complete).toBe(true);
      const unit = new Decimal(result.suggestedUnitPrice as string);
      const fixed = new Decimal(result.suggestedFixedFee as string);
      const subtotal = new Decimal(result.suggestedSubtotal as string);
      expect(unit.isNegative()).toBe(false);
      expect(fixed.isNegative()).toBe(false);
      expect(
        moneyForTest(unit.times(quantity)).plus(fixed).toFixed(2),
      ).toBe(subtotal.toFixed(2));
    },
  );

  it('multiplies perFoilColor by distinct real colors and charges zero colors for pure color printing', () => {
    const colorRule = adjustment({
      id: 'foil-color',
      adjustmentType: 'PER_PIECE',
      amount: '0.0100',
      triggerCondition: { perFoilColor: true },
    });
    const multiple = calculateQuote(
      input({
        quantity: 100,
        foilColors: [NO_FOIL_COLOR, '哑金', '哑金', '红金'],
        adjustments: [colorRule],
      }),
    );
    const none = calculateQuote(
      input({
        quantity: 100,
        foilColors: [NO_FOIL_COLOR],
        adjustments: [colorRule],
      }),
    );

    expect(multiple.components[1]).toMatchObject({ units: '200', amount: '2.00' });
    expect(multiple.suggestedUnitPrice).toBe('0.2700');
    expect(none.components[1]).toMatchObject({ units: '0', amount: '0.00' });
    expect(none.suggestedUnitPrice).toBe('0.2500');
  });

  it('applies PER_ORDER exactly once per quoted item rather than once per piece', () => {
    const result = calculateQuote(
      input({
        quantity: 9_999,
        adjustments: [
          adjustment({
            adjustmentType: 'PER_ORDER',
            amount: '12.3456',
          }),
        ],
      }),
    );

    expect(result.components[1]).toMatchObject({ units: '1', amount: '12.35' });
  });

  it.each([
    [{ futureField: true }, 'PER_ORDER', '未知字段'],
    [{ productIds: 'product-1' }, 'PER_ORDER', 'productIds必须'],
    [{ craftMode: 'SOME' }, 'PER_ORDER', 'craftMode 只能'],
    [{ craftMode: 'ALL' }, 'PER_ORDER', 'craftMode 必须与 craftIds'],
    [{ minQty: 2_000, maxQty: 1_000 }, 'PER_ORDER', 'minQty 不能大于 maxQty'],
    [{ perFoilColor: 2 }, 'PER_ORDER', 'perFoilColor必须是布尔值'],
    [null, 'PER_SHEET', '按张计价必须提供'],
    [{ unitsPerSheet: 0 }, 'PER_SHEET', 'unitsPerSheet必须是正整数'],
  ] as const)(
    'marks an unknown or invalid trigger condition incomplete: %j',
    (triggerCondition, adjustmentType, message) => {
      const result = calculateQuote(
        input({
          adjustments: [
            adjustment({
              adjustmentType,
              triggerCondition,
            }),
          ],
        }),
      );

      expect(result.complete).toBe(false);
      expect(result.errors.join('\n')).toContain(message);
      expect(result.components).toHaveLength(1);
      expect(result.suggestedSubtotal).toBeNull();
    },
  );

  it('ignores inactive adjustments without letting their invalid condition poison the quote', () => {
    const result = calculateQuote(
      input({
        adjustments: [
          adjustment({
            isActive: false,
            triggerCondition: { futureField: true },
          }),
        ],
      }),
    );

    expect(result.complete).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.components).toHaveLength(1);
  });

  it('returns a JSON-serializable snapshot containing normalized applied rules and totals', () => {
    const result = calculateQuote(
      input({
        adjustments: [
          adjustment({
            adjustmentType: 'PER_PIECE',
            amount: '0.0100',
            triggerCondition: { craftIds: ['craft-foil'], craftMode: 'ANY' },
          }),
        ],
      }),
    );

    const roundTrip = JSON.parse(JSON.stringify(result.snapshot));
    expect(roundTrip).toEqual(result.snapshot);
    expect(roundTrip).toMatchObject({
      version: 1,
      complete: true,
      suggestedUnitPrice: '0.2600',
      suggestedFixedFee: '0.00',
      suggestedSubtotal: '260.00',
      input: { minOrderQty: null },
      appliedAdjustments: [
        {
          id: 'adjustment-1',
          amount: '0.0100',
          triggerCondition: {
            craftIds: ['craft-foil'],
            craftMode: 'ANY',
          },
        },
      ],
    });
  });

  it('fails closed when quantity multiplication exceeds Decimal(12,2)', () => {
    const result = calculateQuote(
      input({
        quantity: 9_999_999,
        baseUnitPrice: '999999.9999',
      }),
    );

    expect(result.complete).toBe(false);
    expect(result.suggestedSubtotal).toBeNull();
    expect(result.errors).toContain(
      '建议小计超过系统上限 9,999,999,999.99 元，请调整价格规则或数量后重试',
    );
  });

  it('fails closed when combined per-piece rules exceed Decimal(10,4)', () => {
    const result = calculateQuote(
      input({
        quantity: 1,
        baseUnitPrice: '999999.9999',
        adjustments: [
          adjustment({
            adjustmentType: 'PER_PIECE',
            amount: '999999.9999',
          }),
        ],
      }),
    );

    expect(result.complete).toBe(false);
    expect(result.suggestedUnitPrice).toBeNull();
    expect(result.errors).toContain(
      '建议单价超过系统上限 999,999.9999 元，请调整价格规则后重试',
    );
  });

  it('rejects a rate that cannot be stored in Decimal(10,4)', () => {
    const base = calculateQuote(input({ baseUnitPrice: '1000000.0000' }));
    const surcharge = calculateQuote(
      input({
        adjustments: [adjustment({ amount: '1000000.0000' })],
      }),
    );

    expect(base.complete).toBe(false);
    expect(base.errors).toContain('产品基础单价配置非法');
    expect(surcharge.complete).toBe(false);
    expect(surcharge.errors.join('\n')).toContain('金额必须是最多 4 位小数');
  });
});
