import { describe, expect, it } from 'vitest';
import {
  OrderItemPricingRoute,
  OrderProductStructure,
} from '@/generated/prisma/enums';
import {
  listOrderChangeSpecificationOptions,
  OrderChangeCatalogIdentityError,
  resolveOrderChangeCatalogIdentity,
  type OrderChangeCatalogProduct,
} from '../change-request-catalog-identity';

const sourceItem = {
  pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
  paperType: '160g珠光艳闪',
  paperWeightGsm: 160,
};

function product(
  overrides: Partial<OrderChangeCatalogProduct> &
    Pick<OrderChangeCatalogProduct, 'id' | 'specification'>,
): OrderChangeCatalogProduct {
  return {
    category: 'BLANK_STOCK',
    paperType: '160g珠光艳闪',
    weight: null,
    isActive: true,
    paperMaterialId: null,
    linkedPaper: null,
    ...overrides,
  };
}

const products: OrderChangeCatalogProduct[] = [
  product({ id: 'product-large', specification: '大号封90×165' }),
  product({ id: 'product-mid', specification: '中号封80×115' }),
  product({ id: 'product-west', specification: '西封大号85×165' }),
];

describe('order-change catalog identity', () => {
  it('从目标产品规格派生完整计价身份', () => {
    expect(
      resolveOrderChangeCatalogIdentity({
        sourceItem,
        targetProductId: 'product-mid',
        targetSpecification: '中号封 80x115',
        products,
      }),
    ).toEqual({
      productId: 'product-mid',
      specification: '中号封80×115',
      canonicalSpecification: '中号封',
      productStructure: OrderProductStructure.STANDARD_ENVELOPE,
      actualWidthMm: 80,
      actualHeightMm: 115,
      pricingGroup: 'MID',
    });
    expect(
      resolveOrderChangeCatalogIdentity({
        sourceItem,
        targetProductId: 'product-west',
        targetSpecification: '西封大号85×165',
        products,
      }),
    ).toMatchObject({
      productStructure: OrderProductStructure.WESTERN_ENVELOPE,
      pricingGroup: 'LARGE',
      actualWidthMm: 85,
      actualHeightMm: 165,
    });
    const moneyProduct = product({
      id: 'product-money',
      specification: '万元封90×165',
    });
    expect(
      resolveOrderChangeCatalogIdentity({
        sourceItem,
        targetProductId: moneyProduct.id,
        targetSpecification: '万元封90×165',
        products: [moneyProduct],
      }),
    ).toMatchObject({
      productStructure: OrderProductStructure.TEN_THOUSAND_ENVELOPE,
      pricingGroup: 'MID',
    });
  });

  it('只列出同计价路线、同纸张与克重的活动产品', () => {
    const options = listOrderChangeSpecificationOptions({
      sourceItem,
      products: [
        ...products,
        product({
          id: 'inactive-square',
          specification: '方形封88×88',
          isActive: false,
        }),
        product({
          id: 'wrong-paper',
          specification: '迷你封50×80',
          paperType: '180g珠光艳闪',
        }),
        product({
          id: 'wrong-route',
          specification: '万元封90×165',
          category: 'CUSTOM_FLAT_FOIL',
          paperType: null,
        }),
      ],
    });

    expect(options.map((option) => option.productId)).toEqual(
      expect.arrayContaining([
        'product-large',
        'product-mid',
        'product-west',
      ]),
    );
    expect(options).toHaveLength(3);
    expect(options.every((option) => option.selectionKey.length > 0)).toBe(
      true,
    );
  });

  it('允许专版路线的通用规格产品继续使用原纸张', () => {
    const customProduct = product({
      id: 'custom-mid',
      category: 'CUSTOM_FLAT_FOIL',
      specification: '中号封80×115',
      paperType: null,
    });
    expect(
      resolveOrderChangeCatalogIdentity({
        sourceItem: {
          ...sourceItem,
          pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
        },
        targetProductId: customProduct.id,
        targetSpecification: '中号封80×115',
        products: [customProduct],
      }),
    ).toMatchObject({ productId: 'custom-mid', pricingGroup: 'MID' });
  });

  it.each([
    {
      label: '已停用产品',
      product: product({
        id: 'inactive',
        specification: '中号封80×115',
        isActive: false,
      }),
      code: 'TARGET_PRODUCT_NOT_ACTIVE',
    },
    {
      label: '纸张克重不匹配',
      product: product({
        id: 'wrong-weight',
        specification: '中号封80×115',
        paperType: '珠光艳闪',
        weight: 180,
      }),
      code: 'TARGET_PAPER_MISMATCH',
    },
    {
      label: '规格不属于产品',
      product: product({
        id: 'large-only',
        specification: '大号封90×165',
      }),
      code: 'SPECIFICATION_NOT_IN_PRODUCT',
    },
  ])('$label 时失败关闭', ({ product: target, code }) => {
    let error: unknown;
    try {
      resolveOrderChangeCatalogIdentity({
        sourceItem,
        targetProductId: target.id,
        targetSpecification: '中号封80×115',
        products: [target],
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(OrderChangeCatalogIdentityError);
    expect((error as OrderChangeCatalogIdentityError).code).toBe(code);
  });

  it('同一规格存在多个兼容产品时不为浏览器任选一个', () => {
    const duplicate = product({
      id: 'product-mid-copy',
      specification: '中号封80×115',
    });
    const options = listOrderChangeSpecificationOptions({
      sourceItem,
      products: [...products, duplicate],
    });

    expect(options.map((option) => option.canonicalSpecification)).not.toContain(
      '中号封',
    );
    expect(() =>
      resolveOrderChangeCatalogIdentity({
        sourceItem,
        targetProductId: 'product-mid',
        targetSpecification: '中号封80×115',
        products: [...products, duplicate],
      }),
    ).toThrow(/多个兼容报价产品/u);
  });

  it.each([
    {
      label: '关联纸张不存在',
      linkedPaper: null,
      error: /关联的纸张不存在/u,
    },
    {
      label: '关联纸张已停用',
      linkedPaper: { isActive: false, outOfStock: false },
      error: /已停用或缺货/u,
    },
    {
      label: '关联纸张已缺货',
      linkedPaper: { isActive: true, outOfStock: true },
      error: /已停用或缺货/u,
    },
  ])('$label 时目标规格失败关闭', ({ linkedPaper, error }) => {
    const target = product({
      id: 'linked-paper-product',
      specification: '中号封80×115',
      paperMaterialId: 'paper-1',
      linkedPaper,
    });

    expect(() =>
      resolveOrderChangeCatalogIdentity({
        sourceItem,
        targetProductId: target.id,
        targetSpecification: '中号封80×115',
        products: [target],
      }),
    ).toThrow(error);
  });

  it('关联纸张不可用的重复产品不会阻塞可用规格', () => {
    const available = product({
      id: 'available-product',
      specification: '中号封80×115',
    });
    const unavailable = product({
      id: 'unavailable-product',
      specification: '中号封80×115',
      paperMaterialId: 'paper-unavailable',
      linkedPaper: { isActive: true, outOfStock: true },
    });

    expect(
      listOrderChangeSpecificationOptions({
        sourceItem,
        products: [available, unavailable],
      }),
    ).toMatchObject([{ productId: 'available-product' }]);
  });
});
