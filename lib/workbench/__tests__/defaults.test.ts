import { expect, it } from 'vitest';
import {
  OrderItemPricingRoute,
  ProductCategory,
} from '@/generated/prisma/enums';
import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { workbenchDefaultSelection } from '../defaults';

const route = OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL;
const product: ExternalCreateOrderOptions['products'][number] = {
  id: 'large',
  code: null,
  name: '专版大号',
  category: ProductCategory.CUSTOM_FLAT_FOIL,
  specification: '大号封90×165',
  paperType: null,
  weight: null,
  paperMaterialId: null,
};
const options: ExternalCreateOrderOptions = {
  products: [
    { ...product, id: 'malformed', specification: '100×200、中号' },
    { ...product, id: 'medium', specification: '中号封80×115' },
    product,
  ],
  papers: [120, 160].map((weight) => ({
    id: `paper-${weight}`,
    code: `paper-${weight}`,
    name: '珠光艳闪',
    specification: `${weight}g`,
    weight,
    unit: '张',
    sortOrder: weight,
    outOfStock: false,
  })),
  foilColors: [],
  specifications: [],
};

it('starts with a common catalog combination instead of malformed or first-row facts', () => {
  expect(workbenchDefaultSelection(route, options)).toEqual({
    productId: 'large',
    specification: '大号封90×165',
    paperType: '160g珠光艳闪',
  });
});

it('uses available catalog facts when the preferred combination is absent', () => {
  expect(
    workbenchDefaultSelection(route, {
      ...options,
      products: [options.products[1]!],
      papers: [options.papers[0]!],
    }),
  ).toEqual({
    productId: 'medium',
    specification: '中号封80×115',
    paperType: '120g珠光艳闪',
  });
});

it('respects route and explicit product paper constraints', () => {
  const print = {
    ...product,
    id: 'print',
    category: ProductCategory.COLOR_PRINT,
    paperType: '铜版纸',
    weight: 200,
  };
  expect(
    workbenchDefaultSelection(OrderItemPricingRoute.COLOR_PRINT, {
      ...options,
      products: [...options.products, print],
    }),
  ).toEqual({
    productId: 'print',
    specification: print.specification,
    paperType: '200g铜版纸',
  });
});

it('does not invent a default from missing, invalid or out-of-stock facts', () => {
  const empty = { productId: '', specification: '', paperType: '' };
  expect(
    workbenchDefaultSelection(route, { ...options, products: [] }),
  ).toEqual(empty);
  expect(
    workbenchDefaultSelection(route, {
      ...options,
      products: [options.products[0]!],
    }),
  ).toEqual(empty);
  expect(
    workbenchDefaultSelection(OrderItemPricingRoute.STOCK_BLANK, options),
  ).toEqual(empty);
  expect(
    workbenchDefaultSelection(route, {
      ...options,
      products: [{ ...product, paperType: '未知克重纸张' }],
    }),
  ).toEqual(empty);
  expect(
    workbenchDefaultSelection(route, {
      ...options,
      papers: options.papers.map((paper) => ({ ...paper, outOfStock: true })),
    }),
  ).toEqual(empty);
});
