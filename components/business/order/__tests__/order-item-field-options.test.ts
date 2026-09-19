import { expect, it } from 'vitest';
import { OrderItemPricingRoute, ProductCategory } from '@/generated/prisma/enums';
import { createExternalOrderItem } from '@/lib/order/order-item-configuration';
import { orderItemFieldOptions } from '../order-item-field-options';

// One paper family whose two specifications exist only at different weights.
const products = [
  { id: 'large-160', code: 'EXT-STOCK-LARGE-160', category: ProductCategory.BLANK_STOCK, specification: '大号封90×165', paperType: '160g珠光艳闪' },
  { id: 'mini-180', code: 'EXT-STOCK-MINI-180', category: ProductCategory.BLANK_STOCK, specification: '迷你封50×80', paperType: '180g珠光艳闪' },
];

// Regression: with the weight picker filtered by the current specification,
// requiring the *current* weight on the target specification made
// (迷你封, 180g) unreachable from (大号封, 160g).
it('enables a specification whenever the active paper offers any weight for it', () => {
  const item = {
    ...createExternalOrderItem([], products, []),
    pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
    paperType: '160g珠光艳闪', paperWeightGsm: 160, specification: '大号封90×165',
  };
  const options = orderItemFieldOptions(item, products);
  expect(options.externalWeightOptions).toEqual([{ value: 160, disabled: false }]);
  expect(options.externalSpecificationOptions).toEqual(expect.arrayContaining([
    expect.objectContaining({ value: '大号封90×165', disabled: false }),
    expect.objectContaining({ value: '迷你封50×80', disabled: false }),
  ]));
});

it('still disables specifications the active paper does not offer at all', () => {
  const item = {
    ...createExternalOrderItem([], products, []),
    pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
    paperType: '160g珠光艳闪', paperWeightGsm: 160, specification: '大号封90×165',
  };
  const onlyLarge = products.filter((product) => product.id === 'large-160');
  const options = orderItemFieldOptions(item, [...onlyLarge, { ...products[1]!, paperType: '180g红卡' }]);
  expect(options.externalSpecificationOptions.find((option) => option.value === '迷你封50×80')?.disabled).toBe(true);
});
