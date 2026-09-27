import { describe, expect, it } from 'vitest';
import { OrderItemPricingRoute } from '@/generated/prisma/enums';
import {
  orderItemMessageLabel,
  orderItemRowLabel,
  orderItemTypeLabel,
} from '../item-label';

describe('order item labels', () => {
  const rows = [
    { sequence: 1, name: '福字款', specification: '大号封' },
    { sequence: 2, name: '福字款', specification: '中号封' },
  ];

  it('keeps spec rows of one design distinct by sequence and specification', () => {
    expect(rows.map(orderItemRowLabel)).toEqual([
      '#1 福字款 · 大号封',
      '#2 福字款 · 中号封',
    ]);
    expect(rows.map(orderItemMessageLabel)).toEqual([
      '第 1 款“福字款”（大号封）',
      '第 2 款“福字款”（中号封）',
    ]);
  });

  it.each([null, undefined, '', '   '])(
    'omits a missing specification (%j) instead of printing an empty suffix',
    (specification) => {
      const item = { sequence: 3, name: '寄样品', specification };
      expect(orderItemRowLabel(item)).toBe('#3 寄样品');
      expect(orderItemMessageLabel(item)).toBe('第 3 款“寄样品”');
    },
  );

  it('names the type by pricing route and leaves the pending-price placeholder blank', () => {
    expect(orderItemTypeLabel(OrderItemPricingRoute.STOCK_BLANK)).toBe('局部烫金（通版现货）');
    expect(orderItemTypeLabel(OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL)).toBe('专版烫金');
    expect(orderItemTypeLabel(OrderItemPricingRoute.COLOR_PRINT)).toBe('彩印');
    // 「待管理员终价」是定价状态而不是产品类型（寄样品款式即挂这条占位路线）。
    expect(orderItemTypeLabel(OrderItemPricingRoute.MANUAL_QUOTE)).toBeNull();
  });
});
