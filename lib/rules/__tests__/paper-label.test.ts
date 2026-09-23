import { describe, expect, it } from 'vitest';
import { PAPER_DISPLAY_ORDER, paperDisplayLabel, paperDisplayRank, paperSearchValues } from '../paper-label';

// Display-only: persisted catalog facts keep their stored names; every render site
// must go through this so the create form, order detail, print view, export and
// worker task pages agree on the current name.
describe('paperDisplayLabel', () => {
  it('uses the current paper terminology and keeps any weight prefix', () => {
    expect(paperDisplayLabel('160g珠光艳闪')).toBe('160g艳红珠光纸');
    expect(paperDisplayLabel('160g珠光闪红')).toBe('160g暗红珠光纸');
    expect(paperDisplayLabel('珠光暗红')).toBe('暗红珠光纸');
    expect(paperDisplayLabel('230g金葱')).toBe('230g金葱纸');
    expect(paperDisplayLabel('180g红卡')).toBe('180g红卡纸');
    expect(paperDisplayLabel('160克冰白纸')).toBe('160克冰白珠光纸');
  });

  it('is idempotent and leaves other papers and box names untouched', () => {
    for (const current of ['艳红珠光纸', '暗红珠光纸', '金葱纸', '红卡纸', '冰白珠光纸']) {
      expect(paperDisplayLabel(current)).toBe(current);
    }
    expect(paperDisplayLabel('200g艳闪')).toBe('200g艳闪');
    expect(paperDisplayLabel('160g杂色珠光纸')).toBe('160g杂色珠光纸');
    expect(paperDisplayLabel('200g触感纸')).toBe('200g触感纸');
    expect(paperDisplayLabel('红卡盒子 230g')).toBe('红卡盒子 230g');
  });

  it('renames every paper inside a combined label', () => {
    expect(paperDisplayLabel('230g 金葱/红卡')).toBe('230g 金葱纸/红卡纸');
    expect(paperDisplayLabel('160g艳闪 / 红卡')).toBe('160g艳闪 / 红卡纸');
  });
});

describe('paperDisplayRank', () => {
  it('follows the owner order and puts unlisted papers last', () => {
    expect(PAPER_DISPLAY_ORDER.slice(0, 5)).toEqual(['艳红珠光纸', '暗红珠光纸', '触感纸', '金葱纸', '红卡纸']);
    expect(PAPER_DISPLAY_ORDER.slice(-2)).toEqual(['冰白珠光纸', '铜版纸']);
    expect(paperDisplayRank('艳红珠光纸')).toBe(0);
    expect(paperDisplayRank('杂色珠光纸')).toBeLessThan(paperDisplayRank('冰白珠光纸'));
    expect(paperDisplayRank('莱尼纹')).toBe(PAPER_DISPLAY_ORDER.length);
    expect(paperDisplayRank('双铜纸')).toBe(PAPER_DISPLAY_ORDER.length);
  });
});

describe('paperSearchValues', () => {
  it('adds the stored spellings for text typed as displayed', () => {
    expect(paperSearchValues('160g艳红珠光纸')).toEqual(['160g艳红珠光纸', '160g珠光艳闪']);
    expect(paperSearchValues('暗红珠光纸')).toEqual(['暗红珠光纸', '珠光闪红', '珠光暗红']);
    expect(paperSearchValues('金葱纸')).toEqual(['金葱纸', '金葱']);
    expect(paperSearchValues('冰白珠光纸')).toEqual(['冰白珠光纸', '冰白纸']);
  });

  it('keeps stored or partial text as the only term', () => {
    expect(paperSearchValues('珠光艳闪')).toEqual(['珠光艳闪']);
    expect(paperSearchValues('珠光')).toEqual(['珠光']);
    expect(paperSearchValues('触感纸')).toEqual(['触感纸']);
  });
});
