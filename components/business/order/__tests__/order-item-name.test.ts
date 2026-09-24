import { describe, expect, it } from 'vitest';
import { OrderItemPricingRoute } from '@/generated/prisma/enums';
import { createExternalOrderItem, normalizeExternalOrderItem } from '@/lib/order/order-item-configuration';
import { WORKBENCH_CATALOG, WORKBENCH_CRAFTS } from '@/lib/workbench/__tests__/item-fixtures';
import { copyOrderItemName, syncAutomaticOrderItemName } from '../order-item-name';

const catalog = { products: WORKBENCH_CATALOG.products, paperMaterials: WORKBENCH_CATALOG.papers };
const blank = createExternalOrderItem(WORKBENCH_CRAFTS, catalog.products, catalog.paperMaterials, '亚金');
const dedicated = normalizeExternalOrderItem({
  ...catalog, crafts: WORKBENCH_CRAFTS,
  item: { ...blank, pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL },
});

describe('automatic internal order item names', () => {
  it('follows route changes in both directions', () => {
    expect(syncAutomaticOrderItemName(blank, dedicated, catalog)).toBe('专版烫金 · 艳红珠光纸 160g · 大号封');
    expect(syncAutomaticOrderItemName(dedicated, blank, catalog)).toBe(blank.name);
  });

  it('follows changes to paper, weight and specification', () => {
    const next = { ...dedicated, paperType: '200g铜版纸', paperWeightGsm: 200, specification: '方形90×90' };
    expect(syncAutomaticOrderItemName(dedicated, next, catalog)).toBe('专版烫金 · 铜版纸 200g · 方形');
  });

  it.each([0, 1, 2, 12])('repairs an old draft after %i copies, including truncated names', (copies) => {
    let name = blank.name;
    let expected = dedicated.name;
    for (let index = 0; index < copies; index += 1) {
      name = copyOrderItemName(name);
      expected = copyOrderItemName(expected);
    }
    const stale = { ...dedicated, name };
    expect(syncAutomaticOrderItemName(stale, stale, catalog)).toBe(expected);
  });

  it.each(['春节客户定制款', '局部烫金 · 客户指定图案', `${blank.name}（客户命名）`, '', '春节客户定制款 副本'])(
    'preserves the manual name %j', (name) => {
      expect(syncAutomaticOrderItemName({ ...blank, name }, dedicated, catalog)).toBe(name);
    },
  );

  it('leaves names unchanged when the original material cannot be identified', () => {
    expect(syncAutomaticOrderItemName({ ...blank, paperType: '未配置纸张' }, dedicated, catalog)).toBe(blank.name);
    expect(syncAutomaticOrderItemName(blank, { ...dedicated, paperWeightGsm: null }, catalog)).toBe(blank.name);
  });
});
