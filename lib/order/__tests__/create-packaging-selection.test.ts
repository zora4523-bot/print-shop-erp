import { describe, expect, it } from 'vitest';
import {
  changeCreatePackagingMode, appendCreatePackagingGroup, createPackagingGroupIndex, orderPackagingSelection,
  applyOrderPackagingType, applyOrderPackagingMixing, applySpecPackagingType, createPackagingRows, summarizeCreatePackaging,
} from '../create-packaging-selection';
import { OrderPackagingMode as Mode } from '@/generated/prisma/enums';

const groups = [
  { name: null, mode: Mode.SINGLE_STYLE, actualBagCount: 100, itemUnitsPerBag: [10, 0] },
  { name: '保留包装', mode: Mode.BOX_TACTILE, actualBagCount: 20, itemUnitsPerBag: [0, 8] },
];
describe('规格包装隔离', () => {
  it('当前规格改为不包装不改变另一规格的盒型、数量和依据', () => {
    const result = changeCreatePackagingMode(groups, 2, 0, Mode.UNPACKED);
    expect(result[1]).toEqual(groups[1]);
    expect(result[0]).toMatchObject({ mode: Mode.UNPACKED, actualBagCount: 0, itemUnitsPerBag: [10, 0] });
  });
  it('整单混装仍是显式跨规格操作', () => {
    expect(changeCreatePackagingMode(groups, 2, 0, Mode.MIXED_STYLE)).toEqual([
      { name: null, mode: Mode.MIXED_STYLE, actualBagCount: 1, itemUnitsPerBag: [10, 8] },
    ]);
  });
});

it('从混装设计复制新规格时保留原组，新增规格单独包装', () => {
  const mixed = [{ name: null, mode: Mode.MIXED_STYLE, actualBagCount: 10, itemUnitsPerBag: [5, 5] }];
  const result = appendCreatePackagingGroup(mixed, 0, 2);
  expect(result.map((group) => group.itemUnitsPerBag)).toEqual([[5, 5, 0], [0, 0, 5]]);
  expect(result[1].mode).toBe(Mode.SINGLE_STYLE);
  expect(createPackagingGroupIndex(result, 2)).toBe(1);
  const changed = changeCreatePackagingMode(result, 3, 2, Mode.BOX_TACTILE);
  expect(changed[0]).toEqual(result[0]);
});
it('混装切回常规装只拆当前组，保留其他规格人工价', () => {
  const personal = { ...groups[1], itemUnitsPerBag: [0, 0, 8], adminPrice: { reason: '测试保留', amount: '1.23', factsKey: 'unchanged' } };
  const mixed = { name: '混装', mode: Mode.MIXED_STYLE, actualBagCount: 10, itemUnitsPerBag: [5, 5, 0] };
  const result = changeCreatePackagingMode([mixed, personal], 3, 1, Mode.SINGLE_STYLE);
  expect(result.map((group) => group.itemUnitsPerBag)).toEqual([[5, 0, 0], [0, 5, 0], [0, 0, 8]]);
  expect(result[2]).toEqual(personal);
});
it('切换盒型限制当前规格容量，不改其他规格的数量', () => {
  const result = changeCreatePackagingMode(groups, 2, 0, Mode.BOX_TACTILE);
  expect(result[0].itemUnitsPerBag).toEqual([8, 0]);
  expect(result[1]).toEqual(groups[1]);
});
it('相同模式不清除人工定价依据', () => {
  expect(changeCreatePackagingMode(groups, 2, 1, Mode.BOX_TACTILE)).toEqual(groups);
});

it('混装后的独立规格清空包装数量仍能找到原组，不能编辑到混装组', () => {
  const incomplete = [
    { name: null, mode: Mode.MIXED_STYLE, actualBagCount: 10, itemUnitsPerBag: [5, 5, 0] },
    { name: null, mode: Mode.SINGLE_STYLE, actualBagCount: 10, itemUnitsPerBag: [0, 0, 0] },
  ];
  expect(createPackagingGroupIndex(incomplete, 2)).toBe(1);
  expect(changeCreatePackagingMode(incomplete, 3, 2, Mode.BOX_RED_CARD)[0]).toEqual(incomplete[0]);
});
it('混装组成暂时清空时可继续编辑原混装组', () => {
  expect(createPackagingGroupIndex([{ name: null, mode: Mode.MIXED_STYLE, actualBagCount: 10, itemUnitsPerBag: [5, 0] }], 1)).toBe(0);
});

