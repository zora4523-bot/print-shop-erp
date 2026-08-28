import { describe, expect, it } from 'vitest';
import {
  canonicalizeCreateOrderPaperFact,
  canonicalizeCreateOrderSpecification,
} from '../canonical-facts';

describe('create-order canonical pricing facts', () => {
  it.each([
    ['160g珠光艳闪', undefined, '珠光艳闪', 160],
    ['160克红卡', undefined, '红卡', 160],
    ['200g触感纸', undefined, '触感纸', 200],
    ['157克双铜纸', undefined, '双铜纸', 157],
    ['红卡', 180, '红卡', 180],
  ])(
    'normalizes paper %s without losing its independent weight fact',
    (label, explicitWeight, paperType, paperWeightGsm) => {
      expect(
        canonicalizeCreateOrderPaperFact(label, explicitWeight),
      ).toEqual({ paperType, paperWeightGsm });
    },
  );

  it.each([
    ['160g红卡', 180],
    ['红卡', undefined],
    ['', 160],
    ['160g', undefined],
  ])('fails closed for an ambiguous paper fact: %s / %s', (label, gsm) => {
    expect(canonicalizeCreateOrderPaperFact(label, gsm)).toBeNull();
  });

  it.each([
    ['大号封90×165', '大号封'],
    ['大号88x165mm', '大号封'],
    ['中号80*120', '中号封'],
    ['方形封88×88', '方形封'],
    ['西封中号80×120', '西封中号'],
    ['西封大号85×165', '西封大号'],
    ['万元封', '万元封'],
  ])('normalizes specification %s to %s', (label, expected) => {
    expect(canonicalizeCreateOrderSpecification(label)).toBe(expected);
  });

  it.each(['90×165', '', '90×165×80'])('fails closed for %s', (label) => {
    expect(canonicalizeCreateOrderSpecification(label)).toBeNull();
  });
});
