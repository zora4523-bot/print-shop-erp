import type { CreateOrderInput } from '@/lib/auth/schemas';

type Item = CreateOrderInput['items'][number];

/** Missing keys are historical independent designs, never an implicit group. */
export function orderDesignGroups(items: readonly Item[]) {
  const groups = new Map<string, { key: string; indexes: number[] }>();
  items.forEach((item, index) => {
    const key = item.designGroupKey ?? `legacy:${index}`;
    const group = groups.get(key) ?? { key, indexes: [] };
    group.indexes.push(index);
    groups.set(key, group);
  });
  return [...groups.values()];
}

export function designItemIndexes(items: readonly Item[], index: number): number[] {
  return orderDesignGroups(items).find((group) => group.indexes.includes(index))?.indexes ?? [index];
}

/** Fan out selected files before creation; upload retries retain only failed files. */
export function designFileQueues<T>(items: readonly Item[], fields: readonly { id: string }[], queues: Readonly<Record<string, T[]>>): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const group of orderDesignGroups(items)) {
    const files = group.indexes.map((index) => queues[fields[index]?.id]).find((queue) => queue?.length) ?? [];
    for (const index of group.indexes) if (fields[index]) result[fields[index].id] = files;
  }
  return result;
}
