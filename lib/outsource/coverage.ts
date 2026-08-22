// 款式级外协覆盖校验（业主 2026-08-21 拍板：不改表，用现有
// OrderItem.crafts 与 OutsourceOrder.orderItemIds 两个 String[] 比对）。
//
// 纯函数、零依赖：完工闸口（lib/production-completion.ts）与读路径
// （lib/order.ts 的 getOrderDetail → 工单详情页横幅）共用同一份判定，
// 避免「页面说能完工、闸口说不能」的两套逻辑漂移。
//
// ⚠️ 已知残留缺口（业主接受，见 DECISIONS 2026-08-21）：判定粒度是
// **款式**，不是「款式 × 外协工艺」。同一款式有两道外协工艺、只发出去
// 一道时，该款式已算被覆盖，闸口放行。要堵这个口子必须给
// OutsourceOrder 加 craftIds 字段（改表），后续再议——不要以为这是 bug
// 顺手「修」成按工艺判定：craftDescription 是自由文本，所有历史外协单都没有
// 结构化工艺，那样会把在产工单集体卡死。
// 该缺口由 __tests__/coverage.test.ts 里的「残留缺口回归锁定」用例钉住。

export type OutsourceCoverageItem = {
  id: string;
  sequence: number;
  name: string;
  crafts: string[];
};

// 只需要 orderItemIds。调用方必须**先**把范围收敛到「本工单 + 未取消」
// 的外协单再传进来：OutsourceOrder.orderId 是可空的，别的工单的、以及
// 根本没挂工单的外协单不能算数。
export type OutsourceCoverageLink = {
  orderItemIds: string[];
};

/**
 * 是否对这张工单适用款式级外协覆盖校验。
 *
 * requiresOutsource 是**排产那一刻的快照**，且没有重算路径
 * （scheduleOrder 对已排产工单必抛 InvalidOrderTransitionError），
 * 而 lib/craft.ts 的 updateCraft 允许把 isOutsource 从 false 翻成 true。
 * 闸口只在它为真时校验，读路径必须用同一个谓词——否则会出现
 * 「页面说不能完工、闸口其实照样完工」的反向漂移，而主管照提示
 * 补出来的外协单会带 amount，变成一笔凭空的外协应付。
 */
export function outsourceCoverageApplies(order: {
  requiresOutsource?: boolean;
}): boolean {
  return order.requiresOutsource === true;
}

export function itemRequiresOutsource(
  item: { crafts: string[] },
  outsourceCraftIds: ReadonlySet<string>,
): boolean {
  return item.crafts.some((craftId) => outsourceCraftIds.has(craftId));
}

// 字典里查不到的 craftId（直连 SQL 删过工艺留下的脏数据）不会进
// outsourceCraftIds，因此按「不需要外协」处理——fail-open 是刻意的：
// 让一行字典空洞把工单永久卡在生产中、且 UI 上无法自救，比漏判一次更糟。
// Craft 目前没有删除入口（lib/craft.ts 只有 create/update），这条路径
// 正常不可达。
export function findUncoveredOutsourceItems<T extends OutsourceCoverageItem>(
  items: readonly T[],
  outsourceCraftIds: ReadonlySet<string>,
  outsourceOrders: readonly OutsourceCoverageLink[],
): T[] {
  if (outsourceCraftIds.size === 0) return [];
  const coveredItemIds = new Set<string>();
  for (const row of outsourceOrders) {
    // 一张外协单可以覆盖多个款式；不属于本工单的 orderItemIds（历史误填）
    // 不会与 items 相交，天然被忽略。
    for (const itemId of row.orderItemIds) coveredItemIds.add(itemId);
  }
  return items.filter(
    (item) =>
      itemRequiresOutsource(item, outsourceCraftIds) &&
      !coveredItemIds.has(item.id),
  );
}

// 混合工艺（isOutsource === true 且 inHouseMachineTypes 非空）**也算**
// 需要外协：它在 scheduleOrder 里同时计入 skippedOutsourceCrafts（决定
// Order.requiresOutsource 快照）并生成内部任务，语义上就是「一部分发出去」。
export function collectOutsourceCraftIds(
  crafts: readonly { id: string; isOutsource: boolean }[],
): Set<string> {
  return new Set(
    crafts.flatMap((craft) => (craft.isOutsource ? [craft.id] : [])),
  );
}
