import { describe, expect, it } from 'vitest';
import {
  searchRelevanceRank,
  sortBySearchRelevance,
} from '../search-ranking';

describe('searchRelevanceRank', () => {
  it('prefers exact, prefix, contains, then pinyin fields', () => {
    expect(searchRelevanceRank('红包', ['红包'])).toBe(0);
    expect(searchRelevanceRank('红包', ['红包袋'])).toBe(1);
    expect(searchRelevanceRank('红包', ['专版红包'])).toBe(2);
    expect(searchRelevanceRank('hb', [], ['hb001'])).toBe(4);
  });
});

describe('sortBySearchRelevance', () => {
  it('sorts by relevance and keeps original order for ties', () => {
    const rows = [
      { id: 'contains', name: '专版红包' },
      { id: 'exact-1', name: '红包' },
      { id: 'exact-2', name: '红包' },
      { id: 'prefix', name: '红包袋' },
    ];

    expect(
      sortBySearchRelevance(rows, '红包', (row) => ({ fields: [row.name] })).map(
        (row) => row.id,
      ),
    ).toEqual(['exact-1', 'exact-2', 'prefix', 'contains']);
  });
});
