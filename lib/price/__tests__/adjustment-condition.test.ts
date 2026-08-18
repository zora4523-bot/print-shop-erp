import { describe, expect, it } from 'vitest';
import { AdjustmentType } from '../../../generated/prisma/enums';
import {
  PRICE_ADJUSTMENT_CONDITION_KEYS,
  validatePriceAdjustmentTriggerCondition,
} from '../adjustment-condition';

describe('validatePriceAdjustmentTriggerCondition', () => {
  it('accepts the complete quote-engine condition contract', () => {
    expect(
      validatePriceAdjustmentTriggerCondition(
        {
          productIds: ['product-1'],
          craftIds: ['craft-1', 'craft-2'],
          craftMode: 'ALL',
          specifications: ['大号'],
          paperTypes: ['艳红珠光纸'],
          foilColors: ['哑金'],
          isDoubleSided: true,
          isDoubleColor: false,
          minQty: 1000,
          maxQty: 5000,
          settlementTypes: ['EXTERNAL_SALES', 'FACTORY_DIRECT'],
          unitsPerSheet: 4,
          perFoilColor: true,
        },
        AdjustmentType.PER_SHEET,
      ),
    ).toEqual([]);
  });

  it.each([
    ['productIds', 'product-1'],
    ['craftIds', { id: 'craft-1' }],
    ['specifications', []],
    ['paperTypes', ['']],
    ['foilColors', [1]],
    ['settlementTypes', 'EXTERNAL_SALES'],
    ['isDoubleSided', 'true'],
    ['isDoubleColor', 0],
    ['perFoilColor', 1],
    ['minQty', 0],
    ['maxQty', 1.5],
    ['unitsPerSheet', '4'],
  ] as const)('rejects the wrong value type for %s', (key, value) => {
    const condition = { [key]: value };
    expect(
      validatePriceAdjustmentTriggerCondition(
        condition,
        AdjustmentType.PER_ORDER,
      ).join('\n'),
    ).toContain(key);
  });

  it('rejects unknown keys instead of allowing an active rule to poison quotes', () => {
    const errors = validatePriceAdjustmentTriggerCondition(
      { craft: 'foil' },
      AdjustmentType.PER_ORDER,
    );
    expect(errors.join('\n')).toContain('未知字段：craft');
    expect(PRICE_ADJUSTMENT_CONDITION_KEYS as readonly string[]).not.toContain(
      'craft',
    );
  });

  it('requires unitsPerSheet for PER_SHEET and validates cross-field rules', () => {
    expect(
      validatePriceAdjustmentTriggerCondition({}, AdjustmentType.PER_SHEET),
    ).toContainEqual(expect.stringContaining('unitsPerSheet'));
    expect(
      validatePriceAdjustmentTriggerCondition(
        { craftMode: 'ALL', minQty: 2000, maxQty: 1000 },
        AdjustmentType.PER_ORDER,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('craftIds'),
        expect.stringContaining('minQty 不能大于 maxQty'),
      ]),
    );
  });

  it('rejects unknown settlement directions instead of saving a rule that never matches', () => {
    expect(
      validatePriceAdjustmentTriggerCondition(
        { settlementTypes: ['EXTERNAL_SALE'] },
        AdjustmentType.PER_ORDER,
      ),
    ).toContainEqual(expect.stringContaining('settlementTypes 只能使用'));
  });
});
