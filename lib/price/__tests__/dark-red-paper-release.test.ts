import { describe, expect, it } from 'vitest';
import { buildDarkRedPaperReleaseRules, DARK_RED_PAPER_RELEASE } from '../dark-red-paper-release';
import type { DraftPriceRuleForValidation } from '../customer-price-book-draft-validation';

function sourceRules(): DraftPriceRuleForValidation[] {
  const surcharge: DraftPriceRuleForValidation = {
    id: 'misc', code: 'CUSTOM_PAPER_VARIEGATED_PEARL_160', name: '杂色珠光 160g',
    kind: 'ADD_ON', calculationType: 'PER_PIECE', amount: '0.03',
    includedUnits: null, incrementUnits: null, incrementAmount: null,
    minQty: null, maxQty: null, exclusiveGroup: 'CUSTOM_PAPER_SURCHARGE',
    triggerCondition: { schemaVersion: 1, target: 'ITEM',
      pricingRoutes: ['CUSTOM_SINGLE_FLAT_FOIL'], paperTypes: ['160g杂色珠光'] },
    priority: 200, blocksAutomaticQuote: false, sourceSheet: '§2.2', sourceRange: null,
    sourceName: 'source', sourceSha256: 'a'.repeat(64), note: null,
    productId: null, product: null, isActive: true,
    category: { code: 'PAPER_SURCHARGE', name: '纸张加价', isActive: true },
  };
  return [surcharge, ...['MID', 'SQUARE', 'WEST-MID', 'LARGE', 'WEST-LARGE'].map(spec => ({
    ...surcharge, id: spec, code: `BASE_${spec}`, name: spec, kind: 'BASE',
    exclusiveGroup: 'CUSTOM_BASE', amount: spec.includes('LARGE') ? '0.325' : '0.31',
    minQty: 1_000, maxQty: 1_999,
    triggerCondition: { schemaVersion: 1, target: 'ITEM',
      pricingRoutes: ['CUSTOM_SINGLE_FLAT_FOIL'], productCodes: [`EXT-CUSTOM-${spec}`],
      paperTypes: ['160g珠光艳闪', '160g红卡', '160g杂色珠光'] },
  }))];
}

describe('暗红专版受控发布清单', () => {
  it('保留源规则，在五种规格增加准确纸张身份和独立加价行', () => {
    const source = sourceRules();
    const previous = structuredClone(source);
    const planned = buildDarkRedPaperReleaseRules(source);
    expect(source).toEqual(previous);
    expect(planned).toHaveLength(source.length + 1);
    for (const row of planned.filter(rule => rule.exclusiveGroup === 'CUSTOM_BASE')) {
      const before = source.find(rule => rule.code === row.code)!;
      expect(row).toMatchObject({
        amount: before.amount, minQty: before.minQty, maxQty: before.maxQty,
        triggerCondition: { paperTypes: ['160g珠光艳闪', '160g红卡', '160g杂色珠光', '160g珠光闪红'] },
      });
    }
    expect(planned[0]).toEqual(source[0]);
    expect(planned.at(-1)).toMatchObject({
      code: DARK_RED_PAPER_RELEASE.ruleCode, amount: '0.0300', productId: null,
      kind: 'ADD_ON', calculationType: 'PER_PIECE', sourceName: DARK_RED_PAPER_RELEASE.source,
      triggerCondition: { paperTypes: ['160g珠光闪红'], pricingRoutes: ['CUSTOM_SINGLE_FLAT_FOIL'] },
    });
    expect(planned.at(-1)?.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('已有同编码规则时拒绝覆盖', () => {
    const source = sourceRules();
    source[0]!.code = DARK_RED_PAPER_RELEASE.ruleCode;
    expect(() => buildDarkRedPaperReleaseRules(source)).toThrow('已有暗红');
  });

  it.each(['160g珠光闪红', '160 克 珠光闪红'])('已有同纸张其他加价时拒绝：%s', paper => {
    const source = sourceRules();
    source[0]!.triggerCondition = { paperTypes: [paper] };
    expect(() => buildDarkRedPaperReleaseRules(source)).toThrow('已有暗红');
  });

  it.each(['missing', 'duplicate', 'inactive'])('拒绝不唯一或不可用的参照规则：%s', mode => {
    const source = sourceRules();
    if (mode === 'missing') source.shift();
    if (mode === 'duplicate') source.push({ ...source[0]!, id: 'duplicate' });
    if (mode === 'inactive') source[0]!.isActive = false;
    expect(() => buildDarkRedPaperReleaseRules(source)).toThrow('缺少唯一有效');
  });

  it.each(['inactive', 'invalid', 'empty', 'already-included'])('拒绝异常阶梯：%s', mode => {
    const source = sourceRules();
    if (mode === 'inactive') source[1]!.isActive = false;
    if (mode === 'invalid') source[1]!.triggerCondition = { unknown: true };
    if (mode === 'empty') source[1]!.triggerCondition = {};
    if (mode === 'already-included') source[1]!.triggerCondition = { paperTypes: ['160g珠光闪红'] };
    expect(() => buildDarkRedPaperReleaseRules(source)).toThrow('专版阶梯纸张范围');
  });

  it('没有阶梯时拒绝发布', () => {
    expect(() => buildDarkRedPaperReleaseRules(sourceRules().slice(0, 1))).toThrow('缺少专版阶梯');
  });
});
