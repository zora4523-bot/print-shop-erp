import type { CreateOrderInput } from '@/lib/auth/schemas';
import { orderDesignGroups } from '@/lib/order/design-groups';

type Item = Pick<CreateOrderInput['items'][number], 'designGroupKey' | 'name'>;

/** Same cap as the create schema's item name (`款式名过长（最多 64 个字符）`). */
export const DESIGN_NAME_MAX_LENGTH = 64;

type DesignNameIssue = {
  /** First row of the design; the name input binds to it. */
  index: number;
  /** 1-based design number, matching the `设计款 N` tabs. */
  designNumber: number;
  kind: 'missing' | 'too-long' | 'duplicate';
  message: string;
};

/** 与 `findDuplicateDesignNames`（服务端规则）相同的比较口径。 */
function comparableName(name: string): string {
  return name.trim().toLocaleLowerCase('zh-CN');
}

/**
 * 设计款名称由建单人填写（DECISIONS 2026-09-26）：每个设计款必填、最多 64 个字符、
 * 一张工单内不重名。同一设计款的规格行共用名称，只看首行。重名时每个撞名的设计款
 * 都提示，改哪一个都能在当前输入框看到。
 */
export function designNameIssues(items: readonly Item[]): DesignNameIssue[] {
  const groups = orderDesignGroups(items);
  const namesByDesign = groups.map((group) => items[group.indexes[0]]?.name?.trim() ?? '');
  const designCounts = new Map<string, number>();
  for (const name of namesByDesign) {
    if (name) designCounts.set(comparableName(name), (designCounts.get(comparableName(name)) ?? 0) + 1);
  }
  const issues: DesignNameIssue[] = [];
  groups.forEach((group, position) => {
    const index = group.indexes[0];
    const designNumber = position + 1;
    const name = namesByDesign[position];
    if (!name) {
      issues.push({ index, designNumber, kind: 'missing', message: '请填写设计款名称' });
    } else if (name.length > DESIGN_NAME_MAX_LENGTH) {
      issues.push({
        index, designNumber, kind: 'too-long',
        message: `设计款名称最多 ${DESIGN_NAME_MAX_LENGTH} 个字符`,
      });
    } else if ((designCounts.get(comparableName(name)) ?? 0) > 1) {
      issues.push({ index, designNumber, kind: 'duplicate', message: `与其他设计款重名：${name}` });
    }
  });
  return issues;
}

export function designNameIssueSummary(issue: DesignNameIssue): string {
  return `设计款 ${issue.designNumber}：${issue.message}`;
}

/**
 * 设计款是否已手动命名。本次编辑中有明确记录（输入过非空名称记为是，清空记为否，
 * 跟随工单名称后记为否）时以记录为准；没有记录时（刚恢复草稿、切换批量工单）按值推断：
 * 非空且不等于工单名称视为手动命名。
 */
export function isHandNamedDesign(
  name: string,
  orderName: string | null | undefined,
  recorded: boolean | undefined,
): boolean {
  if (recorded !== undefined) return recorded;
  const trimmed = name.trim();
  return Boolean(trimmed) && trimmed !== (orderName ?? '').trim();
}

/**
 * 只有一个设计款、且它未手动命名时，返回应跟随的工单名称及该设计款的规格行；
 * 否则返回 null。`orderNameForInference` 是推断“是否手动命名”时对照的工单名称
 * （改名时传修改前的值）。
 */
export function followingDesignName(
  items: readonly Item[],
  orderName: string | null | undefined,
  orderNameForInference: string | null | undefined,
  recordedHandNamed: (designKey: string) => boolean | undefined,
): { key: string; indexes: number[]; name: string } | null {
  const groups = orderDesignGroups(items);
  if (groups.length !== 1) return null;
  const [design] = groups;
  const current = items[design.indexes[0]]?.name ?? '';
  if (isHandNamedDesign(current, orderNameForInference, recordedHandNamed(design.key))) return null;
  return { key: design.key, indexes: design.indexes, name: (orderName ?? '').trim() };
}

/**
 * 同一设计款的规格行共用名称（业主规则 4）。旧版本地草稿里自动款名随规格不同，
 * 恢复时统一为该设计款首行的名称。
 */
export function unifyDesignNames<T extends Item>(items: readonly T[]): T[] {
  const next = [...items];
  for (const group of orderDesignGroups(items)) {
    const name = items[group.indexes[0]].name;
    for (const index of group.indexes.slice(1)) {
      if (next[index].name !== name) next[index] = { ...next[index], name };
    }
  }
  return next;
}

/**
 * RHF 校验失败时是否只有设计款名称（`items.N.name`）出错。保存草稿遇到这种情况只提示
 * 设计款名称与外部销售，其余提交阶段校验不打开。
 */
export function hasOnlyDesignNameErrors(errors: object): boolean {
  const keys = Object.keys(errors);
  if (keys.length !== 1 || keys[0] !== 'items') return false;
  const items: unknown = (errors as { items?: unknown }).items;
  if (!Array.isArray(items) || (items as { root?: unknown }).root !== undefined) return false;
  return items.every((entry) =>
    entry == null || (typeof entry === 'object' && Object.keys(entry).every((key) => key === 'name')));
}
