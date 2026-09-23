import type { CreateOrderInput } from '@/lib/auth/schemas';
import { OrderPackagingMode } from '@/generated/prisma/enums';
import { calculateCreateOrderBagCount } from './create-order-packaging';
import {
  isMixedPackaging, packagingBoxType, packagingCapacity, packagingModeFor, packagingType,
  packagingModeWithStyleCount, type PackagingBoxType, type PackagingType,
} from './packaging-mode';

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

// ─── 整单包装区（DECISIONS 2026-09-23）───
// 包装在设计款标签外按整单编辑：顶部类型/方式默认作用于全部规格，单个规格
// 可单独改类型。底层仍是按规格组成的包装组，袋数、生产、打印口径不变。

export type OrderPackagingSelection = {
  /** null：各规格当前的包装类型不一致。 */
  type: PackagingType | null;
  box: PackagingBoxType | null;
  /** null：部分规格混装、部分单独装，或全部不包装。 */
  mixing: 'SINGLE_STYLE' | 'MIXED_STYLE' | null;
};

function itemPackagingMode(groups: readonly Group[], itemIndex: number): OrderPackagingMode {
  return groups[createPackagingGroupIndex(groups, itemIndex)]?.mode ?? OrderPackagingMode.SINGLE_STYLE;
}

/** Shared controls show a value only when every specification agrees. */
export function orderPackagingSelection(groups: readonly Group[], itemCount: number): OrderPackagingSelection {
  const indexes = Array.from({ length: itemCount }, (_, index) => index);
  const modes = indexes.map((index) => itemPackagingMode(groups, index));
  const types = new Set(modes.map(packagingType));
  const boxes = new Set(modes.flatMap((mode) => packagingBoxType(mode) ?? []));
  const packedGroups = indexes
    .filter((index) => packagingType(modes[index]) !== 'UNPACKED')
    .map((index) => createPackagingGroupIndex(groups, index));
  const mixedGroups = new Set(packedGroups.filter((group) => group >= 0 && isMixedPackaging(groups[group].mode)));
  const mixing = packedGroups.length === 0 ? null
    : mixedGroups.size === 0 ? 'SINGLE_STYLE'
      : mixedGroups.size === 1 && packedGroups.every((group) => mixedGroups.has(group)) ? 'MIXED_STYLE'
        : null;
  const type = types.size === 1 ? [...types][0] : null;
  return { type, box: type === 'BOX' && boxes.size === 1 ? [...boxes][0] : null, mixing };
}

/** 整单类型：每个规格都跟随；已混装的组保留组成，只换类型。 */
export function applyOrderPackagingType(
  groups: readonly Group[], itemCount: number, type: PackagingType, box: PackagingBoxType = 'RED_CARD',
): Group[] {
  let next = [...groups];
  for (let index = 0; index < itemCount; index += 1) {
    const current = next[createPackagingGroupIndex(next, index)];
    const target = packagingModeFor(type, current ? isMixedPackaging(current.mode) : false, box);
    if (current?.mode !== target) next = changeCreatePackagingMode(next, itemCount, index, target);
  }
  return next;
}

/** 混装明确覆盖整单全部规格；常规装把每个混装组拆回单个规格。 */
export function applyOrderPackagingMixing(groups: readonly Group[], itemCount: number, mixed: boolean): Group[] {
  if (!mixed) {
    let next = [...groups];
    for (let index = 0; index < itemCount; index += 1) {
      const current = next[createPackagingGroupIndex(next, index)];
      if (current && isMixedPackaging(current.mode)) {
        next = changeCreatePackagingMode(next, itemCount, index, packagingModeWithStyleCount(current.mode, 1));
      }
    }
    return next;
  }
  const selection = orderPackagingSelection(groups, itemCount);
  if (itemCount < 2 || selection.mixing === 'MIXED_STYLE') return [...groups];
  const indexes = Array.from({ length: itemCount }, (_, index) => index);
  const source = indexes.map((index) => itemPackagingMode(groups, index)).find((mode) => packagingType(mode) !== 'UNPACKED');
  const type = selection.type && selection.type !== 'UNPACKED' ? selection.type : source ? packagingType(source) : 'BAG';
  const target = packagingModeFor(type, true, selection.box ?? (source ? packagingBoxType(source) : null) ?? 'RED_CARD');
  const entry = indexes.find((index) => !isMixedPackaging(itemPackagingMode(groups, index))) ?? 0;
  return changeCreatePackagingMode(groups, itemCount, entry, target);
}

