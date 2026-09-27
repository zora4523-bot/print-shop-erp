import { describe, expect, it } from 'vitest';
import { planOrderItemRemoval, remapDesignNameRecords } from '../order-form-item-removal';

const items = ['a', 'b', 'a', 'c', 'b'].map((designGroupKey) => ({ designGroupKey }));

describe('design-aware deletion selection', () => {
  it.each([
    [[0], 0, 1], // A1 -> A2, across B1.
    [[2], 2, 0], // A2 -> A1, across B1.
    [[1], 1, 3], // B1 -> B2.
    [[0, 2], 0, 0], // Whole A -> B.
    [[1, 4], 1, 2], // Whole middle design B -> C, not A2.
    [[3], 3, 1], // Last design C -> previous design B.
    [[0, 2], 4, 2], // Deleting another design preserves the active row identity.
  ])('removes %j from selection %i and selects %i', (removed, active, expected) => {
    expect(planOrderItemRemoval(items, removed, active)?.activeIndex).toBe(expected);
  });

  it('derives one complete removal set without changing original rows', () => {
    expect(planOrderItemRemoval(items, [2, 0, 2], 0)).toEqual({
      removedIndexes: [0, 2], keptIndexes: [1, 3, 4], activeIndex: 0,
    });
    expect(items.map((item) => item.designGroupKey)).toEqual(['a', 'b', 'a', 'c', 'b']);
  });

  it.each([[], [0, 1, 2, 3, 4], [-1], [5], [0.5], [0, 99]])('rejects an empty, complete or invalid deletion: %j', (...indexes) => {
    expect(planOrderItemRemoval(items, indexes, 0)).toBeNull();
  });
});

describe('legacy design naming decisions', () => {
  it('moves true and false decisions with surviving legacy rows, discarding deleted records', () => {
    const records = new Map([['legacy:0', false], ['legacy:1', true], ['legacy:2', false], ['a', true], ['deleted', true]]);
    expect(remapDesignNameRecords([{}, {}, {}, { designGroupKey: 'a' }], [1, 2, 3], records))
      .toEqual(new Map([['legacy:0', true], ['legacy:1', false], ['a', true]]));
    expect(records.get('legacy:0')).toBe(false);
  });

  it('preserves inference for unrecorded names and the stable key of a shared design', () => {
    expect(remapDesignNameRecords([{}, {}, { designGroupKey: 'a' }, { designGroupKey: 'a' }], [1, 3], new Map([['a', false]])))
      .toEqual(new Map([['a', false]]));
  });
});
