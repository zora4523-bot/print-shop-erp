import { describe, expect, it } from 'vitest';
import {
  calculateExternalSalesQuote,
  type ExternalSalesPriceRule,
  type ExternalSalesQuoteInput,
} from '../external-sales-quote';

const priceBook = {
  id: 'cpb-external-processing-v2',
  code: 'EXTERNAL_SALES_PROCESSING_RULES',
  name: '外部销售加工费 · 结构化规则',
  version: 1,
  sourceName: '加工费计费规则.md',
  sourceSha256:
    '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817',
};

function input(
  overrides: Partial<ExternalSalesQuoteInput> = {},
): ExternalSalesQuoteInput {
  return {
    quantity: 5_000,
    productId: 'custom-large',
    productCode: 'EXT-CUSTOM-LARGE',
    craftIds: ['craft-flat'],
    craftCodes: ['FLAT_FOIL_SINGLE'],
    specification: '大号封90×165',
    paperType: '160g珠光艳闪',
    paperCatalogMatched: true,
    pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
    productStructure: 'STANDARD_ENVELOPE',
    artworkVersion: 'V1',
    plateGroupId: null,
    pricingGroup: '大号',
    actualWidthMm: 90,
    actualHeightMm: 165,
    paperWeightGsm: 160,
    catalogSpecification: '大号封90×165',
    catalogPaperType: null,
    catalogSpecificationMatched: true,
    catalogDimensionsMatched: true,
    catalogPaperWeightMatched: true,
    frontFoilColors: ['哑金'],
    backFoilColors: [],
    foilColors: ['哑金'],
    foilTechnique: 'FLAT',
    hasLocalFoil: false,
    lamination: 'NONE',
    printColors: [],
    isDoubleSided: false,
    isDoubleColor: false,
    settlementType: 'EXTERNAL_SALES',
    orderItemCount: 1,
    ...overrides,
  };
}

function rule(
  overrides: Partial<ExternalSalesPriceRule>,
): ExternalSalesPriceRule {
  return {
    id: 'rule',
    code: 'RULE',
    name: '收费项目',
    kind: 'ADD_ON',
    calculationType: 'PER_PIECE',
    amount: '0.0000',
    minQty: null,
    maxQty: null,
    triggerCondition: { schemaVersion: 1, target: 'ITEM' },
    exclusiveGroup: null,
    priority: 100,
    blocksAutomaticQuote: false,
    sourceSheet: '加工费计费规则.md',
    sourceRange: null,
    note: null,
    productId: null,
    category: { code: 'OTHER', name: '其他' },
    ...overrides,
  };
}

const customLargeTiers = [
  [1, 750, '0.5200'],
  [751, 1_500, '0.3250'],
  [1_501, 2_500, '0.2850'],
  [2_501, 3_500, '0.2700'],
  [3_501, 4_500, '0.2450'],
  [4_501, 7_500, '0.2200'],
  [7_501, 15_000, '0.2000'],
  [15_001, 25_000, '0.1900'],
  [25_001, 9_999_999, '0.1900'],
] as const;

const customRules = customLargeTiers.map(([minQty, maxQty, amount]) =>
  rule({
    id: `custom-${minQty}`,
    code: `CUSTOM_${minQty}`,
    name: `专版大号 ${minQty}–${maxQty}`,
    kind: 'BASE',
    calculationType: 'PER_PIECE',
    amount,
    minQty,
    maxQty,
    productId: 'custom-large',
    category: { code: 'BASE_PROCESSING', name: '基础加工费' },
    triggerCondition: {
      schemaVersion: 1,
      target: 'ITEM',
      pricingRoutes: ['CUSTOM_SINGLE_FLAT_FOIL'],
      productCodes: ['EXT-CUSTOM-LARGE'],
      specifications: ['大号封90×165'],
      paperTypes: [
        '160g珠光艳闪',
        '160g红卡',
        '200g触感纸',
      ],
    },
  }),
);