it('清空每包数量后改为不包装仍保留规格归属', () => {
  const incomplete = [{ ...groups[0], itemUnitsPerBag: [0, 0] }, groups[1]];
  const changed = changeCreatePackagingMode(incomplete, 2, 0, Mode.UNPACKED);
  expect(changed[0].itemUnitsPerBag).toEqual([10, 0]);
  expect(changed[1]).toEqual(groups[1]);
});

describe('整单包装区', () => {
  const single = (units: number[], mode: Mode = Mode.SINGLE_STYLE) => ({ name: null, mode, actualBagCount: 1, itemUnitsPerBag: units });

  it('顶部控件只在全部规格一致时显示取值', () => {
    expect(orderPackagingSelection([single([10, 0]), single([0, 10])], 2)).toEqual({ type: 'BAG', box: null, mixing: 'SINGLE_STYLE' });
    expect(orderPackagingSelection(groups, 2)).toEqual({ type: null, box: null, mixing: 'SINGLE_STYLE' });
    expect(orderPackagingSelection([single([10, 8], Mode.MIXED_STYLE)], 2)).toEqual({ type: 'BAG', box: null, mixing: 'MIXED_STYLE' });
    expect(orderPackagingSelection([single([5, 5, 0], Mode.MIXED_STYLE), single([0, 0, 10])], 3).mixing).toBeNull();
    expect(orderPackagingSelection([single([10, 0], Mode.UNPACKED), single([0, 10], Mode.UNPACKED)], 2)).toEqual({ type: 'UNPACKED', box: null, mixing: null });
    expect(orderPackagingSelection([single([8, 0], Mode.BOX_TACTILE), single([0, 10], Mode.BOX_RED_CARD)], 2)).toEqual({ type: 'BOX', box: null, mixing: 'SINGLE_STYLE' });
  });

  it('整单改类型作用于每个规格，并按新容量收紧每包数量', () => {
    const result = applyOrderPackagingType(groups, 2, 'BOX', 'TACTILE');
    expect(result.map((group) => [group.mode, group.itemUnitsPerBag])).toEqual([
      [Mode.BOX_TACTILE, [8, 0]],
      [Mode.BOX_TACTILE, [0, 8]],
    ]);
    // 第二个规格原本就是触感盒：不重建，保留名称等依据。
    expect(result[1]).toEqual(groups[1]);
  });

  it('整单改为不包装保留规格归属，袋数为 0', () => {
    const result = applyOrderPackagingType(groups, 2, 'UNPACKED');
    expect(result.map((group) => [group.mode, group.actualBagCount, group.itemUnitsPerBag])).toEqual([
      [Mode.UNPACKED, 0, [10, 0]],
      [Mode.UNPACKED, 0, [0, 8]],
    ]);
  });

  it('已混装时整单改类型保留混装组成；改为不包装则拆回各规格', () => {
    const mixed = [single([10, 5], Mode.MIXED_STYLE)];
    expect(applyOrderPackagingType(mixed, 2, 'BOX', 'TACTILE')).toEqual([
      { name: null, mode: Mode.BOX_TACTILE_MIXED, actualBagCount: 1, itemUnitsPerBag: [8, 5] },
    ]);
    expect(applyOrderPackagingType(mixed, 2, 'UNPACKED').map((group) => [group.mode, group.itemUnitsPerBag])).toEqual([
      [Mode.UNPACKED, [10, 0]],
      [Mode.UNPACKED, [0, 5]],
    ]);
  });

  it('整单类型与现状一致时不清除人工价依据', () => {
    const priced = [{ ...single([10, 0]), adminPrice: { reason: '保留', amount: '0.10', factsKey: 'k' } }, single([0, 10])];
    expect(applyOrderPackagingType(priced, 2, 'BAG')).toEqual(priced);
  });

  it('混装合并全部规格，类型取第一个有包装的规格', () => {
    expect(applyOrderPackagingMixing(groups, 2, true)).toEqual([
      { name: null, mode: Mode.MIXED_STYLE, actualBagCount: 1, itemUnitsPerBag: [10, 8] },
    ]);
    const firstUnpacked = [single([10, 0], Mode.UNPACKED), single([0, 10], Mode.BOX_RED_CARD)];
    expect(applyOrderPackagingMixing(firstUnpacked, 2, true)[0].mode).toBe(Mode.BOX_RED_CARD_MIXED);
  });

  it('混装在单规格或已整单混装时不变', () => {
    const one = [single([10])];
    expect(applyOrderPackagingMixing(one, 1, true)).toEqual(one);
    const mixed = [single([5, 5], Mode.MIXED_STYLE)];
    expect(applyOrderPackagingMixing(mixed, 2, true)).toEqual(mixed);
  });

  it('部分混装时点混装把新增的独立规格也并入', () => {
    const partial = [single([5, 5, 0], Mode.MIXED_STYLE), single([0, 0, 10])];
    expect(applyOrderPackagingMixing(partial, 3, true)).toEqual([
      { name: null, mode: Mode.MIXED_STYLE, actualBagCount: 1, itemUnitsPerBag: [5, 5, 10] },
    ]);
  });

  it('常规装拆开每个混装组，其他组原样保留', () => {
    const personal = { ...single([0, 0, 8], Mode.BOX_TACTILE), adminPrice: { reason: '保留', amount: '1.00', factsKey: 'k' } };
    const result = applyOrderPackagingMixing([single([5, 5, 0], Mode.MIXED_STYLE), personal], 3, false);
    expect(result.map((group) => [group.mode, group.itemUnitsPerBag])).toEqual([
      [Mode.SINGLE_STYLE, [5, 0, 0]],
      [Mode.SINGLE_STYLE, [0, 5, 0]],
      [Mode.BOX_TACTILE, [0, 0, 8]],
    ]);
    expect(result[2]).toEqual(personal);
  });

  it('单个规格可单独改类型；混装组内的规格不单独改', () => {
    const result = applySpecPackagingType(groups, 2, 1, 'BAG');
    expect(result[0]).toEqual(groups[0]);
    expect(result[1]).toMatchObject({ mode: Mode.SINGLE_STYLE, itemUnitsPerBag: [0, 8] });
    const mixed = [single([5, 5], Mode.MIXED_STYLE)];
    expect(applySpecPackagingType(mixed, 2, 0, 'BOX')).toEqual(mixed);
  });

  it('每行给出所在组、每包数量和袋数', () => {
    expect(createPackagingRows({ groups, itemQuantities: [1000, 100] })).toEqual([
      { groupIndex: 0, mode: Mode.SINGLE_STYLE, unitsPerBag: 10, bagCount: 100, error: null },
      { groupIndex: 1, mode: Mode.BOX_TACTILE, unitsPerBag: 8, bagCount: 13, error: null },
    ]);
    expect(createPackagingRows({ groups: [single([10], Mode.UNPACKED)], itemQuantities: [500] })[0].bagCount).toBe(0);
  });

  it('混装组成无法对齐时，同组每行都带同一错误', () => {
    const rows = createPackagingRows({ groups: [single([10, 10], Mode.MIXED_STYLE)], itemQuantities: [1000, 500] });
    expect(rows.map((row) => row.bagCount)).toEqual([null, null]);
    expect(rows[0].error).toBeTruthy();
    expect(rows[1].error).toBe(rows[0].error);
  });

  it('汇总合计数量、设计款/规格数和包/盒数', () => {
    const rows = createPackagingRows({ groups, itemQuantities: [1000, 100] });
    expect(summarizeCreatePackaging({ rows, itemQuantities: [1000, 100], designCount: 1 }))
      .toBe('合计 1,100 个 · 1 个设计款 / 2 个规格 · 100 包 + 13 盒');
    // 混装一包合计不超过 12 个：5 + 5，200 包里每包各装两款。
    const mixed = createPackagingRows({ groups: [single([5, 5], Mode.MIXED_STYLE)], itemQuantities: [1000, 1000] });
    expect(summarizeCreatePackaging({ rows: mixed, itemQuantities: [1000, 1000], designCount: 2 }))
      .toBe('合计 2,000 个 · 2 个设计款 / 2 个规格 · 200 包');
    const unpacked = createPackagingRows({ groups: [single([10], Mode.UNPACKED)], itemQuantities: [500] });
    expect(summarizeCreatePackaging({ rows: unpacked, itemQuantities: [500], designCount: 1 })).toMatch(/· 不包装$/);
    const broken = createPackagingRows({ groups: [single([10, 10], Mode.MIXED_STYLE)], itemQuantities: [1000, 500] });
    expect(summarizeCreatePackaging({ rows: broken, itemQuantities: [1000, 500], designCount: 1 })).toMatch(/· 包数待定$/);
  });
});
