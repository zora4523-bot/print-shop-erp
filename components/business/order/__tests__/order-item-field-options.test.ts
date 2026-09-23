import { expect, it } from 'vitest';
import { OrderItemPricingRoute, ProductCategory } from '@/generated/prisma/enums';
import { createExternalOrderItem, normalizeExternalOrderItem } from '@/lib/order/order-item-configuration';
import { orderItemSelectionUpdate } from '@/lib/order/order-item-selection';
import { WORKBENCH_CATALOG, WORKBENCH_CRAFTS } from '@/lib/workbench/__tests__/item-fixtures';
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

function disjointCatalog() {
  return {
    ...WORKBENCH_CATALOG,
    products: [WORKBENCH_CATALOG.products[0]!, {
      ...WORKBENCH_CATALOG.products[0]!, selectionKey: 'blank:red:mid',
      paperType: '180g红卡', weight: 180, paperMaterialId: 'red', specification: '中号封80×115',
    }],
    papers: [WORKBENCH_CATALOG.papers[0]!, {
      ...WORKBENCH_CATALOG.papers[0]!, id: 'red', name: '红卡', weight: 180, specification: '180g',
    }],
  };
}

it('can switch both ways between sold blank papers with no shared specification', () => {
  const catalog = disjointCatalog();
  let item = createExternalOrderItem(WORKBENCH_CRAFTS, catalog.products, catalog.papers);
  expect(item).toMatchObject({ productId: null, paperType: '160g珠光艳闪', specification: '大号封90×165' });
  for (const [paperKey, paperType, specification, weight, width, height] of [
    ['红卡', '180g红卡', '中号封80×115', 180, 80, 115],
    ['珠光艳闪', '160g珠光艳闪', '大号封90×165', 160, 90, 165],
  ] as const) {
    expect(orderItemFieldOptions(item, catalog.products, catalog).externalPaperOptions)
      .toContainEqual(expect.objectContaining({ value: paperKey, disabled: false }));
    const selected = orderItemSelectionUpdate(item, { type: 'paper', value: paperKey }, catalog.products, catalog)!;
    item = normalizeExternalOrderItem({ item: selected.item, ...selected.options,
      crafts: WORKBENCH_CRAFTS, products: catalog.products, paperMaterials: catalog.papers });
    expect(item).toMatchObject({ productId: null, paperType, specification,
      paperWeightGsm: weight, actualWidthMm: width, actualHeightMm: height });
  }
});

it('initializes a sold null-Product blank identity when the preferred large paper is unavailable', () => {
  const catalog = disjointCatalog();
  catalog.papers[0] = { ...catalog.papers[0]!, outOfStock: true };
  expect(createExternalOrderItem(WORKBENCH_CRAFTS, catalog.products, catalog.papers)).toMatchObject({
    productId: null, paperType: '180g红卡', paperWeightGsm: 180,
    specification: '中号封80×115', actualWidthMm: 80, actualHeightMm: 115,
  });
});

it.each(['out-of-stock', 'inactive'])('keeps %s blank papers unselectable across specifications', (state) => {
  const catalog = disjointCatalog();
  catalog.papers = state === 'inactive' ? catalog.papers.filter((paper) => paper.id !== 'red')
    : catalog.papers.map((paper) => paper.id === 'red' ? { ...paper, outOfStock: true } : paper);
  const item = createExternalOrderItem(WORKBENCH_CRAFTS, catalog.products, catalog.papers);
  expect(orderItemFieldOptions(item, catalog.products, catalog).externalPaperOptions)
    .toContainEqual(expect.objectContaining({ value: '红卡', disabled: true }));
  expect(orderItemSelectionUpdate(item, { type: 'paper', value: '红卡' }, catalog.products, catalog)).toBeNull();
  expect(normalizeExternalOrderItem({ item, paperKey: '红卡', crafts: WORKBENCH_CRAFTS,
    products: catalog.products, paperMaterials: catalog.papers })).toEqual(item);
});

it('preserves color-print paper filtering by current specification', () => {
  const catalog = disjointCatalog();
  const colorProducts = catalog.products.map((product, index) => ({ ...product,
    id: `color-${index}`, source: undefined, category: ProductCategory.COLOR_PRINT,
  }));
  const item = { ...createExternalOrderItem(WORKBENCH_CRAFTS, catalog.products, catalog.papers),
    pricingRoute: OrderItemPricingRoute.COLOR_PRINT, productId: 'color-0' };
  expect(orderItemFieldOptions(item, colorProducts, { ...catalog, products: colorProducts }).externalPaperOptions)
    .toContainEqual(expect.objectContaining({ value: '红卡', disabled: true }));
  expect(normalizeExternalOrderItem({ item, paperKey: '红卡', crafts: WORKBENCH_CRAFTS,
    products: colorProducts, paperMaterials: catalog.papers })).toMatchObject({
    productId: 'color-0', paperType: '160g珠光艳闪', specification: '大号封90×165',
  });
});

it('orders paper buttons and the default paper by the owner display order', () => {
  const stock = (id: string, paperType: string) => ({
    id, code: `EXT-STOCK-${id}`, category: ProductCategory.BLANK_STOCK, specification: '大号封90×165', paperType,
  });
  // The catalog order deliberately differs from the display order.
  const catalog = [
    stock('coated', '160g铜版纸'), stock('linen', '150g莱尼纹'), stock('variegated', '160g杂色珠光纸'),
    stock('red', '160g红卡'), stock('pearl', '160g珠光艳闪'), stock('touch', '200g触感纸'),
  ];
  const item = {
    ...createExternalOrderItem([], catalog, []),
    pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
    specification: '大号封90×165',
  };
  expect(orderItemFieldOptions(item, catalog).externalPaperOptions.map((option) => option.label))
    .toEqual(['艳红珠光纸', '触感纸', '红卡纸', '杂色珠光纸', '铜版纸', '莱尼纹']);
  // The default is the first selectable paper in the owner order, not the catalog's
  // first row, so adding papers (铜版纸 is listed first here) cannot change it.
  expect(normalizeExternalOrderItem({ item, crafts: [], products: catalog, resetPaper: true }).paperType)
    .toBe('160g珠光艳闪');
  expect(createExternalOrderItem([], catalog, []).paperType).toBe('160g珠光艳闪');
  // An explicitly chosen paper is kept even though it ranks later.
  expect(normalizeExternalOrderItem({ item: { ...item, paperType: '160g铜版纸' }, crafts: [], products: catalog }).paperType)
    .toBe('160g铜版纸');
});

it('falls back to the next paper in owner order when the first is unavailable for the size', () => {
  const stock = (id: string, paperType: string, specification: string) => ({
    id, code: `EXT-STOCK-${id}`, category: ProductCategory.BLANK_STOCK, specification, paperType,
  });
  const catalog = [
    stock('touch', '200g触感纸', '大号封90×165'),
    stock('pearl-mini', '160g珠光艳闪', '迷你封50×80'),
    stock('variegated', '160g杂色珠光纸', '大号封90×165'),
  ];
  const item = { ...createExternalOrderItem([], catalog, []), specification: '大号封90×165' };
  // 艳红珠光纸 has no 大号封 here, so the next listed paper with that size wins: 触感纸 before 杂色珠光纸.
  expect(normalizeExternalOrderItem({ item, crafts: [], products: catalog, resetPaper: true }).paperType)
    .toBe('200g触感纸');
});
