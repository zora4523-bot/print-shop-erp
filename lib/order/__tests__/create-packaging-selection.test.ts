import { describe, expect, it } from 'vitest';
import { changeCreatePackagingMode, appendCreatePackagingGroup, createPackagingGroupIndex } from '../create-packaging-selection';
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
