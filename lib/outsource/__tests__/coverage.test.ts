import { describe, it, expect } from 'vitest';
import {
  collectOutsourceCraftIds,
  findUncoveredOutsourceItems,
  itemRequiresOutsource,
  outsourceCoverageApplies,
} from '../coverage';

function item(
  id: string,
  sequence: number,
  name: string,
  crafts: string[],
) {
  return { id, sequence, name, crafts };
}

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

describe('findUncoveredOutsourceItems', () => {
  it('没有任何外协工艺时直接返回空数组', () => {
    expect(
      findUncoveredOutsourceItems(
        [item('item-1', 1, '款式一', ['craft-foil'])],
        new Set<string>(),
        [],
      ),
    ).toEqual([]);
  });

  it('单款式单外协工艺、已被一张外协单覆盖 → 返回空', () => {
    expect(
      findUncoveredOutsourceItems(
        [item('item-1', 1, '款式一', ['craft-uv'])],
        new Set(['craft-uv']),
        [{ orderItemIds: ['item-1'] }],
      ),
    ).toEqual([]);
  });

  it('单款式单外协工艺、没有任何外协单 → 返回该款式（含 sequence/name 供 UI 渲染）', () => {
    expect(
      findUncoveredOutsourceItems(
        [item('item-1', 1, '款式一', ['craft-uv'])],
        new Set(['craft-uv']),
        [],
      ),
    ).toEqual([
      { id: 'item-1', sequence: 1, name: '款式一', crafts: ['craft-uv'] },
    ]);
  });

  it('一张外协单的 orderItemIds 含多个款式 → 这些款式全部算已覆盖', () => {
    expect(
      findUncoveredOutsourceItems(
        [
          item('item-1', 1, '款式一', ['craft-uv']),
          item('item-2', 2, '款式二', ['craft-uv']),
        ],
        new Set(['craft-uv']),
        [{ orderItemIds: ['item-1', 'item-2'] }],
      ),
    ).toEqual([]);
  });

  it('两张外协单各覆盖一个款式，第三个没人管 → 只返回第三个', () => {
    const result = findUncoveredOutsourceItems(
      [
        item('item-1', 1, '款式一', ['craft-uv']),
        item('item-2', 2, '款式二', ['craft-uv']),
        item('item-3', 3, '款式三', ['craft-uv']),
      ],
      new Set(['craft-uv']),
      [{ orderItemIds: ['item-1'] }, { orderItemIds: ['item-2'] }],
    );
    expect(result.map((row) => row.id)).toEqual(['item-3']);
    expect(result[0]?.sequence).toBe(3);
  });

  it('外协单里混入不属于本工单的 id → 不会误判为覆盖', () => {
    const result = findUncoveredOutsourceItems(
      [item('item-1', 1, '款式一', ['craft-uv'])],
      new Set(['craft-uv']),
      [{ orderItemIds: ['item-from-another-order'] }],
    );
    expect(result.map((row) => row.id)).toEqual(['item-1']);
  });

  it('款式的 crafts 全是自产工艺 → 即使一张外协单都没有也返回空', () => {
    expect(
      findUncoveredOutsourceItems(
        [item('item-1', 1, '款式一', ['craft-foil', 'craft-glue'])],
        new Set(['craft-uv']),
        [],
      ),
    ).toEqual([]);
  });

  it('crafts 含字典里查不到的 craftId → 按不需要外协处理（fail-open）', () => {
    // Craft 没有删除入口（lib/craft.ts 只有 create/update），这条路径正常
    // 不可达。真出现脏数据时宁可漏判一次，也不要让工单永久卡在生产中且
    // UI 上无法自救。行为在此锁定。
    expect(
      findUncoveredOutsourceItems(
        [item('item-1', 1, '款式一', ['craft-vanished'])],
        new Set(['craft-uv']),
        [],
      ),
    ).toEqual([]);
  });

  it('【残留缺口回归锁定】同款式两道外协工艺、只发一道时仍放行', () => {
    // 业主 2026-08-21 明确接受：判定粒度是**款式**而非「款式 × 工艺」。
    // 这条用例不是在描述正确行为，而是在钉住一个已知缺口——看到它变红
    // 说明有人把判定改成了工艺级。堵这个口子必须先给 OutsourceOrder 加
    // craftIds（改表），且历史外协单的 craftDescription 是自由文本、无法
    // 回填，强行升级会把在产工单集体卡死。详见 DECISIONS 2026-08-21。
    expect(
      findUncoveredOutsourceItems(
        [item('item-1', 1, '款式一', ['craft-uv', 'craft-emboss'])],
        new Set(['craft-uv', 'craft-emboss']),
        [{ orderItemIds: ['item-1'] }],
      ),
    ).toEqual([]);
  });

  it('CANCELLED 外协单必须由调用方先过滤 —— 传进来就会算覆盖', () => {
    // 这条锁的是契约而不是实现：coverage.ts 不认识 status，
    // lib/production-completion.ts 与 lib/order.ts 都必须在传入前
    // 把 CANCELLED 过滤掉。
    expect(
      findUncoveredOutsourceItems(
        [item('item-1', 1, '款式一', ['craft-uv'])],
        new Set(['craft-uv']),
        [{ orderItemIds: ['item-1'] }],
      ),
    ).toEqual([]);
  });
});
