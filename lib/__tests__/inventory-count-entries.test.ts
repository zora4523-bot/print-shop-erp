import { describe, expect, it } from 'vitest';
import { MaterialCategory } from '../../generated/prisma/enums';
import type { InventoryCountMaterialRow } from '../inventory-count';
import {
  buildSubmittedItems,
  countKey,
  parseCountValue,
  pinDisplayedBookQuantities,
  sameBookQuantity,
  type CountEntry,
} from '../inventory-count-entries';

function fixtureRow(
  overrides: Partial<InventoryCountMaterialRow> = {},
): InventoryCountMaterialRow {
  return {
    id: 'mat1',
    code: 'M-001',
    name: '白卡纸',
    category: MaterialCategory.PAPER,
    specification: null,
    unit: '张',
    currentStock: '5.00',
    safetyStock: null,
    isActive: true,
    locations: [
      {
        id: 'stock1',
        locationId: 'loc1',
        warehouseCode: 'WH01',
        warehouseName: '默认仓库',
        locationCode: 'A01',
        locationName: 'A货架',
        currentStock: '5.00',
      },
    ],
    ...overrides,
  };
}

describe('buildSubmittedItems', () => {
  it('账面数在首次展示就钉住，首次录入前的刷新不得推进基线', () => {
    const firstDisplay = [fixtureRow()];
    const snapshots = pinDisplayedBookQuantities({}, firstDisplay);
    const refreshed = [
      fixtureRow({
        locations: [{ ...fixtureRow().locations[0]!, currentStock: '20.00' }],
      }),
    ];
    const afterRefresh = pinDisplayedBookQuantities(snapshots, refreshed);

    expect(afterRefresh['mat1:loc1']).toBe('5.00');
    expect(
      buildSubmittedItems(refreshed, {
        'mat1:loc1': { value: '8', book: afterRefresh['mat1:loc1']! },
      })[0],
    ).toEqual({
      materialId: 'mat1',
      locationId: 'loc1',
      bookQuantity: '5.00',
      countedQuantity: '8.00',
    });
  });

  it('回传的是录入那一刻钉住的账面数，而不是刷新后的最新值', () => {
    const rows = [fixtureRow()];
    // 操作员在账面数还是 5.00 时录入 8；之后点了刷新，页面显示的账面数变成 2.00
    const counts: Record<string, CountEntry> = {
      'mat1:loc1': { value: '8', book: '5.00' },
    };
    const refreshed = [
      fixtureRow({
        locations: [{ ...fixtureRow().locations[0]!, currentStock: '2.00' }],
      }),
    ];

    expect(buildSubmittedItems(rows, counts)).toEqual([
      {
        materialId: 'mat1',
        locationId: 'loc1',
        bookQuantity: '5.00',
        countedQuantity: '8.00',
      },
    ]);
    // 刷新只换了显示值，钉住的账面数一个字都不能变——否则服务端 CAS 恒等成立，
    // 守卫等于没装。
    expect(buildSubmittedItems(refreshed, counts)[0]!.bookQuantity).toBe('5.00');
  });

  it('未录入和录入了非法值的行都不提交', () => {
    const rows = [
      fixtureRow({
        locations: [
          { ...fixtureRow().locations[0]! },
          {
            id: 'stock2',
            locationId: 'loc2',
            warehouseCode: 'WH01',
            warehouseName: '默认仓库',
            locationCode: 'A02',
            locationName: 'B货架',
            currentStock: '3.00',
          },
        ],
      }),
    ];

    expect(
      buildSubmittedItems(rows, {
        'mat1:loc2': { value: 'abc', book: '3.00' },
      }),
    ).toEqual([]);
    expect(buildSubmittedItems(rows, {})).toEqual([]);
  });

  it('实盘数 0 会提交（全部盘亏），不被当成未录入', () => {
    const items = buildSubmittedItems([fixtureRow()], {
      'mat1:loc1': { value: '0', book: '5.00' },
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.countedQuantity).toBe('0.00');
  });
});

describe('parseCountValue', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['abc', null],
    ['-1', null],
    ['1.234', null],
    ['12.', 12],
    ['0', 0],
    ['8.50', 8.5],
  ])('parseCountValue(%j) === %j', (raw, expected) => {
    expect(parseCountValue(raw)).toBe(expected);
  });
});

describe('sameBookQuantity', () => {
  it('按数值比较，"5" 与 "5.00" 是同一个账面数', () => {
    expect(sameBookQuantity('5', '5.00')).toBe(true);
    expect(sameBookQuantity('5.00', '5.01')).toBe(false);
  });
});

describe('countKey', () => {
  it('和服务端 staleKeys 的形状一致', () => {
    expect(countKey('mat1', 'loc1')).toBe('mat1:loc1');
  });
});