/** 单个规格改类型；混装组内的规格跟随整单设置，不单独改。 */
export function applySpecPackagingType(
  groups: readonly Group[], itemCount: number, itemIndex: number, type: PackagingType, box: PackagingBoxType = 'RED_CARD',
): Group[] {
  const current = groups[createPackagingGroupIndex(groups, itemIndex)];
  if (current && isMixedPackaging(current.mode)) return [...groups];
  return changeCreatePackagingMode(groups, itemCount, itemIndex, packagingModeFor(type, false, box));
}

type CreatePackagingRow = {
  groupIndex: number;
  mode: OrderPackagingMode;
  unitsPerBag: number;
  /** 所在包装组的袋/盒数；不包装为 0，组成不完整时为 null。 */
  bagCount: number | null;
  error: string | null;
};

/** One row per specification, derived from the same bag-count rules the quote uses. */
export function createPackagingRows(input: {
  groups: readonly Group[];
  itemQuantities: readonly number[];
  shipmentQuantities?: readonly (readonly number[])[];
}): CreatePackagingRow[] {
  const results = input.groups.map((group) => calculateCreateOrderBagCount({
    mode: group.mode,
    itemQuantities: input.itemQuantities,
    itemUnitsPerBag: group.itemUnitsPerBag,
    shipmentQuantities: input.shipmentQuantities,
  }));
  return input.itemQuantities.map((_, index) => {
    const groupIndex = createPackagingGroupIndex(input.groups, index);
    const group = input.groups[groupIndex];
    const result = results[groupIndex];
    return {
      groupIndex,
      mode: group?.mode ?? OrderPackagingMode.SINGLE_STYLE,
      unitsPerBag: group?.itemUnitsPerBag[index] ?? 0,
      bagCount: result?.complete ? result.bagCount : null,
      error: result && !result.complete ? result.errors.join('；') : null,
    };
  });
}

/** 例：合计 3,000 个 · 3 个设计款 / 4 个规格 · 300 包 + 20 盒 */
export function summarizeCreatePackaging(input: {
  rows: readonly CreatePackagingRow[];
  itemQuantities: readonly number[];
  designCount: number;
}): string {
  const count = (value: number) => value.toLocaleString('zh-CN');
  const total = input.itemQuantities.reduce((sum, quantity) => sum + (Number.isFinite(quantity) ? quantity : 0), 0);
  const groups = new Map<number, CreatePackagingRow>();
  for (const row of input.rows) {
    if (row.groupIndex >= 0 && !groups.has(row.groupIndex)) groups.set(row.groupIndex, row);
  }
  const packed = [...groups.values()].filter((row) => row.mode !== OrderPackagingMode.UNPACKED);
  const unfinished = input.rows.some((row) => row.groupIndex < 0) || packed.some((row) => row.bagCount === null);
  const sum = (box: boolean) => packed
    .filter((row) => (packagingBoxType(row.mode) !== null) === box)
    .reduce((subtotal, row) => subtotal + (row.bagCount ?? 0), 0);
  const packing = unfinished
    ? '包数待定'
    : packed.length === 0
      ? '不包装'
      : [sum(false) ? `${count(sum(false))} 包` : null, sum(true) ? `${count(sum(true))} 盒` : null].filter(Boolean).join(' + ');
  return `合计 ${count(total)} 个 · ${input.designCount} 个设计款 / ${input.rows.length} 个规格 · ${packing}`;
}
