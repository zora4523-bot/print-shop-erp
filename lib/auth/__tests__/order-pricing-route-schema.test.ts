import { describe, expect, it } from 'vitest';
import { createOrderSchema, quoteOrderItemsSchema } from '../schemas';

function item(overrides: Record<string, unknown> = {}) {
  return {
    name: '烫金款 A',
    productId: 'product-1',
    pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
    productStructure: 'STANDARD_ENVELOPE',
    artworkVersion: null,
    plateGroupId: null,
    pricingGroup: null,
    manualQuoteReason: null,
    specification: '中号',
    actualWidthMm: 80,
    actualHeightMm: 115,
    paperType: '160g触感纸',
    paperWeightGsm: 160,
    quantity: 2_000,
    crafts: ['craft-foil'],
    foilColors: ['哑金', '红金'],
    foilTechnique: 'RELIEF',
    hasLocalFoil: false,
    lamination: 'NONE',
    printColors: [],
    isDoubleSided: true,
    isDoubleColor: true,
    unitPrice: null,
    fixedFee: null,
    suggestedSubtotal: null,
    priceOverrideReason: null,
    remark: null,
    ...overrides,
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    customerRef: '测试客户',
    receiverName: '张三',
    receiverPhone: '13800000000',
    receiverAddress: '广东省佛山市测试路 1 号',
    expressCode: null,
    packageRequirement: null,
    remark: null,
    promisedDate: null,
    isUrgent: false,
    isSfCollect: false,
    additionalShipments: [],
    packagingGroups: [],
    items: [item()],
    ...overrides,
  };
}

describe('new-order pricing route schema', () => {
  it('allows three front-side custom colors and leaves their price to admin final pricing', () => {
    const result = createOrderSchema.safeParse(
      order({
        items: [
          item({
            frontFoilColors: ['哑金', '红金', '银'],
            backFoilColors: [],
            foilColors: ['哑金', '红金', '银'],
            isDoubleSided: false,
          }),
        ],
      }),
    );

    expect(result.success).toBe(true);
  });

  it('rejects a back-side custom foil fact', () => {
    const result = createOrderSchema.safeParse(
      order({
        items: [
          item({
            frontFoilColors: ['哑金'],
            backFoilColors: ['哑金'],
          }),
        ],
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        '专版烫金不支持反面烫金，请转管理员核价',
      );
    }
  });

  it('rejects MANUAL_QUOTE at both new-order command boundaries', () => {
    const manual = item({
      pricingRoute: 'MANUAL_QUOTE',
      manualQuoteReason: '非标需人工',
    });
    const created = createOrderSchema.safeParse(order({ items: [manual] }));
    const previewed = quoteOrderItemsSchema.safeParse({ items: [manual] });

    expect(created.success).toBe(false);
    expect(previewed.success).toBe(false);
    for (const result of [created, previewed]) {
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: expect.arrayContaining(['pricingRoute']),
              message: expect.stringContaining('三条计价路线'),
            }),
          ]),
        );
      }
    }
  });

  it('requires stock local foil facts without turning them into a fourth route', () => {
    const invalid = createOrderSchema.safeParse(
      order({
        items: [
          item({
            pricingRoute: 'STOCK_BLANK',
            hasLocalFoil: false,
            foilTechnique: 'NONE',
            foilColors: [],
          }),
        ],
      }),
    );

    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('局部烫金'),
          expect.stringContaining('烫金方式'),
          expect.stringContaining('烫金颜色'),
        ]),
      );
    }
  });

  it('allows pure color print with no foil technique', () => {
    const result = createOrderSchema.safeParse(
      order({
        items: [
          item({
            pricingRoute: 'COLOR_PRINT',
            foilColors: [],
            foilTechnique: 'NONE',
            hasLocalFoil: false,
            printColors: ['C', 'M', 'Y', 'K'],
          }),
        ],
      }),
    );

    expect(result.success).toBe(true);
  });

  it('defaults omitted legacy lamination facts to no lamination', () => {
    const legacyItem = item({
      frontFoilColors: ['哑金'],
      backFoilColors: [],
      foilColors: ['哑金'],
      isDoubleSided: false,
      isDoubleColor: false,
      lamination: undefined,
    });
    const created = createOrderSchema.parse(order({ items: [legacyItem] }));
    const previewed = quoteOrderItemsSchema.parse({ items: [legacyItem] });

    expect(created.items[0]?.lamination).toBe('NONE');
    expect(previewed.items[0]?.lamination).toBe('NONE');
  });

  it('rejects lamination on non-color routes at both command boundaries', () => {
    const laminatedFoilItem = item({ lamination: 'MATTE' });
    const created = createOrderSchema.safeParse(
      order({ items: [laminatedFoilItem] }),
    );
    const previewed = quoteOrderItemsSchema.safeParse({
      items: [laminatedFoilItem],
    });

    for (const result of [created, previewed]) {
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: expect.arrayContaining(['lamination']),
              message: '非彩印款式的覆膜方式必须为“无覆膜”',
            }),
          ]),
        );
      }
    }
  });

  it('accepts matte lamination as a structured color-print fact', () => {
    const colorItem = item({
      pricingRoute: 'COLOR_PRINT',
      paperType: '200g铜版纸',
      paperWeightGsm: 200,
      foilColors: [],
      foilTechnique: 'NONE',
      hasLocalFoil: false,
      lamination: 'MATTE',
      printColors: ['C', 'M', 'Y', 'K'],
    });
    const created = createOrderSchema.safeParse(order({ items: [colorItem] }));
    const previewed = quoteOrderItemsSchema.safeParse({ items: [colorItem] });

    expect(created.success).toBe(true);
    expect(previewed.success).toBe(true);
  });

  it('rejects contradictory pure-color facts without foil colors', () => {
    const result = createOrderSchema.safeParse(
      order({
        items: [
          item({
            pricingRoute: 'COLOR_PRINT',
            foilColors: [],
            foilTechnique: 'FLAT',
            hasLocalFoil: true,
            printColors: ['C', 'M', 'Y', 'K'],
          }),
        ],
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('无烫金'),
          expect.stringContaining('不能标记局部烫金'),
        ]),
      );
    }
  });

  it('requires an explicit foil technique when color print includes foil colors', () => {
    const result = createOrderSchema.safeParse(
      order({
        items: [
          item({
            pricingRoute: 'COLOR_PRINT',
            foilColors: ['哑金'],
            foilTechnique: 'NONE',
            hasLocalFoil: false,
            printColors: ['C', 'M', 'Y', 'K'],
          }),
        ],
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: expect.arrayContaining(['foilTechnique']),
            message: expect.stringContaining('彩印加烫金'),
          }),
        ]),
      );
    }
  });
});
