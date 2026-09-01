import { describe, expect, it } from 'vitest';

import type { CreateOrderQuoteInput } from '../../price/create-order/types';
import { buildCreateOrderExternalChargeInput } from '../create-order-charge-input';

type QuoteItem = CreateOrderQuoteInput['items'][number];

function quoteItem(
  itemKey: string,
  overrides: Partial<QuoteItem> = {},
): QuoteItem {
  return {
    itemKey,
    fig: 1,
    craft: 'PARTIAL',
    paperType: '160g珠光纸',
    paperWeightGsm: 160,
    specification: '大号封',
    pricingGroup: 'LARGE',
    productStructure: 'STANDARD_ENVELOPE',
    quantity: 100,
    frontColors: ['哑金'],
    backColors: [],
    configuration: {
      paper: 'CATALOG',
      paperWeight: 'CATALOG',
      specification: 'CATALOG',
      craft: 'CATALOG',
    },
    ...overrides,
  };
}

describe('buildCreateOrderExternalChargeInput', () => {
  it('保留未知键、零数量、多地址与可信计费重量的现有映射语义', () => {
    const input: CreateOrderQuoteInput = {
      items: [
        quoteItem('item-a'),
        quoteItem('item-b', {
          fig: 2,
          paperType: '白卡纸',
          paperWeightGsm: null,
          productStructure: 'WESTERN_ENVELOPE',
          quantity: 25,
        }),
      ],
      packagingGroups: [],
      isSfCollect: false,
      shipments: [
        {
          shipmentKey: 'address-1',
          province: '广东',
          trustedBillableWeightKg: '12.500',
          itemQuantities: {
            'item-a': 100,
            'item-b': 0,
            'unknown-item': 7,
          },
        },
        {
          shipmentKey: 'address-2',
          province: '江西',
          trustedBillableWeightKg: null,
          itemQuantities: {
            'item-a': 0,
            'item-b': 25,
            'unknown-item': 0,
          },
        },
      ],
    };

    expect(buildCreateOrderExternalChargeInput(input)).toEqual({
      isSfCollect: false,
      shipments: [
        {
          shipmentKey: 'address-1',
          province: '广东',
          billableWeightKg: '12.500',
          // 未知正数键仍计入整票数量，但没有款式事实可供估重。
          itemQuantity: 107,
          weightItems: [
            {
              itemKey: 'item-a',
              quantity: 100,
              paperWeightGsm: 160,
              paperType: '160g珠光纸',
              productStructure: 'STANDARD_ENVELOPE',
            },
          ],
        },
        {
          shipmentKey: 'address-2',
          province: '江西',
          billableWeightKg: null,
          itemQuantity: 25,
          weightItems: [
            {
              itemKey: 'item-b',
              quantity: 25,
              paperWeightGsm: null,
              paperType: '白卡纸',
              productStructure: 'WESTERN_ENVELOPE',
            },
          ],
        },
      ],
    });
  });
});
