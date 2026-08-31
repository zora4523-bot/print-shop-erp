// 款式级外协数量覆盖校验。OutsourceOrderItemSnapshot 是权威的
// 不可变账本，覆盖量必须以 itemSnapshots.quantity 判定。
// OutsourceOrder.orderItemIds 只是为现有读路径保留的非规范化兼容缓存，
// 写路径仍然双写，但不得用它驱动覆盖判定。
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

// 调用方必须**先**把范围收敛到「本工单 + 未取消」
// 的外协单再传进来：OutsourceOrder.orderId 是可空的，别的工单的、以及
// 根本没挂工单的外协单不能算数。
export type OutsourceQuantityCoverageLink = {
  itemSnapshots: Array<{ orderItemId: string; quantity: number }>;
};

/**
 * 是否对这张工单适用款式级外协覆盖校验。
 *
 * requiresOutsource 是**生产工序首次物化时的快照**，且没有重算路径，
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

// 字典里查不到的 craftId（直连 SQL 删过工艺留下的脏数据）不会进
// outsourceCraftIds，因此按「不需要外协」处理——fail-open 是刻意的：
// 让一行字典空洞把工单永久卡在生产中、且 UI 上无法自救，比漏判一次更糟。
// Craft 目前没有删除入口（lib/craft.ts 只有 create/update），这条路径
// 正常不可达。
export function itemRequiresOutsource(
  item: { crafts: string[] },
  outsourceCraftIds: ReadonlySet<string>,
): boolean {
  return item.crafts.some((craftId) => outsourceCraftIds.has(craftId));
}

/**
 * 按外协单创建时的不可变逐款数量快照判定履约覆盖。
 *
 * 粒度仍是业主已接受的“款式”，不是“款式 × 外协工艺”；只是把
 * 旧的布尔链接升级为数量账本。工单后续增量或新增款式不会改写快照，
 * 因此不能被一张早已 RECEIVED 的外协单冒领。
 */
export function findUndercoveredOutsourceItems<
  T extends OutsourceCoverageItem & { quantity: number },
>(
  items: readonly T[],
  outsourceCraftIds: ReadonlySet<string>,
  outsourceOrders: readonly OutsourceQuantityCoverageLink[],
): T[] {
  if (outsourceCraftIds.size === 0) return [];

  // createOutsourceOrder 强制每张单的款式数量 = 当时工单数量，不支持
  // “部分数量”外协单。因此多张单之间要取 max，不能求和：同一
  // 款式两道外协工艺可能各有一张冻结 100 的旧单，工单增到 200 后
  // 若求和会凭空把 100 的增量算成已履约。
  const coveredQuantityByItemId = new Map<string, number>();
  for (const row of outsourceOrders) {
    for (const snapshot of row.itemSnapshots) {
      // 正常数据还有 DB CHECK。这里仍 fail-closed，防止旧 mock/脱离
      // migration 的导入把 NaN、0 或负数当成已履约数量。
      if (!Number.isSafeInteger(snapshot.quantity) || snapshot.quantity <= 0) {
        continue;
      }
      coveredQuantityByItemId.set(
        snapshot.orderItemId,
        Math.max(
          coveredQuantityByItemId.get(snapshot.orderItemId) ?? 0,
          snapshot.quantity,
        ),
      );
    }
  }

  return items.filter((item) => {
    if (!itemRequiresOutsource(item, outsourceCraftIds)) return false;
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) return true;
    return (coveredQuantityByItemId.get(item.id) ?? 0) < item.quantity;
  });
}

// 混合工艺（isOutsource === true 且 inHouseMachineTypes 非空）**也算**
// 需要外协：首次物化生产工序时会写入 Order.requiresOutsource
// 快照；混合工艺语义上仍是「一部分发出去」，必须纳入覆盖判定。
export function collectOutsourceCraftIds(
  crafts: readonly { id: string; isOutsource: boolean }[],
): Set<string> {
  return new Set(
    crafts.flatMap((craft) => (craft.isOutsource ? [craft.id] : [])),
  );
}
