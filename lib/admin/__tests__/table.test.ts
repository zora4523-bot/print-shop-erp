import { describe, it, expect } from 'vitest';
import {
  buildTableHref,
  firstSearchParam,
  nextSortDirection,
  paginateItems,
  parsePositiveInt,
  parseSortDirection,
  parseSortKey,
} from '../table';

describe('admin table helpers', () => {
  it('reads the first search param value', () => {
    expect(firstSearchParam(['a', 'b'])).toBe('a');
    expect(firstSearchParam(undefined)).toBe('');
  });

  it('parses positive ints with min/max/default guards', () => {
    expect(parsePositiveInt('3', { defaultValue: 1, min: 1, max: 5 })).toBe(3);
    expect(parsePositiveInt('0', { defaultValue: 1, min: 1, max: 5 })).toBe(1);
    expect(parsePositiveInt('99', { defaultValue: 1, min: 1, max: 5 })).toBe(5);
    expect(parsePositiveInt('x', { defaultValue: 2 })).toBe(2);
  });

  it('parses sort keys and directions defensively', () => {
    const allowed = ['code', 'name'] as const;
    expect(parseSortKey('code', allowed, 'name')).toBe('code');
    expect(parseSortKey('missing', allowed, 'name')).toBe('name');
    expect(parseSortDirection('desc')).toBe('desc');
    expect(parseSortDirection('bad')).toBe('asc');
  });

  it('toggles sort direction for the active key', () => {
    expect(nextSortDirection('code', 'asc', 'code')).toBe('desc');
    expect(nextSortDirection('code', 'desc', 'code')).toBe('asc');
    expect(nextSortDirection('code', 'desc', 'name')).toBe('asc');
  });

  it('paginates and clamps out-of-range pages', () => {
    expect(paginateItems([1, 2, 3, 4, 5], 2, 2)).toEqual({
      rows: [3, 4],
      total: 5,
      page: 2,
      pageSize: 2,
      pageCount: 3,
    });
    expect(paginateItems([1], 99, 10).page).toBe(1);
    expect(paginateItems([], 99, 10)).toEqual({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 10,
      pageCount: 1,
    });
  });

  it('builds table hrefs while removing empty params', () => {
    expect(
      buildTableHref(
        '/owner/materials',
        { q: '纸', page: 3, sort: 'code' },
        { page: null, dir: 'desc' },
      ),
    ).toBe('/owner/materials?q=%E7%BA%B8&sort=code&dir=desc');
  });
});
