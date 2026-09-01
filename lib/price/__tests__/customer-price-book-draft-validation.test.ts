import { describe, expect, it } from 'vitest';
import {
  validateDraftPriceBookRules,
  type DraftPriceRuleForValidation,
} from '../customer-price-book-draft-validation';
import { ZTO_PROVINCE_OPTIONS } from '../external-order-charges';

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
    triggerCondition: {
      carrierCode: 'ZTO',
      provinces: [...ZTO_PROVINCE_OPTIONS],
    },
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
    name: '纸箱费 1–5000',
    kind: 'ADD_ON',
    calculationType: 'FIXED_AMOUNT',
    amount: '1.0000',
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty: 1,
    maxQty: 5_000,
    triggerCondition: {
      scope: 'ORDER_TOTAL_QUANTITY',
      segmentedAboveMaximum: true,
    },
    exclusiveGroup: 'CARTON_ORDER_QUANTITY_TIER',
    productId: null,
    product: null,
    blocksAutomaticQuote: false,
    category: {
      code: 'PACKING_MATERIAL',
      name: '打包耗材',
      isActive: true,
    },
    ...overrides,
  });
}

function packagingTiers(): DraftPriceRuleForValidation[] {
  return [
    [1, 500, '1.0000'],
    [501, 1_000, '3.0000'],
    [1_001, 2_000, '5.0000'],
    [2_001, 3_000, '7.0000'],
    [3_001, 5_000, '8.0000'],
  ].map(([minQty, maxQty, amount], index) =>
    packaging({
      id: `packaging-${index + 1}`,
      code: `PACK_${index + 1}`,
      name: `纸箱费 ${minQty}–${maxQty}`,
      minQty: Number(minQty),
      maxQty: Number(maxQty),
      amount: String(amount),
    }),
  );
}

