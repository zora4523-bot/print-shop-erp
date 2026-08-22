import { describe, expect, it } from 'vitest';
import { NO_FOIL_COLOR } from '@/lib/order/foil-colors';
import {
  calculateExternalSalesQuote,
  type ExternalSalesPriceRule,
  type ExternalSalesQuoteInput,
} from '../external-sales-quote';

const priceBook = {
  id: 'book-external',
  code: 'EXTERNAL_SALES_PROCESSING_202608',
  name: '外部销售加工费（2026-08）',
  version: 1,
  sourceName: '长昆-线下报价表(3)(1).xlsx',
  sourceSha256: 'hash',
};

function input(
  overrides: Partial<ExternalSalesQuoteInput> = {},
): ExternalSalesQuoteInput {
  return {
    quantity: 1_000,
    productId: 'product-foil-medium',
    productCode: 'EXT-FOIL-MEDIUM',
    craftIds: ['craft-foil'],
    craftCodes: ['FLAT_FOIL_SINGLE'],
    specification: '中号80*115',
    paperType: '160g艳闪',
    foilColors: ['哑金'],
    isDoubleSided: false,
    isDoubleColor: false,
    settlementType: 'EXTERNAL_SALES',
    orderItemCount: 1,
    ...overrides,
  };
}

function rule(
  overrides: Partial<ExternalSalesPriceRule> = {},
): ExternalSalesPriceRule {
  return {
    id: 'rule-base',
    code: 'FOIL_MEDIUM_1000',
    name: '专版单色平烫 · 中号 · 1000个',
    kind: 'BASE',
    calculationType: 'PER_PIECE',
    amount: '0.3100',
    minQty: 1_000,
    maxQty: 1_000,
    triggerCondition: {
      specifications: ['中号80*115'],
      paperTypes: ['160g艳闪', '160g红卡', '150g莱尼纹'],
    },
    exclusiveGroup: null,
    priority: 0,
    blocksAutomaticQuote: false,
    sourceSheet: '烫金',
    sourceRange: 'G4',
    note: null,
    productId: 'product-foil-medium',
    category: { code: 'BASE_PRODUCT', name: '基础加工费' },
    ...overrides,
  };
}

