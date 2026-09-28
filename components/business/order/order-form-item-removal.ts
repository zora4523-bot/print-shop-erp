import { orderDesignGroups } from '@/lib/order/design-groups';

type Item = { designGroupKey?: string | null };

/** Derive every index from the pre-removal rows, including interleaved designs. */
export function planOrderItemRemoval(items: readonly Item[], indexes: readonly number[], activeIndex: number) {
  if (indexes.length === 0 || indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= items.length)) return null;
  const removed = new Set(indexes);
  const keptIndexes = items.flatMap((_, index) => removed.has(index) ? [] : [index]);
  if (keptIndexes.length === 0) return null;
  const groups = orderDesignGroups(items);
  const activeGroupIndex = groups.findIndex((group) => group.indexes.includes(activeIndex));
  const siblings = groups[activeGroupIndex]?.indexes.filter((index) => !removed.has(index)) ?? [];
  const adjacentGroups = [...groups.slice(activeGroupIndex + 1), ...groups.slice(0, activeGroupIndex).reverse()];
  const nextOriginalIndex = keptIndexes.includes(activeIndex) ? activeIndex
    : siblings.find((index) => index > activeIndex) ?? siblings.at(-1)
      ?? adjacentGroups.flatMap((group) => group.indexes).find((index) => !removed.has(index))
      ?? keptIndexes[0];
  return {
    removedIndexes: [...removed].sort((a, b) => a - b),
    keptIndexes,
    activeIndex: keptIndexes.indexOf(nextOriginalIndex),
  };
}

/** Legacy keys are index-based; move their explicit naming decisions before following the order name. */
export function remapDesignNameRecords(items: readonly Item[], keptIndexes: readonly number[], records: ReadonlyMap<string, boolean>) {
  const next = new Map<string, boolean>();
  keptIndexes.forEach((oldIndex, newIndex) => {
    const key = items[oldIndex].designGroupKey;
    const value = records.get(key ?? `legacy:${oldIndex}`);
    if (value !== undefined) next.set(key ?? `legacy:${newIndex}`, value);
  });
  return next;
}
