// Structural row shape instead of CreateOrderInput: createOrderSchema itself
// uses the name check below, so importing the schema type would form a cycle.
type Item = { designGroupKey?: string | null };
type NamedItem = Item & { name: string };

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

export function duplicateDesignNameMessage(name: string): string {
  return `设计款名称不能重复：${name}`;
}

/**
 * 设计款名称在一张工单内唯一（业主 2026-09-26）。同一设计款的规格行共用名称，
 * 组内不互相比较，也不要求一致（旧草稿可能各行不同）；不同设计款之间按去首尾空白、
 * 忽略大小写比较。空名称交给款式名必填规则，这里不计入。每个与前面设计款撞名的
 * 设计款只报一次，定位到它的首行。
 */
export function findDuplicateDesignNames(items: readonly NamedItem[]): { index: number; name: string }[] {
  const earlier = new Set<string>();
  const duplicates: { index: number; name: string }[] = [];
  for (const group of orderDesignGroups(items)) {
    const names = new Map<string, string>();
    for (const index of group.indexes) {
      const name = items[index].name.trim();
      const normalized = name.toLocaleLowerCase('zh-CN');
      if (name && !names.has(normalized)) names.set(normalized, name);
    }
    const clash = [...names].find(([normalized]) => earlier.has(normalized));
    if (clash) duplicates.push({ index: group.indexes[0], name: clash[1] });
    for (const normalized of names.keys()) earlier.add(normalized);
  }
  return duplicates;
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