describe('calculateExternalSalesQuote', () => {
  it('calculates a documented per-piece anchor and preserves source evidence', () => {
    const paper = rule({
      id: 'paper-surcharge',
      code: 'PAPER_LINEN',
      name: '150g莱尼纹加价',
      kind: 'ADD_ON',
      calculationType: 'PER_PIECE',
      amount: '0.0350',
      minQty: null,
      maxQty: null,
      triggerCondition: {
        productCodes: ['EXT-FOIL-MEDIUM'],
        paperTypes: ['150g莱尼纹'],
      },
      productId: null,
      category: { code: 'PAPER', name: '纸张加价' },
      sourceRange: 'E7',
    });

    const result = calculateExternalSalesQuote({
      input: input({ paperType: '150g莱尼纹' }),
      priceBook,
      rules: [rule(), paper],
    });

    expect(result).toMatchObject({
      complete: true,
      suggestedUnitPrice: '0.3450',
      suggestedFixedFee: '0.00',
      suggestedSubtotal: '345.00',
    });
    expect(result.components).toEqual([
      expect.objectContaining({
        ruleCode: 'FOIL_MEDIUM_1000',
        categoryCode: 'BASE_PRODUCT',
        sourceSheet: '烫金',
        sourceRange: 'G4',
        amount: '310.00',
      }),
      expect.objectContaining({
        ruleCode: 'PAPER_LINEN',
        categoryCode: 'PAPER',
        amount: '35.00',
      }),
    ]);
    expect(result.snapshot.priceBook).toMatchObject({
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      sourceSha256: 'hash',
    });
  });

  it('preserves a fractional-cent source rate while rounding only the subtotal', () => {
    const result = calculateExternalSalesQuote({
      input: input({ quantity: 1 }),
      priceBook,
      rules: [
        rule({
          amount: '0.1350',
          minQty: 1,
          maxQty: 1,
        }),
      ],
    });

    expect(result).toMatchObject({
      complete: true,
      suggestedUnitPrice: '0.1350',
      suggestedFixedFee: '0.00',
      suggestedSubtotal: '0.14',
    });
    expect(result.components[0]).toMatchObject({
      rate: '0.1350',
      amount: '0.14',
    });
  });

  it('keeps a fixed batch total as an explicit one-time amount', () => {
    const result = calculateExternalSalesQuote({
      input: input({
        quantity: 2_000,
        productId: 'color-200-large',
        productCode: 'EXT-COLOR-200-LARGE',
        specification: '大号',
        paperType: '200g双铜纸',
        craftCodes: ['COATED_COLOR_PRINT'],
      }),
      priceBook,
      rules: [
        rule({
          id: 'color-fixed',
          code: 'COLOR_200_LARGE_2000',
          name: '200g双铜纸大号 · 2000个',
          calculationType: 'FIXED_AMOUNT',
          amount: '450.0000',
          minQty: 2_000,
          maxQty: 2_000,
          triggerCondition: {
            specifications: ['大号'],
            paperTypes: ['200g双铜纸'],
          },
          productId: 'color-200-large',
          sourceSheet: '彩印',
          sourceRange: 'I6',
        }),
      ],
    });

    expect(result).toMatchObject({
      complete: true,
      suggestedUnitPrice: '0.0000',
      suggestedFixedFee: '450.00',
      suggestedSubtotal: '450.00',
    });
    expect(result.components[0]).toMatchObject({
      adjustmentType: 'FIXED_AMOUNT',
      units: '1',
      amount: '450.00',
    });
  });

  it('fails closed for a quantity that is not an explicit workbook anchor', () => {
    const result = calculateExternalSalesQuote({
      input: input({ quantity: 1_500 }),
      priceBook,
      rules: [rule()],
    });

    expect(result.complete).toBe(false);
    expect(result.suggestedSubtotal).toBeNull();
    expect(result.errors).toContain(
      '报价单未覆盖当前产品、规格、纸张或数量，请联系管理员人工报价',
    );
  });

  it('uses the unique highest-priority rule within an exclusive group', () => {
    const general = rule({
      id: 'packing-single',
      code: 'PACKING_SINGLE',
      name: '单款入袋',
      kind: 'ADD_ON',
      amount: '0.1000',
      minQty: null,
      maxQty: null,
      triggerCondition: { craftCodes: ['PACKING'] },
      productId: null,
      exclusiveGroup: 'PACKING',
      priority: 10,
    });
    const mixed = rule({
      id: 'packing-mixed',
      code: 'PACKING_MIXED',
      name: '混装入袋',
      kind: 'ADD_ON',
      amount: '0.2000',
      minQty: null,
      maxQty: null,
      triggerCondition: {
        craftCodes: ['PACKING'],
        minItemCount: 2,
      },
      productId: null,
      exclusiveGroup: 'PACKING',
      priority: 20,
    });
    const result = calculateExternalSalesQuote({
      input: input({ craftCodes: ['FLAT_FOIL_SINGLE', 'PACKING'], orderItemCount: 2 }),
      priceBook,
      rules: [rule(), general, mixed],
    });

    expect(result.complete).toBe(true);
    expect(result.components.map((component) => component.ruleCode)).toEqual([
      'FOIL_MEDIUM_1000',
      'PACKING_MIXED',
    ]);
  });

  it('fails closed when an exclusive group has a priority tie', () => {
    const first = rule({
      id: 'first',
      code: 'ADD_A',
      name: '附加 A',
      kind: 'ADD_ON',
      minQty: null,
      maxQty: null,
      productId: null,
      exclusiveGroup: 'SAME_GROUP',
      priority: 10,
    });
    const second = rule({
      id: 'second',
      code: 'ADD_B',
      name: '附加 B',
      kind: 'ADD_ON',
      minQty: null,
      maxQty: null,
      productId: null,
      exclusiveGroup: 'SAME_GROUP',
      priority: 10,
    });
    const result = calculateExternalSalesQuote({
      input: input(),
      priceBook,
      rules: [rule(), first, second],
    });

    expect(result.complete).toBe(false);
    expect(result.errors).toContain(
      '收费规则组“SAME_GROUP”同时命中多个同优先级规则，请管理员修正规则',
    );
  });

  it('fails closed when more than one BASE rule matches the same item', () => {
    const result = calculateExternalSalesQuote({
      input: input(),
      priceBook,
      rules: [
        rule(),
        rule({
          id: 'rule-base-conflict',
          code: 'FOIL_MEDIUM_1000_CONFLICT',
          name: '冲突的基础报价',
        }),
      ],
    });

    expect(result.complete).toBe(false);
    expect(result.suggestedUnitPrice).toBeNull();
    expect(result.suggestedFixedFee).toBeNull();
    expect(result.suggestedSubtotal).toBeNull();
    expect(result.components).toEqual([]);
    expect(result.errors).toContain(
      '同时命中多个基础报价规则，请管理员修正规则后再报价',
    );
  });

  it('blocks automatic pricing when a matching reference requires manual review', () => {
    const manual = rule({
      id: 'manual-multicolor',
      code: 'COLOR_FOIL_MULTI_MANUAL',
      name: '彩印多色烫金',
      kind: 'REFERENCE',
      calculationType: null,
      amount: null,
      minQty: null,
      maxQty: null,
      triggerCondition: {
        craftCodes: ['COATED_COLOR_PRINT_FOIL'],
        minFoilColorCount: 2,
      },
      productId: null,
      blocksAutomaticQuote: true,
      note: '原报价单只提供单色烫金',
    });
    const result = calculateExternalSalesQuote({
      input: input({
        craftCodes: ['COATED_COLOR_PRINT_FOIL'],
        foilColors: ['哑金', '红金'],
      }),
      priceBook,
      rules: [rule(), manual],
    });

    expect(result.complete).toBe(false);
    expect(result.errors).toContain(
      '需人工报价：彩印多色烫金（原报价单只提供单色烫金）',
    );
  });

  it.each([
    {
      label: '无颜色占位符按 0 种实际烫金色计算',
      foilColors: [NO_FOIL_COLOR],
      complete: false,
      subtotal: null,
      expectedRuleCodes: ['FOIL_MEDIUM_1000'],
      expectedError: '需人工报价：彩印+烫金未选择实际烫金色',
    },
    {
      label: '重复的同一颜色只按 1 种实际烫金色计算',
      foilColors: ['哑金', '哑金'],
      complete: true,
      subtotal: '560.00',
      expectedRuleCodes: ['FOIL_MEDIUM_1000', 'COLOR_FOIL_SINGLE_Q1000'],
      expectedError: null,
    },
    {
      label: '2 种实际烫金色禁止套用单色附加费',
      foilColors: ['哑金', '红金'],
      complete: false,
      subtotal: null,
      expectedRuleCodes: ['FOIL_MEDIUM_1000'],
      expectedError: '需人工报价：彩印多色烫金',
    },
    {
      label: '3 种实际烫金色仍然必须人工报价',
      foilColors: ['哑金', '红金', '蓝金'],
      complete: false,
      subtotal: null,
      expectedRuleCodes: ['FOIL_MEDIUM_1000'],
      expectedError: '需人工报价：彩印多色烫金',
    },
  ])('$label', ({
    foilColors,
    complete,
    subtotal,
    expectedRuleCodes,
    expectedError,
  }) => {
    const singleColor = rule({
      id: 'color-foil-single-q1000',
      code: 'COLOR_FOIL_SINGLE_Q1000',
      name: '彩印单色烫金 1000 个附加费',
      kind: 'ADD_ON',
      calculationType: 'FIXED_AMOUNT',
      amount: '250.0000',
      minQty: 1_000,
      maxQty: 1_000,
      triggerCondition: {
        craftCodes: ['COATED_COLOR_PRINT_FOIL'],
        foilColorCount: 1,
      },
      productId: null,
      category: { code: 'FOIL', name: '烫金附加费' },
    });
    const missingColor = rule({
      id: 'color-foil-missing',
      code: 'COLOR_FOIL_MISSING',
      name: '彩印+烫金未选择实际烫金色',
      kind: 'REFERENCE',
      calculationType: null,
      amount: null,
      minQty: null,
      maxQty: null,
      triggerCondition: {
        craftCodes: ['COATED_COLOR_PRINT_FOIL'],
        foilColorCount: 0,
      },
      productId: null,
      blocksAutomaticQuote: true,
      category: { code: 'REFERENCE', name: '人工报价提示' },
    });
    const multiColor = rule({
      id: 'color-foil-multi',
      code: 'COLOR_FOIL_MULTI',
      name: '彩印多色烫金',
      kind: 'REFERENCE',
      calculationType: null,
      amount: null,
      minQty: null,
      maxQty: null,
      triggerCondition: {
        craftCodes: ['COATED_COLOR_PRINT_FOIL'],
        minFoilColorCount: 2,
      },
      productId: null,
      blocksAutomaticQuote: true,
      category: { code: 'REFERENCE', name: '人工报价提示' },
    });

    const result = calculateExternalSalesQuote({
      input: input({
        craftCodes: ['COATED_COLOR_PRINT_FOIL'],
        foilColors,
        // The actual selected colors, not this legacy presentation flag,
        // decide whether single- or multi-color pricing is safe.
        isDoubleColor: false,
      }),
      priceBook,
      rules: [rule(), singleColor, missingColor, multiColor],
    });

    expect(result.complete).toBe(complete);
    expect(result.suggestedSubtotal).toBe(subtotal);
    expect(result.components.map((component) => component.ruleCode)).toEqual(
      expectedRuleCodes,
    );
    if (expectedError) {
      expect(result.errors).toContain(expectedError);
    } else {
      expect(result.errors).toEqual([]);
    }
  });

  it('rejects unknown condition keys instead of silently ignoring them', () => {
    const result = calculateExternalSalesQuote({
      input: input(),
      priceBook,
      rules: [rule({ triggerCondition: { guessedField: true } })],
    });

    expect(result.complete).toBe(false);
    expect(result.errors).toContain(
      '报价规则“专版单色平烫 · 中号 · 1000个”：包含未知触发字段：guessedField',
    );
  });

  it('低数量彩印+单色烫金虽命中彩印基础价，仍必须人工报价', () => {
    const colorBase = rule({
      id: 'color-base-q100',
      code: 'BASE_COLOR_200_COATED_LARGE_Q100',
      name: '200克双铜纸彩印 大号 100个固定总额',
      calculationType: 'FIXED_AMOUNT',
      amount: '130.0000',
      minQty: 100,
      maxQty: 100,
      triggerCondition: {
        productCodes: ['EXT-COLOR-200-COATED-LARGE'],
        specifications: ['大号'],
        paperTypes: ['200g双铜纸'],
      },
      productId: 'color-200-large',
      sourceSheet: '彩印',
      sourceRange: 'E6',
    });
    const lowQuantityGuard = rule({
      id: 'guard-color-single-foil-low-qty',
      code: 'GUARD_COLOR_SINGLE_FOIL_LOW_QTY',
      name: '彩印单色烫金 500 个以下未定价',
      kind: 'REFERENCE',
      calculationType: null,
      amount: null,
      minQty: 1,
      maxQty: 499,
      triggerCondition: {
        productCodes: ['EXT-COLOR-200-COATED-LARGE'],
        craftCodes: ['COATED_COLOR_PRINT_FOIL', 'COLOR_PRINT_FOIL'],
        foilColorCount: 1,
      },
      productId: null,
      blocksAutomaticQuote: true,
      category: { code: 'FOIL_SURCHARGE', name: '烫金附加费' },
      sourceSheet: '彩印',
      sourceRange: 'C3:N14',
    });

    const result = calculateExternalSalesQuote({
      input: input({
        quantity: 100,
        productId: 'color-200-large',
        productCode: 'EXT-COLOR-200-COATED-LARGE',
        craftCodes: ['COATED_COLOR_PRINT_FOIL'],
        specification: '大号',
        paperType: '200g双铜纸',
        foilColors: ['哑金'],
      }),
      priceBook,
      rules: [colorBase, lowQuantityGuard],
    });

    expect(result.components.map((component) => component.ruleCode)).toEqual([
      'BASE_COLOR_200_COATED_LARGE_Q100',
    ]);
    expect(result.complete).toBe(false);
    expect(result.suggestedSubtotal).toBeNull();
    expect(result.errors).toContain(
      '需人工报价：彩印单色烫金 500 个以下未定价',
    );
  });

  it('专版平烫未选实际烫金色时，不得只收基础价', () => {
    const customBase = rule({
      id: 'custom-base-q1000',
      code: 'BASE_CUSTOM_MID_Q1000',
      triggerCondition: {
        productCodes: ['EXT-CUSTOM-FOIL-MID-SQUARE'],
        specifications: ['中号'],
        paperTypes: ['艳红珠光纸'],
      },
    });
    const missingColorGuard = rule({
      id: 'guard-custom-foil-color-required',
      code: 'GUARD_CUSTOM_FOIL_COLOR_REQUIRED',
      name: '专版平烫必须选择实际烫金色',
      kind: 'REFERENCE',
      calculationType: null,
      amount: null,
      minQty: null,
      maxQty: null,
      triggerCondition: {
        productCodes: ['EXT-CUSTOM-FOIL-MID-SQUARE'],
        foilColorCount: 0,
      },
      productId: null,
      blocksAutomaticQuote: true,
      category: { code: 'COLOR_SURCHARGE', name: '颜色附加费' },
    });

    const result = calculateExternalSalesQuote({
      input: input({
        productCode: 'EXT-CUSTOM-FOIL-MID-SQUARE',
        specification: '中号',
        paperType: '艳红珠光纸',
        foilColors: [NO_FOIL_COLOR],
      }),
      priceBook,
      rules: [customBase, missingColorGuard],
    });

    expect(result.complete).toBe(false);
    expect(result.suggestedSubtotal).toBeNull();
    expect(result.errors).toContain(
      '需人工报价：专版平烫必须选择实际烫金色',
    );
  });

  it('现货产品选现货加烫时，必须命中机仔烫金人工报价阻断', () => {
    const stockBase = rule({
      id: 'stock-base',
      code: 'BASE_STOCK_A14_180',
      name: '空封现货基础价',
      amount: '0.1350',
      minQty: 1,
      maxQty: 9_999_999,
      triggerCondition: {
        productCodes: ['EXT-STOCK-FOIL-A14-180-RED'],
        specifications: ['大号'],
        paperTypes: ['180g红卡'],
      },
      productId: 'stock-a14-180',
      sourceSheet: '烫金',
      sourceRange: 'A14:C14',
    });
    const machineFoilGuard = rule({
      id: 'machine-foil-ambiguous',
      code: 'REF_MACHINE_FOIL_AMBIGUOUS',
      name: '机仔烫金费用边界与万元封叠加关系未定',
      kind: 'REFERENCE',
      calculationType: null,
      amount: null,
      minQty: null,
      maxQty: null,
      triggerCondition: {
        craftCodes: ['FLAT_FOIL_PARTIAL', 'STOCK_FOIL'],
      },
      productId: null,
      blocksAutomaticQuote: true,
    });

    const result = calculateExternalSalesQuote({
      input: input({
        quantity: 1_000,
        productId: 'stock-a14-180',
        productCode: 'EXT-STOCK-FOIL-A14-180-RED',
        craftCodes: ['STOCK_FOIL'],
        specification: '大号',
        paperType: '180g红卡',
        foilColors: ['哑金'],
      }),
      priceBook,
      rules: [stockBase, machineFoilGuard],
    });

    expect(result.complete).toBe(false);
    expect(result.suggestedSubtotal).toBeNull();
    expect(result.errors).toContain(
      '需人工报价：机仔烫金费用边界与万元封叠加关系未定',
    );
  });

  it.each([
    {
      label: '同时选择 UV 这个报价单未定价工艺',
      craftCodes: ['COATED_COLOR_PRINT', 'UV'],
      expectedError: '需人工报价：铜版纸彩印包含未定价工艺',
    },
    {
      label: '未选择铜版纸彩印对应工艺',
      craftCodes: ['DIE_CUT'],
      expectedError: '需人工报价：铜版纸彩印产品必须选择对应彩印工艺',
    },
    {
      label: '未知的新工艺 code 不在允许集合内',
      craftCodes: ['COATED_COLOR_PRINT', 'FUTURE_UNPRICED_CRAFT'],
      expectedError: '需人工报价：铜版纸彩印包含未定价工艺',
    },
  ])('彩印安全谓词：$label', ({ craftCodes, expectedError }) => {
    const colorBase = rule({
      id: 'color-base-q1000',
      code: 'BASE_COLOR_200_COATED_LARGE_Q1000',
      name: '200克双铜纸彩印 大号 1000个固定总额',
      calculationType: 'FIXED_AMOUNT',
      amount: '310.0000',
      triggerCondition: {
        productCodes: ['EXT-COLOR-200-COATED-LARGE'],
        specifications: ['大号'],
        paperTypes: ['200g双铜纸'],
      },
      productId: 'color-200-large',
    });
    const processRequiredGuard = rule({
      id: 'guard-coating-process-required',
      code: 'GUARD_COATED_COLOR_PRINT_PROCESS_REQUIRED',
      name: '铜版纸彩印产品必须选择对应彩印工艺',
      kind: 'REFERENCE',
      calculationType: null,
      amount: null,
      minQty: null,
      maxQty: null,
      triggerCondition: {
        productCodes: ['EXT-COLOR-200-COATED-LARGE'],
        noneOfCraftCodes: ['COATED_COLOR_PRINT', 'COATED_COLOR_PRINT_FOIL'],
      },
      productId: null,
      blocksAutomaticQuote: true,
    });
    const unsupportedCraftGuard = rule({
      id: 'guard-coating-unsupported-craft',
      code: 'GUARD_COATED_UNSUPPORTED_CRAFT',
      name: '铜版纸彩印包含未定价工艺',
      kind: 'REFERENCE',
      calculationType: null,
      amount: null,
      minQty: null,
      maxQty: null,
      triggerCondition: {
        productCodes: ['EXT-COLOR-200-COATED-LARGE'],
        anyCraftCodeOutside: [
          'COATED_COLOR_PRINT',
          'COATED_COLOR_PRINT_FOIL',
          'DIE_CUT',
          'GLUING',
          'EMBOSS',
          'BUMP',
          'PACKING',
        ],
      },
      productId: null,
      blocksAutomaticQuote: true,
    });

    const result = calculateExternalSalesQuote({
      input: input({
        productId: 'color-200-large',
        productCode: 'EXT-COLOR-200-COATED-LARGE',
        craftCodes,
        specification: '大号',
        paperType: '200g双铜纸',
        foilColors: [NO_FOIL_COLOR],
      }),
      priceBook,
      rules: [colorBase, processRequiredGuard, unsupportedCraftGuard],
    });

    expect(result.complete).toBe(false);
    expect(result.suggestedSubtotal).toBeNull();
    expect(result.errors).toContain(expectedError);
  });

  it.each([
    {
      condition: {
        anyCraftCodeOutside: ['FLAT_FOIL_SINGLE'],
        anyCraftCodesOutside: ['FLAT_FOIL_SINGLE'],
      },
      unknownKey: 'anyCraftCodesOutside',
    },
    {
      condition: {
        noneOfCraftCodes: ['FLAT_FOIL_SINGLE'],
        noneCraftCodes: ['FLAT_FOIL_SINGLE'],
      },
      unknownKey: 'noneCraftCodes',
    },
  ])('新工艺谓词与未知 key 并存时不得静默放行：$unknownKey', ({
    condition,
    unknownKey,
  }) => {
    const invalidGuard = rule({
      id: `invalid-${unknownKey}`,
      code: `INVALID_${unknownKey}`,
      name: `含未知字段 ${unknownKey} 的安全规则`,
      kind: 'REFERENCE',
      calculationType: null,
      amount: null,
      minQty: null,
      maxQty: null,
      triggerCondition: condition,
      productId: null,
      blocksAutomaticQuote: true,
    });

    const result = calculateExternalSalesQuote({
      input: input(),
      priceBook,
      rules: [rule(), invalidGuard],
    });

    expect(result.complete).toBe(false);
    expect(result.suggestedSubtotal).toBeNull();
    expect(result.errors).toContain(
      `报价规则“含未知字段 ${unknownKey} 的安全规则”：包含未知触发字段：${unknownKey}`,
    );
  });
});
