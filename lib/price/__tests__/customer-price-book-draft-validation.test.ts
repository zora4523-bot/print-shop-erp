import { describe, expect, it } from 'vitest';
import {
  validateDraftPriceBookRules,
  type DraftPriceRuleForValidation,
} from '../customer-price-book-draft-validation';

function rule(
  overrides: Partial<DraftPriceRuleForValidation> = {},
): DraftPriceRuleForValidation {
  return {
    id: 'rule-base',
    code: 'BASE_A',
    name: '基础报价 A',
    kind: 'BASE',
    calculationType: 'PER_PIECE',
    amount: '0.1350',
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty: 1,
    maxQty: 1_000,
    triggerCondition: { productCodes: ['PRODUCT_A'] },
    exclusiveGroup: null,
    priority: 100,
    blocksAutomaticQuote: false,
    sourceSheet: '报价',
    sourceRange: 'A1:D1',
    sourceName: '报价.xlsx',
    sourceSha256: 'a'.repeat(64),
    note: null,
    productId: 'product-a',
    isActive: true,
    category: {
      code: 'PRODUCT_BASE',
      name: '基础加工费',
      isActive: true,
    },
    product: { code: 'PRODUCT_A', isActive: true },
    ...overrides,
  };
}

function shipping(
  overrides: Partial<DraftPriceRuleForValidation> = {},
): DraftPriceRuleForValidation {
  return rule({
    id: 'shipping-a',
    code: 'ZTO_A',
    name: '中通 A 区',
    kind: 'ADD_ON',
    calculationType: 'FIXED_AMOUNT',
    amount: '2.8000',
    includedUnits: '1.000',
    incrementUnits: '1.000',
    incrementAmount: '1.5000',
    minQty: null,
    maxQty: null,
    triggerCondition: { carrierCode: 'ZTO', provinces: ['广东'] },
    exclusiveGroup: 'ZTO_PROVINCE_RATE',
    productId: null,
    product: null,
    category: {
      code: 'SHIPPING_FEE',
      name: '快递费',
      isActive: true,
    },
    ...overrides,
  });
}

function packaging(
  overrides: Partial<DraftPriceRuleForValidation> = {},
): DraftPriceRuleForValidation {
  return rule({
    id: 'packaging-a',
    code: 'PACK_A',
    name: '耗材 1–500',
    kind: 'REFERENCE',
    calculationType: 'FIXED_AMOUNT',
    amount: '1.0000',
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty: 1,
    maxQty: 500,
    triggerCondition: { scope: 'SHIPMENT_QUANTITY', advisory: true },
    exclusiveGroup: 'PACKING_MATERIAL_QUANTITY_TIER',
    productId: null,
    product: null,
    blocksAutomaticQuote: true,
    category: {
      code: 'PACKING_MATERIAL',
      name: '打包耗材',
      isActive: true,
    },
    ...overrides,
  });
}

