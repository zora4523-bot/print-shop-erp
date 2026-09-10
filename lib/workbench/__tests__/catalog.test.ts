import { expect, it } from 'vitest';
import { ProductCategory } from '@/generated/prisma/enums';
import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { workbenchPaperChoices } from '../catalog';

const product: ExternalCreateOrderOptions['products'][number] = {
  id: 'p',
  code: null,
  name: '专版大号',
  category: ProductCategory.CUSTOM_FLAT_FOIL,
  specification: '大号封90×165',
  paperType: null,
  weight: null,
  paperMaterialId: null,
};
const papers: ExternalCreateOrderOptions['papers'] = [
  {
    id: 'red',
    code: 'red',
    name: '红卡',
    specification: '180g',
    weight: 180,
    unit: '张',
    sortOrder: 1,
    outOfStock: false,
  },
  {
    id: 'flash',
    code: 'flash',
    name: '160g珠光艳闪',
    specification: '160g',
    weight: 160,
    unit: '张',
    sortOrder: 2,
    outOfStock: true,
  },
];
it('uses material weights for size-only custom products and omits out-of-stock choices', () => {
  expect(workbenchPaperChoices(product, papers)).toEqual(['180g红卡']);
});
it('preserves the product paper constraint and follows a linked material weight', () => {
  expect(
    workbenchPaperChoices(
      { ...product, paperType: '红卡', paperMaterialId: 'red' },
      papers,
    ),
  ).toEqual(['180g红卡']);
});
it.each([
  ['out of stock', 'flash'],
  ['absent from the active catalog', 'retired-paper'],
])('omits explicit product papers whose linked material is %s', (_state, paperMaterialId) => {
  expect(
    workbenchPaperChoices(
      { ...product, paperType: '160g珠光艳闪', weight: 160, paperMaterialId },
      papers,
    ),
  ).toEqual([]);
});
it('preserves unlinked product paper choices independently of the material catalog', () => {
  expect(
    workbenchPaperChoices(
      { ...product, paperType: '专用纸', weight: 160 },
      [],
    ),
  ).toEqual(['160g专用纸']);
});
it('does not invent material combinations for stock products', () => {
  expect(
    workbenchPaperChoices(
      { ...product, category: ProductCategory.BLANK_STOCK },
      papers,
    ),
  ).toEqual([]);
});
it('handles missing product and empty material catalog', () => {
  expect(workbenchPaperChoices(undefined, papers)).toEqual([]);
  expect(workbenchPaperChoices(product, [])).toEqual([]);
});
