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
    triggerCondition: {
      schemaVersion: 1,
      productCodes: ['PRODUCT_A'],
      pricingRoutes: ['STOCK_BLANK'],
    },
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
    product: { code: 'PRODUCT_A', category: 'BLANK_STOCK', isActive: true },
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

function bagging(
  overrides: Partial<DraftPriceRuleForValidation> = {},
): DraftPriceRuleForValidation {
  return rule({
    id: 'bagging-single',
    code: 'REF_PACKING_SINGLE_ITEM',
    name: '单款入袋',
    kind: 'ADD_ON',
    calculationType: 'PER_BAG',
    amount: '0.1000',
    minQty: null,
    maxQty: null,
    triggerCondition: {
      schemaVersion: 1,
      target: 'PACKAGING_GROUP',
      packagingModes: ['SINGLE_STYLE'],
    },
    exclusiveGroup: 'PACKAGING_GROUP_MODE',
    productId: null,
    product: null,
    category: {
      code: 'PACKING',
      name: '入袋与包装',
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

  it('rejects the historical manual route when publishing a new draft version', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule({
          isActive: false,
          triggerCondition: {
            schemaVersion: 1,
            pricingRoutes: ['MANUAL_QUOTE'],
          },
        }),
      ],
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'rules.rule-base.triggerCondition',
          message: expect.stringContaining('三条计价路线'),
        }),
      ]),
    );
  });

  it('接受按包装模式和实际袋数计价的通用规则', () => {
    expect(
      validateDraftPriceBookRules({
        purpose: 'PROCESSING',
        rules: [rule(), bagging()],
      }),
    ).toEqual([]);
  });

  it.each([
    ['绑定产品', { productId: 'product-a', product: { code: 'PRODUCT_A', category: 'BLANK_STOCK', isActive: true } }],
    ['错误计价方式', { calculationType: 'PER_PIECE' }],
    ['混入款式条件', {
      triggerCondition: {
        schemaVersion: 1,
        target: 'PACKAGING_GROUP',
        packagingModes: ['SINGLE_STYLE'],
        pricingRoutes: ['STOCK_BLANK'],
      },
    }],
  ])('拒绝包装组规则%s', (_label, overrides) => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [rule(), bagging(overrides as Partial<DraftPriceRuleForValidation>)],
    });

    expect(issues.length).toBeGreaterThan(0);
  });

  it('拒绝同一包装模式命中多条入袋规则', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule(),
        bagging(),
        bagging({ id: 'bagging-single-duplicate', code: 'PACKING_SINGLE_2' }),
      ],
    });

    const message = issues.map((issue) => issue.message).join('\n');
    expect(message).toContain('单款装同时命中多条入袋规则');
    expect(message).not.toMatch(/SINGLE_STYLE|PACKAGING_GROUP_MODE|PER_BAG/);
  });

  it('reuses the production trigger contract instead of accepting unknown fields', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [rule({ triggerCondition: { futureField: true } })],
    });

    const message = issues.map((issue) => issue.message).join('\n');
    expect(message).toContain('适用条件非法：适用条件：设置无效，请重新选择或填写');
    expect(message).not.toMatch(/futureField|Unrecognized key/i);
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
      '所选报价产品与适用范围不一致，请重新选择产品',
    );
  });

  it('rejects a bound product whose category conflicts with the configured route', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule({
          product: {
            code: 'PRODUCT_A',
            category: 'BLANK_STOCK',
            isActive: true,
          },
          triggerCondition: {
            schemaVersion: 1,
            productCodes: ['PRODUCT_A'],
            pricingRoutes: ['COLOR_PRINT'],
          },
        }),
      ],
    });

    expect(issues.map((issue) => issue.message)).toContain(
      '所选报价产品的分类与适用计价路线不一致',
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

  it('includes the configured print-color multiplier in publication overflow checks', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule({
          calculationType: 'FIXED_AMOUNT',
          amount: '900000000.0000',
          triggerCondition: {
            schemaVersion: 1,
            productCodes: ['PRODUCT_A'],
            pricingRoutes: ['COLOR_PRINT'],
            perPrintColor: true,
            maxPrintColorCount: 12,
          },
        }),
      ],
    });

    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      '收费项目在数量上限处的金额超过款式可保存上限 9999999999.99 元',
    );
  });

  it('发布前按配置的烫金道数校验金额上限', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule({
          calculationType: 'FIXED_AMOUNT',
          amount: '4000000000.0000',
          triggerCondition: {
            schemaVersion: 1,
            productCodes: ['PRODUCT_A'],
            pricingRoutes: ['STOCK_BLANK'],
            foilPassCount: 3,
            perFoilPass: true,
          },
        }),
      ],
    });

    const message = issues.map((issue) => issue.message).join('\n');
    expect(message).toContain(
      '收费项目在数量上限处的金额超过款式可保存上限 9999999999.99 元',
    );
    expect(message).not.toMatch(/foilPassCount|perFoilPass|STOCK_BLANK/);
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
      '基础报价“基础报价 A”与必然叠加收费合计超过款式可保存上限 9999999999.99 元',
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
      '基础报价“基础报价 A”与必然叠加收费合计超过款式可保存上限 9999999999.99 元',
    );
  });

  it('rejects overlapping BASE ranges for the same product', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule({ name: '基础报价 A（A4:C4）' }),
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
    expect(issues.map((issue) => issue.message).join('\n')).not.toContain(
      'A4:C4',
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
      '收费项目“双面加价 B”与“双面加价 A”在同一适用范围和顺序下冲突',
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
          product: { code: 'PRODUCT_A', category: 'BLANK_STOCK', isActive: true },
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
        '快递费的适用范围只能包含承运商和省份',
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
          product: { code: 'PRODUCT_A', category: 'BLANK_STOCK', isActive: true },
        }),
      ],
    });

    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        '快递费必须使用自动固定金额计价',
        '快递费的地区范围设置不完整，请重新选择承运商和省份',
        '快递费的应用顺序设置不正确',
        '快递费规则必须允许自动报价',
        '耗材规则必须是带完整数量区间的人工确认参考价',
        '耗材规则触发条件必须固定为每票数量的人工确认参考价',
        '耗材规则不能绑定产品',
        '打包耗材的数量范围设置不完整，请重新选择适用数量',
        '打包耗材的应用顺序设置不正确',
      ]),
    );

    expect(issues.map((issue) => issue.message).join('\n')).not.toMatch(
      /ADD_ON|FIXED_AMOUNT|ZTO_PROVINCE_RATE|PACKING_MATERIAL_QUANTITY_TIER|exclusiveGroup|carrierCode|provinces/,
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
