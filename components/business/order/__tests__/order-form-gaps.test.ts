import { describe, expect, it } from 'vitest';
import {
  collectOrderFormGaps,
  type OrderFormGapInput,
} from '../order-form-gaps';

function input(overrides: Partial<OrderFormGapInput> = {}): OrderFormGapInput {
  return {
    customerRef: '星河礼品',
    promisedDate: '2026-09-01',
    items: [
      {
        name: '外盒',
        productId: 'product-1',
        quantity: 8000,
        crafts: ['foil'],
        quoteStatus: 'complete',
        manualPriceProvided: true,
        priceOverrideReason: null,
        priceOverrideRequired: false,
      },
    ],
    shipping: {
      usesExternalSalesPricing: false,
      isSfCollect: false,
      quoteStatus: 'missing',
      shipments: [
        {
          key: 'primary',
          label: '主地址',
          idPrefix: 'primary',
          receiverFieldId: 'receiverAddress',
          receiverAddress: '张三 13800000000 上海市',
        },
      ],
    },
    ...overrides,
  };
}

describe('collectOrderFormGaps', () => {
  it('lists name, quantity and craft gaps per item', () => {
    const gaps = collectOrderFormGaps(
      input({
        items: [
          {
            name: '',
            productId: 'product-1',
            quantity: 1000,
            crafts: [],
            quoteStatus: 'complete',
          },
          {
            name: '腰封',
            productId: 'product-2',
            quantity: 0,
            crafts: ['foil'],
            quoteStatus: 'complete',
          },
        ],
      }),
    );
    expect(gaps.map((gap) => gap.label)).toEqual([
      '款式 #1 未填名称',
      '款式 #1 未选工艺',
      '款式 #2 数量无效',
    ]);
    expect(gaps[0]?.fieldId).toBe('items.0.name');
  });

  it('returns nothing for a complete item', () => {
    expect(collectOrderFormGaps(input())).toEqual([]);
  });

  it('covers customer, deadline, product, quote and manual override reason', () => {
    const gaps = collectOrderFormGaps(
      input({
        customerRef: '',
        promisedDate: null,
        items: [
          {
            name: '外盒',
            productId: null,
            quantity: 8000,
            crafts: ['foil'],
            quoteStatus: 'stale',
            manualPriceProvided: true,
            priceOverrideRequired: true,
            priceOverrideReason: '',
          },
        ],
      }),
    );

    expect(gaps.map((gap) => gap.id)).toEqual([
      'customer-ref',
      'promised-date',
      'item-0-product',
      'item-0-quote',
      'item-0-price-reason',
    ]);
  });

  it('covers external-sales logistics prerequisites and charge override reason', () => {
    const gaps = collectOrderFormGaps(
      input({
        shipping: {
          usesExternalSalesPricing: true,
          isSfCollect: false,
          quoteStatus: 'incomplete',
          shipments: [
            {
              key: 'primary',
              label: '主地址',
              idPrefix: 'primary',
              receiverFieldId: 'receiverAddress',
              receiverAddress: '',
              province: '',
              billableWeightKg: null,
              shippingFee: '20.00',
              packingMaterialFee: null,
              chargeOverrideRequired: true,
              chargeOverrideReason: '',
            },
          ],
        },
      }),
    );

    expect(gaps.map((gap) => gap.fieldId)).toEqual([
      'receiverAddress',
      'primary-province',
      'primary-weight',
      'primary-packing-fee',
      'primary-charge-reason',
      'logistics-quote',
    ]);
  });
});
