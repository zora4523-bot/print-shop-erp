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
        paperType: '触感纸',
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
            paperType: '触感纸',
            quantity: 1000,
            crafts: [],
            quoteStatus: 'complete',
          },
          {
            name: '腰封',
            productId: 'product-2',
            paperType: '触感纸',
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
            paperType: '触感纸',
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

  it('keeps external-sales logistics fact gaps without requiring charge amounts', () => {
    const gaps = collectOrderFormGaps(
      input({
        shipping: {
          usesExternalSalesPricing: true,
          isSfCollect: false,
          shipments: [
            {
              key: 'primary',
              label: '主地址',
              idPrefix: 'primary',
              receiverFieldId: 'receiverAddress',
              receiverAddress: '',
              province: '',
              billableWeightKg: null,
            },
          ],
        },
      }),
    );

    expect(gaps.map((gap) => gap.fieldId)).toEqual([
      'receiverAddress',
      'primary-province',
      'primary-weight',
    ]);
  });

  it('does not ask external sales for hidden manual price or charge fields', () => {
    const gaps = collectOrderFormGaps(
      input({
        items: [
          {
            name: '外盒',
            productId: 'product-1',
            paperType: '触感纸',
            quantity: 8000,
            crafts: ['foil'],
            quoteStatus: 'incomplete',
            manualPriceProvided: false,
            priceOverrideRequired: true,
            priceOverrideReason: '',
          },
        ],
        shipping: {
          usesExternalSalesPricing: true,
          isSfCollect: false,
          shipments: [
            {
              key: 'primary',
              label: '主地址',
              idPrefix: 'primary',
              receiverFieldId: 'receiverAddress',
              receiverAddress: '张三 13800000000 上海市',
              province: '上海',
              billableWeightKg: '12',
            },
          ],
        },
      }),
    );

    expect(gaps).toEqual([]);
  });
});
