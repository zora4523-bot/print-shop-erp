import { describe, expect, it } from 'vitest';
import {
  OrderItemPricingRoute,
  ProductCategory,
} from '@/generated/prisma/enums';
import {
  buildExternalOrderPapers,
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

  it('derives the available weight from exact active product facts', () => {
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
    ).toEqual([120]);
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

  it('does not treat a missing product paper as a wildcard', () => {
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
          exact,
        ],
        OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
        '160g珠光艳闪',
        '大号封90×165',
      ),
    ).toEqual(exact);
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
