import { describe, expect, it } from 'vitest';
import {
  designNameIssueSummary,
  designNameIssues,
  followingDesignName,
  hasOnlyDesignNameErrors,
  isHandNamedDesign,
  unifyDesignNames,
} from '../order-form-design-names';

const row = (name: string, designGroupKey: string | null) => ({ name, designGroupKey });
const noRecord = () => undefined;

describe('designNameIssues', () => {
  it('accepts named, distinct designs whose specification rows share a name', () => {
    expect(designNameIssues([row('福字款', 'a'), row('福字款', 'a'), row('寿字款', 'b')])).toEqual([]);
  });

  it('reports a missing name once per design, on its first row', () => {
    const issues = designNameIssues([row('福字款', 'a'), row('  ', 'b'), row('', 'b')]);
    expect(issues).toEqual([
      { index: 1, designNumber: 2, kind: 'missing', message: '请填写设计款名称' },
    ]);
    expect(designNameIssueSummary(issues[0])).toBe('设计款 2：请填写设计款名称');
  });

  it('reports names longer than 64 characters', () => {
    expect(designNameIssues([row('长'.repeat(65), 'a')])).toEqual([
      { index: 0, designNumber: 1, kind: 'too-long', message: '设计款名称最多 64 个字符' },
    ]);
    expect(designNameIssues([row('长'.repeat(64), 'a')])).toEqual([]);
  });

  it('reports every design involved in a clash, ignoring spacing and case', () => {
    expect(designNameIssues([row('Fu 款', 'a'), row('寿字款', 'b'), row(' fu 款 ', 'c')])).toEqual([
      { index: 0, designNumber: 1, kind: 'duplicate', message: '与其他设计款重名：Fu 款' },
      { index: 2, designNumber: 3, kind: 'duplicate', message: '与其他设计款重名：fu 款' },
    ]);
  });

  it('treats historical rows without a design key as separate designs', () => {
    expect(designNameIssues([row('福字款', null), row('福字款', null)]).map((issue) => issue.index))
      .toEqual([0, 1]);
  });
});

describe('isHandNamedDesign', () => {
  it('uses the recorded state when there is one', () => {
    expect(isHandNamedDesign('新年红包', '新年红包', true)).toBe(true);
    expect(isHandNamedDesign('福字款', '新年红包', false)).toBe(false);
  });

  it('infers from the values otherwise: non-empty and different from the order name', () => {
    expect(isHandNamedDesign('', '新年红包', undefined)).toBe(false);
    expect(isHandNamedDesign(' 新年红包 ', '新年红包', undefined)).toBe(false);
    expect(isHandNamedDesign('福字款', '新年红包', undefined)).toBe(true);
  });
});

describe('followingDesignName', () => {
  it('fills an unnamed single design with the order name and names all its rows', () => {
    expect(followingDesignName([row('', 'a'), row('', 'a')], ' 新年红包 ', null, noRecord))
      .toEqual({ key: 'a', indexes: [0, 1], name: '新年红包' });
  });

  it('keeps following a design that still carries the previous order name', () => {
    expect(followingDesignName([row('新年红包', 'a')], '新年红包二期', '新年红包', noRecord))
      .toEqual({ key: 'a', indexes: [0], name: '新年红包二期' });
  });

  it('never takes over a hand-named design, even when the order name passes through the same text', () => {
    const handNamed = (key: string) => (key === 'a' ? true : undefined);
    expect(followingDesignName([row('福字款', 'a')], '福字款红', '福字款', handNamed)).toBeNull();
  });

  it('follows again after going back to one design that was never named by hand', () => {
    const followed = (key: string) => (key === 'a' ? false : undefined);
    expect(followingDesignName([row('A', 'a')], 'A2', 'A2', followed))
      .toEqual({ key: 'a', indexes: [0], name: 'A2' });
  });

  it('does not follow when the order has more than one design', () => {
    expect(followingDesignName([row('', 'a'), row('', 'b')], '新年红包', null, noRecord)).toBeNull();
  });
});

describe('unifyDesignNames', () => {
  it('gives every specification row of a design the name of its first row', () => {
    expect(unifyDesignNames([row('局部烫金 · 大号封', 'a'), row('局部烫金 · 中号封', 'a'), row('寿字款', 'b')]))
      .toEqual([row('局部烫金 · 大号封', 'a'), row('局部烫金 · 大号封', 'a'), row('寿字款', 'b')]);
  });
});

describe('hasOnlyDesignNameErrors', () => {
  const nameError = { name: { type: 'too_small', message: '请填写款式名' } };
  it('accepts errors confined to item names', () => {
    expect(hasOnlyDesignNameErrors({ items: [undefined, nameError] })).toBe(true);
  });

  it('rejects any other field, item field or array-level error', () => {
    expect(hasOnlyDesignNameErrors({ items: [nameError], customName: { message: 'x' } })).toBe(false);
    expect(hasOnlyDesignNameErrors({ items: [{ ...nameError, quantity: { message: 'x' } }] })).toBe(false);
    expect(hasOnlyDesignNameErrors({ items: Object.assign([nameError], { root: { message: 'x' } }) })).toBe(false);
    expect(hasOnlyDesignNameErrors({ items: { message: '至少一款' } })).toBe(false);
  });
});
