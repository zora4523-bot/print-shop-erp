import { expect, it } from 'vitest';
import { ProductCategory } from '@/generated/prisma/enums';
import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { workbenchPaperChoices, workbenchPaperIssue } from '../catalog';

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


it('distinguishes missing weight from stock and inactive material facts', () => {
  const linkedProduct = { ...product, paperMaterialId: 'red' };
  expect(workbenchPaperIssue(linkedProduct, papers)).toBeNull();
  // A missing stock product paper constraint is not a missing material weight.
  expect(workbenchPaperIssue({ ...linkedProduct, category: ProductCategory.BLANK_STOCK }, papers)).toBeNull();
  expect(workbenchPaperIssue(linkedProduct, [])).toContain('缺货或停用');
  expect(workbenchPaperIssue(linkedProduct, [{ ...papers[0]!, outOfStock: true }])).toContain('缺货或停用');
  const weightless = [{ ...papers[0]!, weight: null, specification: null }];
  expect(workbenchPaperIssue(linkedProduct, weightless)).toContain('缺少克重');
  expect(workbenchPaperIssue({ ...linkedProduct, paperType: '160g红卡' }, weightless)).toBeNull();
  expect(workbenchPaperIssue(undefined, weightless)).toBeNull();
});


it('excludes retired paper from explicit, linked and generic product choices', () => {
  const retired = { ...papers[0]!, weight: 120, specification: '120g' };
  const explicit = { ...product, paperType: '120g珠光艳闪' };
  expect(workbenchPaperChoices(explicit, papers)).toEqual([]);
  expect(workbenchPaperIssue(explicit, papers)).toContain('120g 纸张已停用');
  expect(workbenchPaperChoices({ ...product, paperType: '红卡', paperMaterialId: 'red' }, [retired])).toEqual([]);
  expect(workbenchPaperChoices(product, [retired])).toEqual([]);
});
