import { describe, it, expect } from 'vitest';
import {
  collectOutsourceCraftIds,
  findUndercoveredOutsourceItems,
  itemRequiresOutsource,
  outsourceCoverageApplies,
} from '../coverage';

describe('collectOutsourceCraftIds', () => {
  it('只收 isOutsource === true 的 id', () => {
    const ids = collectOutsourceCraftIds([
      { id: 'craft-foil', isOutsource: false },
      { id: 'craft-uv', isOutsource: true },
      { id: 'craft-glue', isOutsource: false },
    ]);
    expect([...ids]).toEqual(['craft-uv']);
  });

  it('混合工艺（isOutsource=true 且有自产机台）同样收入', () => {
    // 混合工艺在 scheduleOrder 里既计入 skippedOutsourceCrafts、又生成
    // 内部任务，语义上就是「一部分发出去」，必须参与覆盖判定。
    const ids = collectOutsourceCraftIds([
      { id: 'craft-mixed', isOutsource: true },
    ]);
    expect(ids.has('craft-mixed')).toBe(true);
  });

  it('空数组得到空集合', () => {
    expect(collectOutsourceCraftIds([]).size).toBe(0);
  });
});

describe('outsourceCoverageApplies', () => {
  it('requiresOutsource === true 才适用', () => {
    expect(outsourceCoverageApplies({ requiresOutsource: true })).toBe(true);
  });

  it('false / undefined 一律不适用 —— 闸口与横幅必须共用这一条', () => {
    expect(outsourceCoverageApplies({ requiresOutsource: false })).toBe(false);
    expect(outsourceCoverageApplies({})).toBe(false);
  });
});

describe('itemRequiresOutsource', () => {
  it('款式的任一工艺在外协集合里即算需要外协', () => {
    expect(
      itemRequiresOutsource(
        { crafts: ['craft-foil', 'craft-uv'] },
        new Set(['craft-uv']),
      ),
    ).toBe(true);
  });

  it('全是自产工艺则不需要', () => {
    expect(
      itemRequiresOutsource(
        { crafts: ['craft-foil', 'craft-glue'] },
        new Set(['craft-uv']),
      ),
    ).toBe(false);
  });
});

describe('findUndercoveredOutsourceItems', () => {
  const quantityItem = (
    quantity: number,
    crafts: string[] = ['craft-uv'],
  ) => ({
    id: 'item-1',
    sequence: 1,
    name: '款式一',
    quantity,
    crafts,
  });

  it('【残留缺口回归锁定】同款式两道外协工艺仍按款式数量覆盖', () => {
    expect(
      findUndercoveredOutsourceItems(
        [quantityItem(100, ['craft-uv', 'craft-emboss'])],
        new Set(['craft-uv', 'craft-emboss']),
        [
          {
            itemSnapshots: [{ orderItemId: 'item-1', quantity: 100 }],
          },
        ],
      ),
    ).toEqual([]);
  });

  it('创建时冻结 100，后续增单到 200 时仍有 100 未履约', () => {
    expect(
      findUndercoveredOutsourceItems(
        [quantityItem(200)],
        new Set(['craft-uv']),
        [
          {
            itemSnapshots: [{ orderItemId: 'item-1', quantity: 100 }],
          },
        ],
      ).map((row) => row.id),
    ).toEqual(['item-1']);
  });

  it('多张旧单不得累加冒领变更后的增量', () => {
    expect(
      findUndercoveredOutsourceItems(
        [quantityItem(200)],
        new Set(['craft-uv']),
        [
          {
            itemSnapshots: [{ orderItemId: 'item-1', quantity: 100 }],
          },
          {
            itemSnapshots: [{ orderItemId: 'item-1', quantity: 100 }],
          },
        ],
      ).map((row) => row.id),
    ).toEqual(['item-1']);
  });

  it('只要有一张新单冻结了变更后的完整数量就算覆盖', () => {
    expect(
      findUndercoveredOutsourceItems(
        [quantityItem(200)],
        new Set(['craft-uv']),
        [
          {
            itemSnapshots: [{ orderItemId: 'item-1', quantity: 100 }],
          },
          {
            itemSnapshots: [{ orderItemId: 'item-1', quantity: 200 }],
          },
        ],
      ),
    ).toEqual([]);
  });

  it('缺失或非法数量快照 fail-closed，不当成已覆盖', () => {
    expect(
      findUndercoveredOutsourceItems(
        [quantityItem(100)],
        new Set(['craft-uv']),
        [
          {
            itemSnapshots: [{ orderItemId: 'item-1', quantity: 0 }],
          },
        ],
      ).map((row) => row.id),
    ).toEqual(['item-1']);
  });
});