describe('validateDraftPriceBookRules', () => {
  it('accepts a processing rule set understood by the production quote engine', () => {
    expect(
      validateDraftPriceBookRules({ purpose: 'PROCESSING', rules: [rule()] }),
    ).toEqual([]);
  });

  it('reuses the production trigger contract instead of accepting unknown fields', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [rule({ triggerCondition: { futureField: true } })],
    });

    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      '包含未知触发字段：futureField',
    );
  });

  it('keeps processing books out of logistics-only charge categories', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule({
          category: {
            code: 'SHIPPING_FEE',
            name: '快递费',
            isActive: true,
          },
        }),
      ],
    });

    expect(issues.map((issue) => issue.message)).toContain(
      '加工费价目簿不能使用物流专属类目“快递费”',
    );
  });

  it('rejects a persisted product whose trigger productCodes can never match it', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule({ triggerCondition: { productCodes: ['PRODUCT_B'] } }),
      ],
    });

    expect(issues.map((issue) => issue.message)).toContain(
      '产品条件必须包含规则所选产品代码“PRODUCT_A”',
    );
  });

  it('rejects processing rates that exceed persisted unit or subtotal limits', () => {
    const unitIssues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [rule({ amount: '1000000.0000' })],
    });
    const subtotalIssues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule({
          calculationType: 'FIXED_AMOUNT',
          amount: '9999999999.9999',
        }),
      ],
    });

    expect(unitIssues.map((issue) => issue.message).join('\n')).toContain(
      '按个单价超过工单可保存上限 999999.9999 元',
    );
    expect(subtotalIssues.map((issue) => issue.message).join('\n')).toContain(
      '金额超过款式可保存上限 9999999999.99 元',
    );
  });

  it('rejects a provably co-charged BASE and ADD_ON whose aggregate overflows', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule({
          calculationType: 'FIXED_AMOUNT',
          amount: '6000000000.0000',
          triggerCondition: { productCodes: ['PRODUCT_A'] },
        }),
        rule({
          id: 'add-on-6b',
          code: 'ADD_ON_6B',
          name: '必收附加费',
          kind: 'ADD_ON',
          calculationType: 'FIXED_AMOUNT',
          amount: '6000000000.0000',
          productId: null,
          product: null,
          triggerCondition: {},
          exclusiveGroup: null,
        }),
      ],
    });

    expect(issues.map((issue) => issue.message)).toContain(
      '基础规则“基础报价 A”与必然叠加收费合计超过款式可保存上限 9999999999.99 元',
    );
  });

  it('checks aggregate overflow inside an ADD_ON quantity sub-range', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule({
          calculationType: 'FIXED_AMOUNT',
          amount: '6000000000.0000',
          triggerCondition: { productCodes: ['PRODUCT_A'] },
        }),
        rule({
          id: 'add-on-subrange-6b',
          code: 'ADD_ON_SUBRANGE_6B',
          name: '子区间必收附加费',
          kind: 'ADD_ON',
          calculationType: 'FIXED_AMOUNT',
          amount: '6000000000.0000',
          productId: null,
          product: null,
          minQty: 500,
          maxQty: 1_000,
          triggerCondition: {},
          exclusiveGroup: null,
        }),
      ],
    });

    expect(issues.map((issue) => issue.message)).toContain(
      '基础规则“基础报价 A”与必然叠加收费合计超过款式可保存上限 9999999999.99 元',
    );
  });

  it('rejects overlapping BASE ranges for the same product', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule(),
        rule({
          id: 'rule-overlap',
          code: 'BASE_B',
          name: '基础报价 B',
          minQty: 500,
          maxQty: 2_000,
        }),
      ],
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'rule-overlap',
          message: '基础报价数量区间与“基础报价 A”重叠',
        }),
      ]),
    );
  });

  it('rejects same-priority rules that can collide in one exclusive group', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule(),
        rule({
          id: 'add-on-a',
          code: 'ADD_A',
          name: '双面加价 A',
          kind: 'ADD_ON',
          productId: null,
          product: null,
          exclusiveGroup: 'SIDE_SURCHARGE',
          triggerCondition: { isDoubleSided: true },
        }),
        rule({
          id: 'add-on-b',
          code: 'ADD_B',
          name: '双面加价 B',
          kind: 'ADD_ON',
          productId: null,
          product: null,
          exclusiveGroup: 'SIDE_SURCHARGE',
          triggerCondition: { isDoubleSided: true },
        }),
      ],
    });

    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      '互斥组“SIDE_SURCHARGE”内与“双面加价 A”存在同优先级命中冲突',
    );
  });

  it('accepts the complete logistics charging surfaces', () => {
    expect(
      validateDraftPriceBookRules({
        purpose: 'LOGISTICS',
        rules: [shipping(), packaging()],
      }),
    ).toEqual([]);
  });

  it('rejects a province assigned to two active shipping tariffs', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'LOGISTICS',
      rules: [
        shipping(),
        shipping({
          id: 'shipping-b',
          code: 'ZTO_B',
          name: '中通 B 区',
          triggerCondition: { carrierCode: 'ZTO', provinces: ['广东', '广西'] },
        }),
        packaging(),
      ],
    });

    expect(issues.map((issue) => issue.message)).toContain(
      '省份“广东”已由规则“中通 A 区”计价',
    );
  });

  it.each(['广东省', '火星', ' 广东 '])(
    'rejects non-canonical shipping province %s',
    (province) => {
    const issues = validateDraftPriceBookRules({
      purpose: 'LOGISTICS',
      rules: [
        shipping({
          triggerCondition: { carrierCode: 'ZTO', provinces: [province] },
        }),
        packaging(),
      ],
    });

    expect(issues.map((issue) => issue.message)).toContain(
      `省份“${province}”不是受支持的规范名称`,
    );
    },
  );

  it('rejects shipping fields the runtime would otherwise silently ignore', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'LOGISTICS',
      rules: [
        shipping({
          minQty: 9_000,
          productId: 'product-a',
          product: { code: 'PRODUCT_A', isActive: true },
          triggerCondition: {
            carrierCode: 'ZTO',
            provinces: ['广东'],
            ignoredFutureField: true,
          },
        }),
        packaging(),
      ],
    });

    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        '快递费规则触发条件只能包含 carrierCode 和 provinces',
        '快递费规则不能绑定产品',
        '快递费规则不能配置数量区间',
      ]),
    );
  });

  it('rejects logistics metadata that disagrees with the runtime contract', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'LOGISTICS',
      rules: [
        shipping({
          kind: 'REFERENCE',
          calculationType: 'PER_PIECE',
          exclusiveGroup: 'IGNORED_GROUP',
          priority: 101,
          blocksAutomaticQuote: true,
        }),
        packaging({
          kind: 'ADD_ON',
          calculationType: 'PER_PIECE',
          triggerCondition: {
            scope: 'SHIPMENT_QUANTITY',
            advisory: true,
            ignoredFutureField: true,
          },
          exclusiveGroup: 'IGNORED_GROUP',
          priority: 101,
          blocksAutomaticQuote: false,
          productId: 'product-a',
          product: { code: 'PRODUCT_A', isActive: true },
        }),
      ],
    });

    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        '快递费规则类型必须固定为 ADD_ON / FIXED_AMOUNT',
        '快递费互斥组必须固定为 ZTO_PROVINCE_RATE',
        '快递费规则优先级必须固定为 100',
        '快递费规则必须允许自动报价',
        '耗材规则必须是带完整数量区间的人工确认参考价',
        '耗材规则触发条件必须固定为每票数量的人工确认参考价',
        '耗材规则不能绑定产品',
        '耗材互斥组必须固定为 PACKING_MATERIAL_QUANTITY_TIER',
        '耗材规则优先级必须固定为 100',
      ]),
    );
  });

  it('rejects a packaging rule without an amount', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'LOGISTICS',
      rules: [shipping(), packaging({ amount: null })],
    });

    expect(issues.map((issue) => issue.message)).toContain('耗材金额不能为空');
  });

  it('rejects overlapping packaging quantity tiers and over-precision money', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'LOGISTICS',
      rules: [
        shipping(),
        packaging({ amount: '1.00001' }),
        packaging({
          id: 'packaging-b',
          code: 'PACK_B',
          name: '耗材 500–1000',
          minQty: 500,
          maxQty: 1_000,
        }),
      ],
    });

    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      '最多 4 位小数',
    );
    expect(issues.map((issue) => issue.message)).toContain(
      '耗材数量区间与“耗材 1–500”重叠',
    );
  });

  it('rejects logistics tariffs above the receivable amount limit', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'LOGISTICS',
      rules: [
        shipping({ amount: '9999999999.9999' }),
        packaging({ amount: '9999999999.9999' }),
      ],
    });

    const messages = issues.map((issue) => issue.message).join('\n');
    expect(messages).toContain('首重金额必须是非负数字');
    expect(messages).toContain(
      '耗材金额超过收费可保存上限 9999999999.99 元',
    );
  });
});