describe('外部销售加工费规则 v2 黄金用例', () => {
  it.each([
    [1, '0.5200'],
    [750, '0.5200'],
    [751, '0.3250'],
    [4_500, '0.2450'],
    [4_501, '0.2200'],
    [7_500, '0.2200'],
    [7_501, '0.2000'],
    [25_000, '0.1900'],
    [25_001, '0.1900'],
  ])('专版大号数量 %i 命中连续区间单价 %s', (quantity, unitPrice) => {
    const result = calculateExternalSalesQuote({
      input: input({ quantity }),
      priceBook,
      rules: customRules,
    });

    expect(result.complete).toBe(true);
    expect(result.suggestedUnitPrice).toBe(unitPrice);
  });

  it('专版触感纸与浮雕叠加每件费用，并只收一次 90 元调版费', () => {
    const paper = rule({
      id: 'paper-touch',
      code: 'CUSTOM_PAPER_SOFT_TOUCH_200',
      name: '触感纸 200g',
      amount: '0.1000',
      triggerCondition: {
        schemaVersion: 1,
        target: 'ITEM',
        pricingRoutes: ['CUSTOM_SINGLE_FLAT_FOIL'],
        paperTypes: ['200g触感纸'],
      },
      category: { code: 'PAPER_SURCHARGE', name: '纸张加价' },
    });
    const reliefPiece = rule({
      id: 'relief-piece',
      code: 'CUSTOM_RELIEF_PIECE',
      name: '浮雕',
      amount: '0.0500',
      triggerCondition: {
        schemaVersion: 1,
        target: 'ITEM',
        pricingRoutes: ['CUSTOM_SINGLE_FLAT_FOIL'],
        foilTechniques: ['RELIEF'],
      },
      category: { code: 'SPECIAL_EFFECT', name: '特殊工艺' },
    });
    const setup = rule({
      id: 'relief-setup',
      code: 'CUSTOM_RELIEF_SETUP',
      name: '浮雕调版费',
      calculationType: 'FIXED_AMOUNT',
      amount: '90.0000',
      triggerCondition: {
        schemaVersion: 1,
        target: 'ITEM',
        pricingRoutes: ['CUSTOM_SINGLE_FLAT_FOIL'],
        foilTechniques: ['RELIEF'],
      },
      category: { code: 'SPECIAL_EFFECT', name: '特殊工艺' },
    });

    const result = calculateExternalSalesQuote({
      input: input({
        paperType: '200g触感纸',
        paperWeightGsm: 200,
        foilTechnique: 'RELIEF',
        craftCodes: ['EMBOSS'],
      }),
      priceBook,
      rules: [...customRules, paper, reliefPiece, setup],
    });

    expect(result).toMatchObject({
      complete: true,
      suggestedUnitPrice: '0.3700',
      suggestedFixedFee: '90.00',
      suggestedSubtotal: '1940.00',
    });
  });

  it.each([
    {
      label: '三色',
      overrides: {
        frontFoilColors: ['哑金', '红金', '银'],
        foilColors: ['哑金', '红金', '银'],
      },
    },
    {
      label: '手工克重',
      overrides: { catalogPaperWeightMatched: false },
    },
    {
      label: '改尺寸',
      overrides: { catalogDimensionsMatched: false },
    },
    {
      label: '万元封专版',
      overrides: { productStructure: 'TEN_THOUSAND_ENVELOPE' as const },
    },
  ])('专版$label返回人工核价且不出金额', ({ overrides }) => {
    const result = calculateExternalSalesQuote({
      input: input(overrides),
      priceBook,
      rules: customRules,
    });

    expect(result.complete).toBe(false);
    expect(result.suggestedSubtotal).toBeNull();
    expect(result.errors.join('；')).toContain('MANUAL_PRICING_REQUIRED');
  });

  const colorBaseRules = [
    rule({
      id: 'color-coat-1000',
      code: 'COLOR_COATED_LARGE_Q1000',
      name: '铜版 200g 大号 1000',
      kind: 'BASE',
      calculationType: 'FIXED_AMOUNT',
      amount: '310.0000',
      minQty: 1_000,
      maxQty: 1_000,
      productId: 'color-coated-large',
      category: { code: 'BASE_PROCESSING', name: '基础加工费' },
      triggerCondition: {
        schemaVersion: 1,
        target: 'ITEM',
        pricingRoutes: ['COLOR_PRINT'],
        productCodes: ['EXT-COLOR-COATED-200-LARGE'],
      },
    }),
    rule({
      id: 'color-coat-5000',
      code: 'COLOR_COATED_LARGE_Q5000',
      name: '铜版 200g 大号 5000–7999',
      kind: 'BASE',
      calculationType: 'FIXED_AMOUNT',
      amount: '870.0000',
      minQty: 5_000,
      maxQty: 7_999,
      productId: 'color-coated-large',
      category: { code: 'BASE_PROCESSING', name: '基础加工费' },
      triggerCondition: {
        schemaVersion: 1,
        target: 'ITEM',
        pricingRoutes: ['COLOR_PRINT'],
        productCodes: ['EXT-COLOR-COATED-200-LARGE'],
      },
    }),
  ];

  function colorInput(
    overrides: Partial<ExternalSalesQuoteInput> = {},
  ): ExternalSalesQuoteInput {
    return input({
      quantity: 1_000,
      productId: 'color-coated-large',
      productCode: 'EXT-COLOR-COATED-200-LARGE',
      craftCodes: ['COATED_COLOR_PRINT'],
      specification: '大号88×165',
      paperType: '200g铜版纸',
      pricingRoute: 'COLOR_PRINT',
      actualWidthMm: 88,
      actualHeightMm: 165,
      paperWeightGsm: 200,
      lamination: 'MATTE',
      catalogSpecification: '大号88×165',
      catalogPaperType: '200g铜版纸',
      frontFoilColors: [],
      backFoilColors: [],
      foilColors: [],
      foilTechnique: 'NONE',
      hasLocalFoil: false,
      printColors: ['C', 'M', 'Y', 'K'],
      ...overrides,
    });
  }

  it('彩印固定总价不乘数量，6000 个按 5000 档', () => {
    const at1000 = calculateExternalSalesQuote({
      input: colorInput(),
      priceBook,
      rules: colorBaseRules,
    });
    const at6000 = calculateExternalSalesQuote({
      input: colorInput({ quantity: 6_000 }),
      priceBook,
      rules: colorBaseRules,
    });

    expect(at1000.suggestedSubtotal).toBe('310.00');
    expect(at6000.suggestedSubtotal).toBe('870.00');
  });

  it.each([100, 500])(
    '彩印 %i 个加单色烫金时因附加价未定转人工，不只收彩印基础价',
    (quantity) => {
      const base = rule({
        id: `color-coat-${quantity}`,
        code: `COLOR_COATED_LARGE_Q${quantity}`,
        name: `铜版 200g 大号 ${quantity}`,
        kind: 'BASE',
        calculationType: 'FIXED_AMOUNT',
        amount: quantity === 100 ? '130.0000' : '260.0000',
        minQty: quantity,
        maxQty: quantity,
        productId: 'color-coated-large',
        category: { code: 'BASE_PROCESSING', name: '基础加工费' },
        triggerCondition: {
          schemaVersion: 1,
          target: 'ITEM',
          pricingRoutes: ['COLOR_PRINT'],
          productCodes: ['EXT-COLOR-COATED-200-LARGE'],
        },
      });
      const guard = rule({
        id: 'color-foil-lt-1000-manual',
        code: 'COLOR_SINGLE_FRONT_FOIL_LT_1000_MANUAL',
        name: '彩印单色烫金 1000 个以下',
        kind: 'REFERENCE',
        calculationType: null,
        amount: null,
        minQty: 1,
        maxQty: 999,
        blocksAutomaticQuote: true,
        note: '单色烫金附加总价从 1000 个起才有明确报价',
        category: { code: 'FOIL_SURCHARGE', name: '烫金费' },
        triggerCondition: {
          schemaVersion: 1,
          target: 'ITEM',
          pricingRoutes: ['COLOR_PRINT'],
          foilTechniques: ['FLAT'],
          foilPassCount: 1,
        },
      });

      const result = calculateExternalSalesQuote({
        input: colorInput({
          quantity,
          craftCodes: ['COATED_COLOR_PRINT_FOIL'],
          frontFoilColors: ['哑金'],
          foilColors: ['哑金'],
          foilTechnique: 'FLAT',
          hasLocalFoil: true,
        }),
        priceBook,
        rules: [base, guard],
      });

      expect(result.complete).toBe(false);
      expect(result.suggestedSubtotal).toBeNull();
      expect(result.errors).toContain(
        '需人工报价：彩印单色烫金 1000 个以下（单色烫金附加总价从 1000 个起才有明确报价）',
      );
    },
  );

  it('彩印 1000 个正面单色烫金叠加 200 元', () => {
    const foil = rule({
      id: 'color-foil-1000',
      code: 'COLOR_SINGLE_FRONT_FOIL_Q1000',
      name: '彩印正面单色烫金 1000',
      calculationType: 'FIXED_AMOUNT',
      amount: '200.0000',
      minQty: 1_000,
      maxQty: 1_000,
      category: { code: 'FOIL_SURCHARGE', name: '烫金费' },
      triggerCondition: {
        schemaVersion: 1,
        target: 'ITEM',
        pricingRoutes: ['COLOR_PRINT'],
        foilTechniques: ['FLAT'],
        foilPassCount: 1,
      },
    });
    const result = calculateExternalSalesQuote({
      input: colorInput({
        craftCodes: ['COATED_COLOR_PRINT_FOIL'],
        frontFoilColors: ['哑金'],
        foilColors: ['哑金'],
        foilTechnique: 'FLAT',
        hasLocalFoil: true,
      }),
      priceBook,
      rules: [...colorBaseRules, foil],
    });

    expect(result.suggestedSubtotal).toBe('510.00');
  });

  it('彩印缺少纸张/规格/数量档时转人工，不取最近档', () => {
    const result = calculateExternalSalesQuote({
      input: colorInput({
        productId: 'color-ice-mid',
        productCode: 'EXT-COLOR-ICE-WHITE-160-MID',
        paperType: '160g冰白纸',
        quantity: 2_000,
      }),
      priceBook,
      rules: colorBaseRules,
    });

    expect(result.complete).toBe(false);
    expect(result.suggestedSubtotal).toBeNull();
    expect(result.errors).toContain(
      '报价单未覆盖当前产品、规格、纸张或数量，请联系管理员人工报价',
    );
  });
});
