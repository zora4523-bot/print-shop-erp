import type { CreateOrderInput } from '@/lib/auth/schemas';
import { OrderPackagingMode } from '@/generated/prisma/enums';
import { isMixedPackaging, packagingBoxType, packagingCapacity, packagingType, packagingModeWithStyleCount } from './packaging-mode';

type Group = CreateOrderInput['packagingGroups'][number];

/** Resolve by membership, never let another design's mixed group win. */
export function createPackagingGroupIndex(groups: readonly Group[], itemIndex: number): number {
  const member = groups.findIndex((group) => (group.itemUnitsPerBag[itemIndex] ?? 0) > 0);
  if (member >= 0) return member;
  // Zero is an unfinished field, not a request to move that spec to another group.
  const emptyGroups = groups.flatMap((group, index) => group.itemUnitsPerBag.every((units) => units === 0) ? [index] : []);
  const unassigned = Array.from({ length: groups[0]?.itemUnitsPerBag.length ?? 0 }, (_, index) => index)
    .filter((index) => !groups.some((group) => (group.itemUnitsPerBag[index] ?? 0) > 0));
  if (!unassigned.includes(itemIndex)) return -1;
  if (emptyGroups.length === 1 && isMixedPackaging(groups[emptyGroups[0]].mode)) return emptyGroups[0];
  if (emptyGroups.length === unassigned.length) return emptyGroups[unassigned.indexOf(itemIndex)] ?? -1;
  const mixedGroups = groups.flatMap((group, index) => isMixedPackaging(group.mode) ? [index] : []);
  return emptyGroups.length === 0 && mixedGroups.length === 1 ? mixedGroups[0] : -1;
}

/** Regular edits are local; entering mixed mode explicitly combines all specifications. */
export function changeCreatePackagingMode(groups: readonly Group[], itemCount: number, activeIndex: number, mode: OrderPackagingMode): Group[] {
  const groupIndex = createPackagingGroupIndex(groups, activeIndex);
  const current = groups[groupIndex];
  if (current?.mode === mode || (isMixedPackaging(mode) && itemCount < 2)) return [...groups];
  const enteringMixed = isMixedPackaging(mode) && !isMixedPackaging(current?.mode ?? OrderPackagingMode.SINGLE_STYLE);
  const members = enteringMixed ? Array.from({ length: itemCount }, (_, index) => index)
    : current && isMixedPackaging(current.mode)
      ? Array.from({ length: itemCount }, (_, index) => index).filter((index) => createPackagingGroupIndex(groups, index) === groupIndex)
      : [activeIndex];
  const units = Array.from({ length: itemCount }, (_, index) => {
    if (!members.includes(index)) return 0;
    const previousGroup = groups[createPackagingGroupIndex(groups, index)];
    const rawUnits = previousGroup?.itemUnitsPerBag[index] ?? 10;
    const previous = rawUnits > 0 ? rawUnits : 10;
    const switchingType = !previousGroup || packagingType(mode) !== packagingType(previousGroup.mode) || packagingBoxType(mode) !== packagingBoxType(previousGroup.mode);
    return switchingType ? Math.min(previous, packagingCapacity(mode) ?? 10) : previous;
  });
  const changed: Group[] = isMixedPackaging(mode)
    ? [{ name: current?.name ?? null, mode, actualBagCount: 1, itemUnitsPerBag: units }]
    : members.map((index) => ({ name: current?.name ?? null, mode,
      actualBagCount: mode === OrderPackagingMode.UNPACKED ? 0 : 1,
      itemUnitsPerBag: units.map((value, candidate) => candidate === index ? value : 0) }));
  if (enteringMixed) return changed;
  if (groupIndex < 0) return [...groups, ...changed];
  return groups.flatMap((group, index) => index === groupIndex ? changed : [group]);
}

/** New designs/specs start separately, even when their source belongs to a mixed group. */
export function appendCreatePackagingGroup(groups: readonly Group[], sourceIndex: number, itemCount: number): Group[] {
  const source = groups[createPackagingGroupIndex(groups, sourceIndex)];
  const mode = packagingModeWithStyleCount(source?.mode ?? OrderPackagingMode.SINGLE_STYLE, 1);
  return [...groups.map((group) => ({ ...group, itemUnitsPerBag: [...group.itemUnitsPerBag, 0] })), {
    name: null, mode, actualBagCount: mode === OrderPackagingMode.UNPACKED ? 0 : 1,
    itemUnitsPerBag: Array.from({ length: itemCount + 1 }, (_, index) => index === itemCount ? (source?.itemUnitsPerBag[sourceIndex] ?? 10) : 0),
  }];
}
