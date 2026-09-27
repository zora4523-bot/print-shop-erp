import { describe, expect, it } from 'vitest';
import {
  collectOrderFormGaps,
  type OrderFormGapInput,
} from '../order-form-gaps';

function input(overrides: Partial<OrderFormGapInput> = {}): OrderFormGapInput {
  return {
    promisedDate: '2026-09-01',
    items: [
      {
        name: '外盒',
        productId: 'product-1',
        paperType: '触感纸',
        quantity: 8000,
        crafts: ['foil'],
        quoteStatus: 'complete',
        manualQuoteReason: null,
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
          province: '上海',
          billableWeightKg: 'automatic',
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
      '款式 #1 未匹配工艺配置，请填写配置外说明',
      '款式 #2 数量无效',
    ]);
    expect(gaps[0]?.fieldId).toBe('items.0.name');
  });

  it('returns nothing for a complete item', () => {
    expect(collectOrderFormGaps(input())).toEqual([]);
  });

  it('allows a fully quoted blank paper/specification without a legacy product', () => {
    const base = input();
    expect(collectOrderFormGaps(input({ items: [{
      ...base.items[0], productId: null, pricingRoute: 'STOCK_BLANK',
      specification: '大号封90×165',
    }] }))).toEqual([]);
  });

  it.each(['missing', 'error', 'incomplete', 'stale'] as const)(
    'still blocks a blank item whose quote is %s', (quoteStatus) => {
      const base = input();
      const gaps = collectOrderFormGaps(input({ items: [{
        ...base.items[0], productId: null, pricingRoute: 'STOCK_BLANK',
        specification: '大号封90×165', quoteStatus,
      }] }));
      expect(gaps.map((gap) => gap.id)).toEqual(['item-0-quote']);
    },
  );

  it('keeps missing specification and nonblank catalog admission gaps', () => {
    const base = input();
    for (const item of [
      { ...base.items[0], productId: null, pricingRoute: 'STOCK_BLANK' as const },
      { ...base.items[0], productId: null, pricingRoute: 'COLOR_PRINT' as const, specification: '大号封90×165' },
    ]) {
      expect(collectOrderFormGaps(input({ items: [item] })).map((gap) => gap.id))
        .toEqual(['item-0-product']);
    }
  });

  it('points missing catalog/quote facts at the configuration-outside note', () => {
    const gaps = collectOrderFormGaps(
      input({
        promisedDate: null,
        items: [
          {
            name: '外盒',
            productId: null,
            paperType: '触感纸',
            quantity: 8000,
            crafts: ['foil'],
            quoteStatus: 'stale',
            manualQuoteReason: '',
          },
        ],
      }),
    );

    // 客户名称/简称已退役（业主 2026-09-27），不再作为建单缺口。
    expect(gaps.map((gap) => gap.id)).toEqual([
      'promised-date',
      'item-0-product',
      'item-0-quote',
    ]);
    expect(gaps.map((gap) => gap.fieldId)).not.toContain('customerRef');
    expect(gaps.at(-1)?.fieldId).toBe('items.0.manualQuoteReason');
  });

  it('allows an internal configuration-outside note to route missing facts to manual pricing', () => {
    expect(
      collectOrderFormGaps(
        input({
          items: [
            {
              name: '客户来样',
              productId: null,
              paperType: null,
              quantity: 8000,
              crafts: [],
              quoteStatus: 'incomplete',
              manualQuoteReason: '客户来样纸与特殊击凸尚未配置',
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('asks internal orders for the delivery province like external sales', () => {
    const gaps = collectOrderFormGaps(
      input({
        shipping: {
          usesExternalSalesPricing: false,
          isSfCollect: false,
          shipments: [
            {
              key: 'primary',
              label: '主地址',
              idPrefix: 'primary',
              receiverFieldId: 'receiverAddress',
              receiverAddress: '张三 13800000000 测试路 1 号',
              province: '',
              billableWeightKg: 'automatic',
            },
          ],
        },
      }),
    );
    expect(gaps.map((gap) => gap.fieldId)).toEqual(['primary-province']);
    expect(collectOrderFormGaps(input({ shipping: { usesExternalSalesPricing: false, isSfCollect: true, shipments: [{
      key: 'primary', label: '主地址', idPrefix: 'primary', receiverFieldId: 'receiverAddress',
      receiverAddress: '张三 13800000000 测试路 1 号', province: '', billableWeightKg: null,
    }] } }))).toEqual([]);
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
            manualQuoteReason: null,
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
