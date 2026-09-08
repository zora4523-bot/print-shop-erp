/** Fixed §2.1 tier identities; quantities are configurable, not tied to default midpoints. */
export type CustomTierRange = { minQty: number | null; maxQty: number | null };
const OPEN_MAXIMUM = 9_999_999;

export function fixedCustomTierIssue(groups: readonly (readonly CustomTierRange[])[]): string | null {
  if (groups.length !== 5 || groups.some(group => group.length !== 10)) {
    return '专版阶梯需五个规格各十档，请补齐缺失档位后重试。';
  }
  // Callers supply the existing tier order; sorting edited ranges would allow tier swaps.
  const normalized = groups;
  for (const group of normalized) {
    let previousMaximum = 0;
    for (const [index, range] of group.entries()) {
      const maximum = range.maxQty ?? OPEN_MAXIMUM;
      if (!Number.isSafeInteger(range.minQty) || range.minQty !== previousMaximum + 1 ||
          !Number.isSafeInteger(maximum) || maximum < range.minQty ||
          (index === 9 ? maximum !== OPEN_MAXIMUM : maximum >= OPEN_MAXIMUM)) {
        return '阶梯上界须大于上一档且小于下一档，请调整数量范围。';
      }
      previousMaximum = maximum;
    }
  }
  const anchor = normalized[0]!;
  if (normalized.some(group => group.some((range, index) =>
    range.minQty !== anchor[index]!.minQty ||
    (range.maxQty ?? OPEN_MAXIMUM) !== (anchor[index]!.maxQty ?? OPEN_MAXIMUM)))) {
    return '各规格的阶梯范围不一致，请统一对应档位上界。';
  }
  return null;
}
