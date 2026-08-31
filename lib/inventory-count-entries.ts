import type { InventoryCountMaterialRow } from './inventory-count';

// 盘点页录入状态的纯逻辑层。刻意独立成文件（而不是塞进 lib/inventory-count.ts）：
// 那个文件 import 了 db，客户端组件一旦按值 import 就会把 Prisma client 拖进
// 浏览器包。这里只有 import type，node 环境可以直接测。

/** 表格行的 key，和服务端 `${materialId}:${locationId}` 同构。 */
export function countKey(materialId: string, locationId: string): string {
  return `${materialId}:${locationId}`;
}

export type CountEntry = {
  /** 操作员敲进去的实盘数原文（可能是半成品，例如 "12."） */
  value: string;
  /**
   * 这一格**首次展示**时的账面数，钉住不动。
   *
   * 之后的搜索/刷新只更新未录入行的显示值，已录入行的 book 不再被覆盖——否则
   * 回传给服务端的就不是「操作员数东西时看到的账面数」，CAS 恒等成立、守卫
   * 等于没装。这是整套守卫的支点，改这里之前先看 DECISIONS。
   */
  book: string;
};

export type BookQuantitySnapshots = Readonly<Record<string, string>>;

/**
 * 把本次查询首次展示的库位账面数合并进盘点会话快照。
 *
 * 后续搜索/刷新可以带回更新的 currentStock，但已经出现过的 key 绝不
 * 覆盖。否则操作员先数完、尚未输入时点「刷新」，首次录入就会把
 * 刷新后的库存冒充成盘点起点，服务端 CAS 恒等成立。
 */
export function pinDisplayedBookQuantities(
  current: BookQuantitySnapshots,
  rows: readonly InventoryCountMaterialRow[],
): Record<string, string> {
  let next: Record<string, string> | null = null;
  for (const row of rows) {
    for (const location of row.locations) {
      const key = countKey(row.id, location.locationId);
      if (current[key] !== undefined) continue;
      next ??= { ...current };
      next[key] = location.currentStock;
    }
  }
  return next ?? (current as Record<string, string>);
}

export type SubmittedCountItem = {
  materialId: string;
  locationId: string;
  /** 钉住的账面数，服务端拿它和加锁后的真实余额做 CAS */
  bookQuantity: string;
  countedQuantity: string;
};

/**
 * 实盘数输入框的宽松解析：允许 "12."、最多两位小数、非负。
 * 空串 / 非法一律返回 null（= 这一行没录入，不提交）。
 */
export function parseCountValue(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d{1,10}(\.\d{0,2})?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 两个账面数是不是同一个值（"5" 与 "5.00" 算同一个）。 */
export function sameBookQuantity(a: string, b: string): boolean {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return a === b;
  return left === right;
}

/**
 * 从当前表格数据 + 录入状态派生提交明细。
 *
 * bookQuantity 取 **entry.book**（这一行首次展示时钉住的账面数），**不是**
 * location.currentStock（最近一次 fetch 的显示值）。这两者在「录入后又刷新/
 * 搜索过」时会分叉，用后者等于把守卫关掉。
 */
export function buildSubmittedItems(
  rows: readonly InventoryCountMaterialRow[],
  counts: Readonly<Record<string, CountEntry>>,
): SubmittedCountItem[] {
  return rows.flatMap((row) =>
    row.locations.flatMap((location) => {
      const entry = counts[countKey(row.id, location.locationId)];
      const counted = parseCountValue(entry?.value ?? '');
      return counted === null || entry === undefined
        ? []
        : [
            {
              materialId: row.id,
              locationId: location.locationId,
              bookQuantity: entry.book,
              countedQuantity: counted.toFixed(2),
            },
          ];
    }),
  );
}
