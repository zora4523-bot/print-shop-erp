import { describe, expect, it } from 'vitest';
import { AdjustmentType } from '../../../generated/prisma/enums';
import {
  PRICE_ADJUSTMENT_CONDITION_KEYS,
  priceAdjustmentConditionErrorForDisplay,
  validatePriceAdjustmentTriggerCondition,
} from '../adjustment-condition';

const FORBIDDEN_DISPLAY_TERMS =
  /unitsPerSheet|JSON(?:\s+object)?|unknown\s+keys?|未知字段|settlementTypes|craftMode|\bANY\b|\bALL\b|minQty|maxQty|productIds|craftIds|specifications|paperTypes|foilColors|isDoubleSided|isDoubleColor|perFoilColor/i;

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
    ['productIds', 'product-1', '限定产品'],
    ['craftIds', { id: 'craft-1' }, '限定工艺'],
    ['specifications', [], '规格'],
    ['paperTypes', [''], '纸张'],
    ['foilColors', [1], '烫金颜色'],
    ['settlementTypes', 'EXTERNAL_SALES', '结算类型'],
    ['isDoubleSided', 'true', '单双面'],
    ['isDoubleColor', 0, '单双色'],
    ['perFoilColor', 1, '按烫金颜色数量计费'],
    ['minQty', 0, '最小数量'],
    ['maxQty', 1.5, '最大数量'],
    ['unitsPerSheet', '4', '每张可生产数量'],
  ] as const)('rejects the wrong value type for %s', (key, value, label) => {
    const condition = { [key]: value };
    const message = validatePriceAdjustmentTriggerCondition(
      condition,
      AdjustmentType.PER_ORDER,
    ).join('\n');

    expect(message).toContain(label);
    expect(message).not.toMatch(FORBIDDEN_DISPLAY_TERMS);
  });

  it('rejects unknown keys instead of allowing an active rule to poison quotes', () => {
    const errors = validatePriceAdjustmentTriggerCondition(
      { craft: 'foil' },
      AdjustmentType.PER_ORDER,
    );
    expect(errors).toEqual([
      '旧条件包含页面不支持的设置，请清空后重新设置。',
    ]);
    expect(errors.join('\n')).not.toMatch(FORBIDDEN_DISPLAY_TERMS);
    expect(PRICE_ADJUSTMENT_CONDITION_KEYS as readonly string[]).not.toContain(
      'craft',
    );
  });

  it('requires unitsPerSheet for PER_SHEET and validates cross-field rules', () => {
    const perSheetErrors = validatePriceAdjustmentTriggerCondition(
      {},
      AdjustmentType.PER_SHEET,
    );
    const crossFieldErrors = validatePriceAdjustmentTriggerCondition(
      { craftMode: 'ALL', minQty: 2000, maxQty: 1000 },
      AdjustmentType.PER_ORDER,
    );

    expect(perSheetErrors).toContainEqual(
      expect.stringContaining('每张可生产数量'),
    );
    expect(crossFieldErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('请先选择至少一项工艺'),
        expect.stringContaining('最小数量不能大于最大数量'),
      ]),
    );
    expect([...perSheetErrors, ...crossFieldErrors].join('\n')).not.toMatch(
      FORBIDDEN_DISPLAY_TERMS,
    );
  });

  it('rejects unknown settlement directions instead of saving a rule that never matches', () => {
    const errors = validatePriceAdjustmentTriggerCondition(
      { settlementTypes: ['EXTERNAL_SALE'] },
      AdjustmentType.PER_ORDER,
    );

    expect(errors).toContainEqual(
      expect.stringContaining('结算类型包含不支持的选项'),
    );
    expect(errors.join('\n')).not.toMatch(FORBIDDEN_DISPLAY_TERMS);
  });

  it.each([
    '触发条件必须是 JSON object',
    '包含未知字段：futureField',
    'settlementTypes 只能使用 EXTERNAL_SALES',
    'craftMode 只能是 ANY 或 ALL',
    'minQty 不能大于 maxQty',
    'unitsPerSheet必须是正整数',
  ])('hides technical details from stale validation text: %s', (message) => {
    const displayed = priceAdjustmentConditionErrorForDisplay(message);

    expect(displayed).toBe(
      '适用条件设置无效，请按页面选项重新设置。',
    );
    expect(displayed).not.toMatch(FORBIDDEN_DISPLAY_TERMS);
  });
});
