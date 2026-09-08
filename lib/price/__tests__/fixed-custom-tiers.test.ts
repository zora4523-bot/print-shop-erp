import { describe, expect, it } from 'vitest';
import { fixedCustomTierIssue, type CustomTierRange } from '../fixed-custom-tiers';

// 加工费计费规则 §2.1: ten identities, configurable bounds, five product sizes.
export function tierFixture(ninthUpper = 40_000): CustomTierRange[][] {
  const upper = [750, 1500, 2500, 3500, 4500, 7500, 15000, 25000, ninthUpper, null];
  return Array.from({ length: 5 }, () => upper.map((maxQty, index) => ({
    minQty: index === 0 ? 1 : upper[index - 1]! + 1, maxQty,
  })));
}

describe('fixed custom tiers', () => {
  it.each([40_000, 42_000, 30_000])('accepts complete continuous tiers with editable upper %i', upper => {
    expect(fixedCustomTierIssue(tierFixture(upper))).toBeNull();
  });
  it('normalizes the open upper bound without changing tier identity', () => {
    const groups = tierFixture(); groups[0][9].maxQty = 9_999_999;
    expect(fixedCustomTierIssue(groups)).toBeNull();
  });
  it.each(['missing-size', 'nine', 'gap', 'overlap', 'fraction', 'start', 'finite-last', 'divergent', 'swapped'] as const)(
    'rejects %s before saving', scenario => {
      const groups = tierFixture();
      if (scenario === 'swapped') groups.forEach(group => { [group[0], group[1]] = [group[1], group[0]]; });
      if (scenario === 'missing-size') groups.pop();
      if (scenario === 'nine') groups.forEach(group => group.pop());
      if (scenario === 'gap') groups[0][1].minQty = 752;
      if (scenario === 'overlap') groups[0][1].minQty = 750;
      if (scenario === 'fraction') groups[0][0].maxQty = 750.5;
      if (scenario === 'start') groups[0][0].minQty = null;
      if (scenario === 'finite-last') groups[0][9].maxQty = 50000;
      if (scenario === 'divergent') { groups[0][8].maxQty = 42000; groups[0][9].minQty = 42001; }
      expect(fixedCustomTierIssue(groups)).toBeTruthy();
    },
  );
});
