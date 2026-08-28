import { describe, expect, it, vi } from 'vitest';
import {
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderProductStructure,
} from '../../../generated/prisma/enums';
import {
  buildCreateOrderQuoteInputFromCatalog,
  CreateOrderQuoteFactsAdapterError,
  type CreateOrderQuoteFactsReadClient,
  type LegacyCreateOrderQuoteItemFacts,
} from '../create-order-quote-facts-adapter';

function manualItem(
  manualQuoteReason: string,
): LegacyCreateOrderQuoteItemFacts {
  return {
    itemKey: 'manual-1',
    fig: 1,
    productId: null,
    pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
    productStructure: OrderProductStructure.UNSPECIFIED,
    pricingGroup: null,
    specification: null,
    actualWidthMm: null,
    actualHeightMm: null,
    paperType: null,
    paperWeightGsm: null,
    quantity: 500,
    crafts: [],
    foilColors: [],
    frontFoilColors: [],
    backFoilColors: [],
    foilTechnique: OrderFoilTechnique.UNSPECIFIED,
    hasLocalFoil: null,
    lamination: OrderLamination.NONE,
    manualQuoteReason,
  };
}

function client() {
  return {
    product: { findMany: vi.fn() },
    craft: { findMany: vi.fn() },
    material: { findMany: vi.fn(async () => []) },
  } as unknown as CreateOrderQuoteFactsReadClient;
}

describe('internal configuration-outside catalog adapter', () => {
  it('preserves the note without inventing a product, paper, or craft lookup', async () => {
    const db = client();
    const result = await buildCreateOrderQuoteInputFromCatalog(db, {
      items: [manualItem('客供纸，特殊工艺')],
      packagingGroups: [
        {
          groupKey: 'bag-1',
          mode: 'SINGLE_STYLE',
          items: [{ itemKey: 'manual-1', unitsPerBag: 10 }],
        },
      ],
      isSfCollect: false,
      shipments: [
        {
          shipmentKey: 'internal',
          province: null,
          itemQuantities: { 'manual-1': 500 },
        },
      ],
    });

    expect(result.items[0]).toMatchObject({
      itemKey: 'manual-1',
      manualPricingReason: '客供纸，特殊工艺',
      paperType: '配置外纸张',
      paperWeightGsm: null,
      specification: '配置外规格',
      configuration: {
        paper: 'CUSTOM',
        paperWeight: 'MANUAL',
        specification: 'RESIZED',
        craft: 'CUSTOM',
      },
    });
    expect(db.product.findMany).not.toHaveBeenCalled();
    expect(db.craft.findMany).not.toHaveBeenCalled();
    expect(db.material.findMany).not.toHaveBeenCalled();
  });

  it('rejects a present but whitespace-only note', async () => {
    await expect(
      buildCreateOrderQuoteInputFromCatalog(client(), {
        items: [manualItem('   ')],
        packagingGroups: [],
        isSfCollect: false,
        shipments: [],
      }),
    ).rejects.toMatchObject({
      name: 'CreateOrderQuoteFactsAdapterError',
      code: 'INVALID_ITEM_FACTS',
      message: expect.stringContaining('配置外项目说明不能为空'),
    } satisfies Partial<CreateOrderQuoteFactsAdapterError>);
  });
});
