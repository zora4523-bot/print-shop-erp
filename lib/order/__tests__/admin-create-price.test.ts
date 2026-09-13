import { describe, expect, it } from 'vitest';
import {
  adminCreatePriceFactsKey,
  calculateAdminCreatePrice,
  sumCreateKnownAmounts,
  calculateAdminPackagingPrice,
  adminPackagingPriceFactsKey,
} from '../admin-create-price';
import {
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderPackagingMode,
} from '@/generated/prisma/enums';

describe('administrator agreed style amount', () => {
  it('adds manual style prices and packaging exactly while excluding pending freight', () => {
    expect(sumCreateKnownAmounts(['123.45', '32.20', null, undefined])).toBe(
      '155.65',
    );
  });
  it('keeps an exact cent total independently of the quantity', () => {
    expect(
      calculateAdminCreatePrice({ amount: ' 123.45 ', reason: ' 客户协议价 ' }),
    ).toEqual({
      unitPrice: '0.0000',
      fixedFee: '123.45',
      subtotal: '123.45',
      priceOverrideReason: '客户协议价',
    });
    expect(
      calculateAdminCreatePrice({ amount: '0', reason: '免费样品' }).subtotal,
    ).toBe('0.00');
    expect(
      calculateAdminCreatePrice({ amount: '9999999999.99', reason: '边界价格' })
        .subtotal,
    ).toBe('9999999999.99');
  });
  it.each(['', '-1', 'NaN', 'Infinity', '1e2', '1.001', '10000000000', '.5'])(
    'rejects an invalid amount %s',
    (amount) => {
      expect(() =>
        calculateAdminCreatePrice({ amount, reason: '客户协议价' }),
      ).toThrow('有效价格');
    },
  );
  it.each(['', 'a', 'a'.repeat(201)])('requires a bounded reason', (reason) => {
    expect(() => calculateAdminCreatePrice({ amount: '10', reason })).toThrow(
      '定价原因',
    );
  });
  it('binds every production price fact, not the editable price or name', () => {
    const empty = adminCreatePriceFactsKey({});
    const item = {
      quantity: 101,
      productId: 'product',
      pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
      paperType: '红卡',
      paperWeightGsm: 230,
      specification: '大号封',
      actualWidthMm: 90,
      actualHeightMm: 165,
      manualQuoteReason: '特殊加工',
      frontFoilColors: ['亚金'],
      backFoilColors: ['红色'],
      foilTechnique: OrderFoilTechnique.FLAT,
      hasLocalFoil: true,
      lamination: OrderLamination.NONE,
      crafts: ['craft'],
    };
    const key = adminCreatePriceFactsKey(item);
    expect(key).not.toBe(empty);
    expect(adminCreatePriceFactsKey({ ...item, quantity: 102 })).not.toBe(key);
    expect(
      adminCreatePriceFactsKey({
        ...item,
        printColors: ['C'],
        isDoubleSided: true,
        isDoubleColor: true,
        productStructure: 'STANDARD_ENVELOPE',
      }),
    ).not.toBe(key);
    expect(adminCreatePriceFactsKey({ ...item, name: '显示名称' })).toBe(key);
  });
});

describe('administrator packaging rate', () => {
  it('rounds group totals once and permits an explicit waiver', () => {
    expect(
      calculateAdminPackagingPrice(
        { amount: '0.1234', reason: '客户协议价' },
        13,
      ).subtotal,
    ).toBe('1.60');
    expect(
      calculateAdminPackagingPrice({ amount: '0', reason: '免包装费' }, 13)
        .subtotal,
    ).toBe('0.00');
  });
  it.each(['-1', '0.12345', '1000000', 'NaN'])(
    'rejects invalid rate %s',
    (amount) => {
      expect(() =>
        calculateAdminPackagingPrice({ amount, reason: '客户协议价' }, 1),
      ).toThrow('包装单价');
    },
  );
  it.each([-1, 0.5, Infinity])('rejects invalid count %s', (count) => {
    expect(() =>
      calculateAdminPackagingPrice(
        { amount: '1', reason: '客户协议价' },
        count,
      ),
    ).toThrow('包装数量');
  });
  it('rejects overflow and an absent or overlong reason', () => {
    expect(() =>
      calculateAdminPackagingPrice(
        { amount: '999999.9999', reason: '客户协议价' },
        9999999,
      ),
    ).toThrow('包装金额');
    for (const reason of ['', 'a'.repeat(201)])
      expect(() =>
        calculateAdminPackagingPrice({ amount: '1', reason }, 1),
      ).toThrow('定价原因');
  });
  it('binds mode, composition, quantity and address allocations', () => {
    const group = {
      name: null,
      mode: OrderPackagingMode.BOX_TACTILE,
      actualBagCount: 13,
      itemUnitsPerBag: [8],
    };
    expect(adminPackagingPriceFactsKey(group, [101], [[3]])).not.toBe(
      adminPackagingPriceFactsKey(group, [101], [[8]]),
    );
  });
});
