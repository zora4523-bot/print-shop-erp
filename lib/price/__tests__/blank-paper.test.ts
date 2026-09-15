import { describe, expect, it } from 'vitest';
import {
  addBlankPaperSchema,
  blankPaperFact,
  blankSpecificationKey,
} from '../blank-paper';
const valid = {
  priceBookId: 'draft-1',
  expectedUpdatedAt: '2026-09-13T00:00:00.000Z',
  paper: { mode: 'new', name: '测试纸', weight: 160 },
  specifications: [{ key: 'mid', amount: '0.3251' }],
};

describe('新增空白封纸张输入边界', () => {
  it.each(['0', '0.325', '0.3251', null])(
    '保留价格 %s 与待核价的区别',
    (amount) => {
      expect(
        addBlankPaperSchema.parse({
          ...valid,
          specifications: [{ key: 'mid', amount }],
        }).specifications[0]?.amount,
      ).toBe(amount);
    },
  );
  it.each(['-1', '0.32511', '1e2', 'NaN', '10000000000'])(
    '拒绝非法单价 %s',
    (amount) => {
      expect(
        addBlankPaperSchema.safeParse({
          ...valid,
          specifications: [{ key: 'mid', amount }],
        }).success,
      ).toBe(false);
    },
  );
  it.each([
    { specifications: [] },
    { specifications: [{ key: 'custom', amount: '1' }] },
    {
      specifications: [
        { key: 'mid', amount: '1' },
        { key: 'mid', amount: '2' },
      ],
    },
  ])('拒绝空、未知、重复规格', ({ specifications }) => {
    expect(
      addBlankPaperSchema.safeParse({ ...valid, specifications }).success,
    ).toBe(false);
  });
  it('拒绝克重冲突和多纸张名称', () => {
    for (const name of ['180g测试纸', '纸张A/纸张B'])
      expect(
        addBlankPaperSchema.safeParse({
          ...valid,
          paper: { mode: 'new', name, weight: 160 },
        }).success,
      ).toBe(false);
  });
  it('从规格事实识别列，无需产品编码', () => {
    expect(blankSpecificationKey('西封中号80×120')).toBe('west-mid');
    expect(blankSpecificationKey('方形')).toBe('square');
    expect(blankSpecificationKey('任意新规格')).toBeNull();
    expect(blankPaperFact({ name: '珠光纸', specification: '160g' })).toEqual({
      paperType: '珠光纸',
      paperWeightGsm: 160,
    });
  });
});
