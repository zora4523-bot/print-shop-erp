import { describe, expect, it } from 'vitest';
import {
  OrderItemPricingRoute,
  ProductCategory,
} from '@/generated/prisma/enums';
import {
  buildExternalOrderPapers,
  externalOrderDefaultSpecification,
  externalOrderSpecificationsForRoute,
  externalOrderWeightOptionsForSelection,
  externalOrderWeightsForSelection,
  findExternalOrderCatalogProduct,
} from '../external-order-b-catalog';

describe('external order B catalog', () => {
  const products = [
    {
      id: 'mini-120',
      code: 'EXT-STOCK-MINI-120',
      category: ProductCategory.BLANK_STOCK,
      specification: '迷你封50×80',
      paperType: '120g珠光艳闪',
    },
    {
      id: 'large-160',
      code: 'EXT-STOCK-LARGE-160',
      category: ProductCategory.BLANK_STOCK,
      specification: '大号封90×165',
      paperType: '160g珠光艳闪',
    },
    {
      id: 'custom-large-160',
      code: 'EXT-CUSTOM-LARGE-160',
      category: ProductCategory.CUSTOM_FLAT_FOIL,
      specification: '大号封90×165',
      paperType: '160g珠光艳闪',
    },
  ];

  it('displays pearl dark red while retaining the existing catalog and price identity', () => {
    const product = { ...products[1], paperType: '160g珠光闪红' };
    const [paper] = buildExternalOrderPapers([product]);
    expect(paper.label).toBe('珠光暗红');
    expect(paper.key).toBe('珠光闪红');
    expect(paper.paperTypeByWeight[160]).toBe('160g珠光闪红');
    expect(paper.variants[0].paperType).toBe(product.paperType);
    expect(externalOrderWeightOptionsForSelection(paper, OrderItemPricingRoute.STOCK_BLANK, product.specification)).toEqual([{ value: 160, disabled: false }]);
  });

  it('excludes retired 120g while preserving other configured weights', () => {
    const pearlFlash = buildExternalOrderPapers(products).find(
      (paper) => paper.label === '珠光艳闪',
    );
    expect(pearlFlash).toBeDefined();

    expect(
      externalOrderWeightsForSelection(
        pearlFlash!,
        OrderItemPricingRoute.STOCK_BLANK,
        '迷你封50×80',
      ),
    ).toEqual([]);
    expect(
      externalOrderWeightsForSelection(
        pearlFlash!,
        OrderItemPricingRoute.STOCK_BLANK,
        '大号封90×165',
      ),
    ).toEqual([160]);
    expect(
      externalOrderWeightsForSelection(
        pearlFlash!,
        OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
        '大号封90×165',
      ),
    ).toEqual([160]);
  });

  it('keeps malformed legacy specifications out of every browser choice', () => {
    const malformedAndValid = [
      {
        id: 'legacy-mixed-spec',
        code: 'PRD-000002',
        category: ProductCategory.BLANK_STOCK,
        specification: '100×200,中号 / 中号封80×115',
        paperType: '160g珠光纸',
        weight: 160,
      },
    ];

    const papers = buildExternalOrderPapers(malformedAndValid);
    expect(papers.flatMap((paper) => paper.variants)).toEqual([
      expect.objectContaining({ specification: '中号封80×115' }),
    ]);
    expect(
      externalOrderSpecificationsForRoute(
        malformedAndValid,
        OrderItemPricingRoute.STOCK_BLANK,
      ),
    ).toEqual(['中号封80×115']);
    expect(
      externalOrderDefaultSpecification(
        malformedAndValid,
        OrderItemPricingRoute.STOCK_BLANK,
      ),
    ).toBe('中号封80×115');
  });

  it('disables only the exact weights whose configured materials are all out of stock', () => {
    const customProduct = {
      id: 'custom-large',
      code: 'EXT-CUSTOM-LARGE',
      category: ProductCategory.CUSTOM_FLAT_FOIL,
      specification: '大号封90×165',
      paperType: null,
      weight: null,
    };
    const paper = buildExternalOrderPapers([customProduct], [
      {
        id: 'paper-pearl-160',
        name: '160g珠光艳闪',
        weight: 160,
        outOfStock: true,
      },
      {
        id: 'paper-pearl-180',
        name: '180g珠光艳闪',
        weight: 180,
        outOfStock: false,
      },
    ]).find((candidate) => candidate.label === '珠光艳闪');

    expect(paper).toBeDefined();
    expect(
      externalOrderWeightOptionsForSelection(
        paper!,
        OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
        '大号封90×165',
      ),
    ).toEqual([
      { value: 160, disabled: true },
      { value: 180, disabled: false },
    ]);
  });

  it('disables a product whose linked paper is absent from the active material catalog', () => {
    const paper = buildExternalOrderPapers(
      [
        {
          id: 'stock-with-inactive-paper',
          category: ProductCategory.BLANK_STOCK,
          specification: '大号封90×165',
          paperType: '160g珠光艳闪',
          paperMaterialId: 'inactive-paper-160',
          weight: 160,
        },
      ],
      [],
    )[0];

    expect(
      externalOrderWeightOptionsForSelection(
        paper!,
        OrderItemPricingRoute.STOCK_BLANK,
        '大号封90×165',
      ),
    ).toEqual([{ value: 160, disabled: true }]);
  });

  it('fails closed instead of substituting another product', () => {
    expect(
      findExternalOrderCatalogProduct(
        products,
        OrderItemPricingRoute.STOCK_BLANK,
        '160g珠光艳闪',
        '中号封80×115',
      ),
    ).toBeNull();
  });

  it('resolves each configured choice from a multi-specification product', () => {
    const aliased = {
      id: 'multi-spec-stock',
      code: 'EXT-STOCK-MULTI',
      category: ProductCategory.BLANK_STOCK,
      specification: '西封中号80×120 / 西封大号85×165',
      paperType: '160g珠光艳闪',
    };

    for (const specification of ['西封中号80×120', '西封大号85×165']) {
      expect(
        findExternalOrderCatalogProduct(
          [aliased],
          OrderItemPricingRoute.STOCK_BLANK,
          '160g珠光艳闪',
          specification,
        ),
      ).toEqual(aliased);
    }
  });

  it('uses one paper-agnostic CUSTOM product as the configured size owner', () => {
    const exact = products[2]!;
    expect(
      findExternalOrderCatalogProduct(
        [
          {
            ...exact,
            id: 'missing-paper',
            code: 'PRD-MISSING-PAPER',
            paperType: null,
          },
        ],
        OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
        '160g珠光艳闪',
        '大号封90×165',
      ),
    ).toEqual(expect.objectContaining({ id: 'missing-paper' }));

    expect(
      findExternalOrderCatalogProduct(
        [
          {
            ...exact,
            id: 'missing-paper',
            code: 'PRD-MISSING-PAPER',
            paperType: null,
          },
          exact,
        ],
        OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
        '160g珠光艳闪',
        '大号封90×165',
      ),
    ).toEqual(exact);

    expect(
      findExternalOrderCatalogProduct(
        [
          {
            ...exact,
            id: 'missing-paper',
            code: 'PRD-MISSING-PAPER',
            category: ProductCategory.BLANK_STOCK,
            paperType: null,
          },
        ],
        OrderItemPricingRoute.STOCK_BLANK,
        '160g珠光艳闪',
        '大号封90×165',
      ),
    ).toBeNull();
  });

  it('derives CUSTOM paper choices from configured PAPER materials without inventing prices', () => {
    const genericCustomProducts = [
      {
        id: 'custom-large',
        code: 'EXT-CUSTOM-LARGE',
        category: ProductCategory.CUSTOM_FLAT_FOIL,
        specification: '大号封90×165',
        paperType: null,
        weight: null,
      },
      {
        id: 'legacy-malformed',
        code: 'PRD-000002',
        category: ProductCategory.CUSTOM_FLAT_FOIL,
        specification: '100×200,中号',
        paperType: '珠光纸',
        weight: null,
      },
    ];
    const papers = buildExternalOrderPapers(genericCustomProducts, [
      {
        id: 'paper-pearl-160',
        name: '160g珠光艳闪',
        specification: null,
        weight: 160,
      },
      {
        id: 'paper-unresolved',
        name: '未配置克重的纸',
        specification: null,
        weight: null,
      },
    ]);
    const customPaper = papers.find((paper) => paper.label === '珠光艳闪');

    expect(customPaper).toBeDefined();
    expect(customPaper?.variants).toEqual([
      expect.objectContaining({
        route: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
        specification: '大号封90×165',
        paperType: '160g珠光艳闪',
        weight: 160,
        paperMaterialId: 'paper-pearl-160',
        outOfStock: false,
      }),
    ]);
    expect(
      papers
        .flatMap((paper) => paper.variants)
        .some((variant) => variant.specification === '100×200,中号'),
    ).toBe(false);
    expect(papers.some((paper) => paper.label === '未配置克重的纸')).toBe(false);
  });

  it('fails closed when two product ids have the same pricing facts', () => {
    const duplicate = products[2]!;
    expect(
      findExternalOrderCatalogProduct(
        [
          duplicate,
          { ...duplicate, id: 'duplicate-product', code: 'PRD-DUPLICATE' },
        ],
        OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
        '160g珠光艳闪',
        '大号封90×165',
      ),
    ).toBeNull();
  });

  it('accepts a price-book product without an EXT- code convention', () => {
    const pricedProducts = [
      {
        id: 'price-book-product',
        code: 'PRD-000042',
        category: ProductCategory.COLOR_PRINT,
        specification: '大号封90×165',
        paperType: '200g铜版纸',
      },
    ];

    expect(buildExternalOrderPapers(pricedProducts)).toEqual([
      expect.objectContaining({ label: '铜版纸' }),
    ]);
    expect(
      findExternalOrderCatalogProduct(
        pricedProducts,
        OrderItemPricingRoute.COLOR_PRINT,
        '200g铜版纸',
        '大号封90×165',
      ),
    ).toEqual(pricedProducts[0]);
  });
});
