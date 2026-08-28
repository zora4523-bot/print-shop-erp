import { describe, expect, it } from 'vitest';
import { createExternalOrderQuoteToken } from '../create-order-quote-token';

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        productId: 'product-1',
        quantity: 2_000,
        paperType: '160g触感纸',
        frontFoilColors: ['哑金'],
      },
    ],
    packagingGroups: [
      {
        groupKey: 'browser-group',
        mode: 'SINGLE_STYLE',
        actualBagCount: 20,
      },
    ],
    logistics: {
      isSfCollect: false,
      shipments: [
        {
          shipmentKey: 'browser-shipment',
          province: '上海',
          billableWeightKg: null,
          itemQuantity: 2_000,
          weightItems: [
            {
              itemKey: 'browser-item',
              quantity: 2_000,
              paperWeightGsm: 160,
            },
          ],
        },
      ],
    },
    priceVersion: {
      processing: { id: 'processing-v7', version: 7 },
      logistics: { id: 'logistics-v3', version: 3 },
    },
    result: {
      items: [
        {
          complete: true,
          suggestedSubtotal: '500.00',
          snapshot: { quotedAt: '2026-08-28T00:00:00.000Z' },
        },
      ],
      packaging: {
        groups: [
          {
            groupKey: 'browser-group',
            complete: true,
            suggestedSubtotal: '25.00',
          },
        ],
      },
      logistics: {
        complete: true,
        suggestedTotal: '41.30',
        components: [
          {
            shipmentKey: 'browser-shipment',
            code: 'SHIPPING_FEE',
            amount: '41.30',
          },
        ],
      },
    },
    ...overrides,
  };
}

describe('createExternalOrderQuoteToken', () => {
  it('忽略预览临时 key、落库 id 和报价时间', () => {
    const preview = createExternalOrderQuoteToken(evidence());
    const persisted = createExternalOrderQuoteToken({
      ...evidence(),
      packagingGroups: [
        {
          groupKey: 'database-group-id',
          mode: 'SINGLE_STYLE',
          actualBagCount: 20,
        },
      ],
      logistics: {
        isSfCollect: false,
        shipments: [
          {
            shipmentKey: 'database-shipment-id',
            province: '上海',
            billableWeightKg: null,
            itemQuantity: 2_000,
            weightItems: [
              {
                itemKey: 'database-item-id',
                quantity: 2_000,
                paperWeightGsm: 160,
              },
            ],
          },
        ],
      },
      result: {
        ...evidence().result,
        items: [
          {
            complete: true,
            suggestedSubtotal: '500.00',
            snapshot: { quotedAt: '2026-08-28T01:00:00.000Z' },
          },
        ],
        packaging: {
          groups: [
            {
              groupKey: 'database-group-id',
              complete: true,
              suggestedSubtotal: '25.00',
            },
          ],
        },
        logistics: {
          complete: true,
          suggestedTotal: '41.30',
          components: [
            {
              shipmentKey: 'database-shipment-id',
              code: 'SHIPPING_FEE',
              amount: '41.30',
            },
          ],
        },
      },
    });

    expect(preview).toMatch(/^create-order-quote-v2:[a-f\d]{64}$/u);
    expect(persisted).toBe(preview);
  });

  it('任一业务事实、价目版本或计算结果变化都会换 token', () => {
    const baseline = createExternalOrderQuoteToken(evidence());
    const quantityChanged = createExternalOrderQuoteToken({
      ...evidence(),
      items: [{ ...evidence().items[0], quantity: 2_001 }],
    });
    const versionChanged = createExternalOrderQuoteToken({
      ...evidence(),
      priceVersion: {
        processing: { id: 'processing-v8', version: 8 },
        logistics: { id: 'logistics-v3', version: 3 },
      },
    });
    const amountChanged = createExternalOrderQuoteToken({
      ...evidence(),
      result: {
        ...evidence().result,
        logistics: {
          ...evidence().result.logistics,
          suggestedTotal: '42.30',
        },
      },
    });

    expect(quantityChanged).not.toBe(baseline);
    expect(versionChanged).not.toBe(baseline);
    expect(amountChanged).not.toBe(baseline);
  });
});
