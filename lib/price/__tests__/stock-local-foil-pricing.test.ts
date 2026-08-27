import { describe, expect, it } from 'vitest';
import {
  calculateExternalSalesQuote,
  type ExternalSalesPriceRule,
  type ExternalSalesQuoteInput,
} from '../external-sales-quote';

const priceBook = {
  id: 'book-structured-stock-local-foil',
  code: 'EXTERNAL_SALES_PROCESSING',
  name: '当前结构化规则',
  version: 2,
  sourceName: '工单规则配置中心',
  sourceSha256:
    'ec2e83a5b8fd219eef4619c09afc2617d0e8f7f9a34f916c53350dd1c9f38f32',
};

const category = { code: 'FOIL_SURCHARGE', name: '烫金附加费' };

function input(
  overrides: Partial<ExternalSalesQuoteInput> = {},
): ExternalSalesQuoteInput {
  return {
    quantity: 1_000,
    productId: 'stock-touch-large',
    productCode: 'EXT-STOCK-TOUCH-LARGE',
    craftIds: ['craft-local-foil'],
    craftCodes: ['FLAT_FOIL_PARTIAL'],
    specification: '大号90×165',
    paperType: '触感纸',
    paperCatalogMatched: true,
    pricingRoute: 'STOCK_BLANK',
    productStructure: 'STANDARD_ENVELOPE',
    artworkVersion: 'V1',
    plateGroupId: null,
    pricingGroup: null,
    actualWidthMm: 90,
    actualHeightMm: 165,
    paperWeightGsm: 160,
    frontFoilColors: ['哑金'],
    backFoilColors: [],
    foilColors: ['哑金'],
    foilTechnique: 'FLAT',
    hasLocalFoil: true,
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
    name: '规则',
    kind: 'ADD_ON',
    calculationType: 'FIXED_AMOUNT',
    amount: '0.0000',
    minQty: null,
    maxQty: null,
    exclusiveGroup: null,
    priority: 300,
    blocksAutomaticQuote: false,
    sourceSheet: '当前规则版本',
    sourceRange: null,
    note: null,
    productId: null,
    category,
    triggerCondition: null,
    ...overrides,
  };
}

const stockBase = rule({
  id: 'stock-base',
  code: 'STOCK_TOUCH_LARGE_BASE',
  name: '触感纸大号通版现货基础价',
  kind: 'BASE',
  calculationType: 'PER_PIECE',
  amount: '0.1000',
  minQty: 1,
  maxQty: 9_999_999,
  productId: 'stock-touch-large',
  category: { code: 'BASE_PROCESSING', name: '基础加工费' },
  triggerCondition: {
    schemaVersion: 1,
    target: 'ITEM',
    pricingRoutes: ['STOCK_BLANK'],
    productCodes: ['EXT-STOCK-TOUCH-LARGE'],
    specifications: ['大号90×165'],
    paperTypes: ['触感纸'],
  },
});

function localFoilRule(args: {
  id: string;
  code: string;
  name: string;
  calculationType: 'FIXED_AMOUNT' | 'PER_PIECE';
  amount: string;
  minQty: number;
  maxQty: number;
}): ExternalSalesPriceRule {
  return rule({
    ...args,
    exclusiveGroup: 'STOCK_LOCAL_FOIL_MACHINE',
    triggerCondition: {
      schemaVersion: 1,
      target: 'ITEM',
      pricingRoutes: ['STOCK_BLANK'],
      craftCodes: ['FLAT_FOIL_PARTIAL', 'STOCK_FOIL'],
      foilTechniques: ['FLAT'],
      hasLocalFoil: true,
      minFoilPassCount: 1,
      perFoilPass: true,
    },
  });
}

const localFoilRules = [
  localFoilRule({
    id: 'below',
    code: 'STOCK_LOCAL_FOIL_LT_1000_PER_PASS',
    name: '局部烫金 1–999 个',
    calculationType: 'FIXED_AMOUNT',
    amount: '40.0000',
    minQty: 1,
    maxQty: 999,
  }),
  localFoilRule({
    id: 'from-boundary',
    code: 'STOCK_LOCAL_FOIL_GTE_1000_PER_PASS',
    name: '局部烫金 1000 个起',
    calculationType: 'PER_PIECE',
    amount: '0.0400',
    minQty: 1_000,
    maxQty: 9_999_999,
  }),
];

describe('通版现货局部烫金当前规则版本', () => {
  it.each([
    {
      label: '999 个单面使用固定 40 元',
      quantity: 999,
      frontFoilColors: ['哑金'],
      backFoilColors: [],
      expectedFoil: '40.00',
      expectedTotal: '139.90',
    },
    {
      label: '999 个正一反一按两次过版收 80 元',
      quantity: 999,
      frontFoilColors: ['哑金'],
      backFoilColors: ['哑金'],
      expectedFoil: '80.00',
      expectedTotal: '179.90',
    },
    {
      label: '1000 个单面从边界开始按 0.04 元/个',
      quantity: 1_000,
      frontFoilColors: ['哑金'],
      backFoilColors: [],
      expectedFoil: '40.00',
      expectedTotal: '140.00',
    },
    {
      label: '2000 个正二反二按四次过版',
      quantity: 2_000,
      frontFoilColors: ['哑金', '红金'],
      backFoilColors: ['哑金', '红金'],
      expectedFoil: '320.00',
      expectedTotal: '520.00',
    },
  ])('$label', ({ quantity, frontFoilColors, backFoilColors, expectedFoil, expectedTotal }) => {
    const result = calculateExternalSalesQuote({
      input: input({ quantity, frontFoilColors, backFoilColors }),
      priceBook,
      rules: [stockBase, ...localFoilRules],
    });

    expect(result.complete).toBe(true);
    expect(result.suggestedSubtotal).toBe(expectedTotal);
    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          categoryCode: 'FOIL_SURCHARGE',
          amount: expectedFoil,
        }),
      ]),
    );
  });

  it('兼容历史 STOCK_FOIL 工艺代码，但只生成一项局部烫金收费', () => {
    const result = calculateExternalSalesQuote({
      input: input({ craftCodes: ['STOCK_FOIL'] }),
      priceBook,
      rules: [stockBase, ...localFoilRules],
    });

    expect(result.complete).toBe(true);
    expect(
      result.components.filter(
        (component) => component.categoryCode === 'FOIL_SURCHARGE',
      ),
    ).toHaveLength(1);
  });

  it('同色正反面仍计算两次过版，不按颜色去重', () => {
    const result = calculateExternalSalesQuote({
      input: input({
        frontFoilColors: ['哑金'],
        backFoilColors: ['哑金'],
      }),
      priceBook,
      rules: [stockBase, ...localFoilRules],
    });

    expect(result.complete).toBe(true);
    expect(result.suggestedSubtotal).toBe('180.00');
    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleCode: 'STOCK_LOCAL_FOIL_GTE_1000_PER_PASS',
          amount: '80.00',
        }),
      ]),
    );
  });
});