function colorBase(
  overrides: Partial<DraftPriceRuleForValidation> = {},
): DraftPriceRuleForValidation {
  return rule({
    id: 'color-ice-mid-q2000',
    code: 'BASE_COLOR-ICE-WHITE-160-MID_Q2000',
    name: '冰白纸 160g 彩印 · 中号 · Q2000',
    kind: 'BASE',
    calculationType: 'FIXED_AMOUNT',
    amount: null,
    minQty: 2_000,
    maxQty: 2_000,
    triggerCondition: {
      schemaVersion: 1,
      target: 'ITEM',
      productCodes: ['EXT-COLOR-ICE-WHITE-160-MID'],
      pricingRoutes: ['COLOR_PRINT'],
      productStructures: ['STANDARD_ENVELOPE'],
      specifications: ['中号80×120'],
      paperTypes: ['160g冰白纸'],
      foilTechniques: ['NONE', 'FLAT'],
    },
    exclusiveGroup: 'COLOR_BASE',
    priority: 100,
    blocksAutomaticQuote: false,
    sourceSheet: '加工费计费规则.md',
    sourceRange: '§3',
    sourceName: '加工费计费规则.md',
    productId: 'ice-white-mid',
    category: {
      code: 'BASE_PROCESSING',
      name: '基础加工费',
      isActive: true,
    },
    product: {
      code: 'EXT-COLOR-ICE-WHITE-160-MID',
      category: 'COLOR_PRINT',
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
      '所选建单产品与适用范围不一致，请重新选择产品',
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
      '所选建单产品的分类与适用计价路线不一致',
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

  it('rejects provably co-charged per-piece rules whose combined unit price overflows', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        rule({ amount: '600000.0000', minQty: 1, maxQty: 1 }),
        rule({
          id: 'unit-add-on',
          code: 'UNIT_ADD_ON',
          name: '必收按个加价',
          kind: 'ADD_ON',
          amount: '600000.0000',
          productId: null,
          product: null,
          minQty: 1,
          maxQty: 1,
          triggerCondition: {},
          exclusiveGroup: null,
        }),
      ],
    });

    expect(issues.map((issue) => issue.message)).toContain(
      '基础报价“基础报价 A”与必然叠加收费的按个单价合计超过工单可保存上限 999999.9999 元',
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
        rules: [shipping(), ...packagingTiers()],
      }),
    ).toEqual([]);
  });

  it('rejects incomplete province coverage that the published adapter cannot project', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'LOGISTICS',
      rules: [
        shipping({
          triggerCondition: { carrierCode: 'ZTO', provinces: ['广东'] },
        }),
        packaging(),
      ],
    });

    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      '中通地区规则未完整覆盖',
    );
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
          kind: 'REFERENCE',
          calculationType: 'PER_PIECE',
          triggerCondition: {
            scope: 'SHIPMENT_QUANTITY',
            advisory: true,
            ignoredFutureField: true,
          },
          exclusiveGroup: 'PACKING_MATERIAL_QUANTITY_TIER',
          priority: 101,
          blocksAutomaticQuote: true,
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
        '纸箱费必须使用带完整数量区间的自动固定金额计价',
        '纸箱费必须按整单数量分档，并在 5000 个以上按段累计',
        '纸箱费规则不能绑定产品',
        '纸箱费的整单数量范围设置不完整，请重新选择适用数量',
        '纸箱费的应用顺序设置不正确',
        '纸箱费规则必须允许自动报价',
      ]),
    );

    expect(issues.map((issue) => issue.message).join('\n')).not.toMatch(
      /ADD_ON|FIXED_AMOUNT|ZTO_PROVINCE_RATE|CARTON_ORDER_QUANTITY_TIER|exclusiveGroup|carrierCode|provinces/,
    );
  });

  it('rejects a packaging rule without an amount', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'LOGISTICS',
      rules: [shipping(), packaging({ amount: null })],
    });

    expect(issues.map((issue) => issue.message)).toContain('纸箱费金额不能为空');
  });

  it('allows only an evidenced terminal COLOR_BASE null sentinel', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [colorBase()],
    });
    const messages = issues.map((issue) => issue.message).join('\n');

    expect(messages).not.toContain('金额设置无效');
    expect(messages).not.toContain('空价档必须');
    expect(messages).not.toContain('末档必须达到 Q20000');
  });

  it('rejects null amounts outside the narrow COLOR_BASE sentinel shape', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [rule({ amount: null })],
    });

    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      '金额设置无效',
    );
  });

  it('rejects a print product that ends before Q20000 without a null sentinel', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        colorBase({
          id: 'color-ice-mid-q1000',
          code: 'BASE_COLOR-ICE-WHITE-160-MID_Q1000',
          amount: '320.0000',
          minQty: 1_000,
          maxQty: 1_000,
        }),
      ],
    });
    const messages = issues.map((issue) => issue.message).join('\n');

    expect(messages).toContain('末档必须达到 Q20000');
    expect(messages).toContain('Q2000 是来源表空档');
  });

  it('rejects a null print tier followed by a later automatic price', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'PROCESSING',
      rules: [
        colorBase(),
        colorBase({
          id: 'color-ice-mid-q20000',
          code: 'BASE_COLOR-ICE-WHITE-160-MID_Q20000',
          amount: '2500.0000',
          minQty: 20_000,
          maxQty: 20_000,
        }),
      ],
    });

    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      '空价档必须是该产品的末档',
    );
  });

  it('rejects non-contiguous carton tiers and over-precision money', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'LOGISTICS',
      rules: [
        shipping(),
        packaging({ amount: '1.00001', maxQty: 500 }),
        packaging({
          id: 'packaging-b',
          code: 'PACK_B',
          name: '纸箱费 500–5000',
          minQty: 500,
          maxQty: 5_000,
        }),
      ],
    });

    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      '最多 4 位小数',
    );
    expect(issues.map((issue) => issue.message)).toContain(
      '纸箱费数量区间必须从 501 开始连续分档',
    );
  });

  it.each([
    ['does not start at one', { minQty: 2, maxQty: 5_000 }, '从 1 开始'],
    ['does not end at 5000', { minQty: 1, maxQty: 4_999 }, '末档上限必须为 5000 个'],
  ])('rejects a carton range that %s', (_label, overrides, expected) => {
    const issues = validateDraftPriceBookRules({
      purpose: 'LOGISTICS',
      rules: [shipping(), packaging(overrides)],
    });

    expect(issues.map((issue) => issue.message).join('\n')).toContain(expected);
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
      '纸箱费金额超过收费可保存上限 9999999999.99 元',
    );
  });

  it('按运行时向上取整校验最大计费重量的最后一个续重单位', () => {
    const issues = validateDraftPriceBookRules({
      purpose: 'LOGISTICS',
      rules: [
        shipping({
          amount: '9999999666.6568',
          includedUnits: '1.000',
          incrementUnits: '3.000',
          incrementAmount: '0.0001',
        }),
        ...packagingTiers(),
      ],
    });

    expect(issues.map((issue) => issue.message)).toContain(
      '收费项目在最大计费重量下超过可保存上限 9999999999.99 元',
    );
  });
});
