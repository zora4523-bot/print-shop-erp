import Decimal from 'decimal.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaterialCategory } from '../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    material: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import { getMaterialInventoryDashboard } from '../material-inventory';

beforeEach(() => {
  dbMock.material.findMany.mockReset();
  dbMock.$queryRaw.mockReset();
});

describe('getMaterialInventoryDashboard', () => {
  it('combines material facts with pg_ivm movement summaries', async () => {
    dbMock.material.findMany.mockResolvedValue([
      {
        id: 'm1',
        code: 'PAPER-A',
        name: '铜版纸',
        category: MaterialCategory.PAPER,
        specification: '100x200',
        unit: '张',
        currentStock: new Decimal('5.00'),
        safetyStock: new Decimal('10.00'),
        averageCost: new Decimal('2.5000'),
        isActive: true,
      },
    ]);
    dbMock.$queryRaw
      .mockResolvedValueOnce([
        {
          materialId: 'm1',
          transactionCount: 3,
          totalIn: new Decimal('20.00'),
          totalOut: new Decimal('15.00'),
          netQuantity: new Decimal('5.00'),
        },
      ])
      .mockResolvedValueOnce([
        {
          materialId: 'm1',
          shanghaiDate: '2026-06-28',
          transactionCount: 2,
          totalIn: new Decimal('8.00'),
          totalOut: new Decimal('1.50'),
          netQuantity: new Decimal('6.50'),
        },
      ]);

    const result = await getMaterialInventoryDashboard(
      new Date('2026-06-28T06:00:00Z'),
    );

    expect(dbMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
      }),
    );
    expect(result.date).toBe('2026-06-28');
    expect(result.rows[0]).toMatchObject({
      id: 'm1',
      code: 'PAPER-A',
      currentStock: '5.00',
      safetyStock: '10.00',
      averageCost: '2.5000',
      stockValue: '12.50',
      isBelowSafetyStock: true,
      transactionCount: 3,
      totalIn: '20.00',
      totalOut: '15.00',
      netQuantity: '5.00',
      todayTransactionCount: 2,
      todayIn: '8.00',
      todayOut: '1.50',
      todayNetQuantity: '6.50',
    });
    expect(result.lowStockRows).toHaveLength(1);
    expect(result.totals).toEqual({
      materialCount: 1,
      activeMaterialCount: 1,
      lowStockCount: 1,
      stockValue: '12.50',
      todayIn: '8.00',
      todayOut: '1.50',
    });
  });

  it('defaults movement fields to zero when a material has no transactions', async () => {
    dbMock.material.findMany.mockResolvedValue([
      {
        id: 'm2',
        code: 'FOIL-A',
        name: '金色烫金纸',
        category: MaterialCategory.FOIL,
        specification: null,
        unit: '卷',
        currentStock: new Decimal('3.00'),
        safetyStock: null,
        averageCost: null,
        isActive: false,
      },
    ]);
    dbMock.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await getMaterialInventoryDashboard(
      new Date('2026-06-28T06:00:00Z'),
    );

    expect(result.rows[0]).toMatchObject({
      currentStock: '3.00',
      safetyStock: null,
      averageCost: null,
      stockValue: null,
      isBelowSafetyStock: false,
      transactionCount: 0,
      totalIn: '0.00',
      totalOut: '0.00',
      netQuantity: '0.00',
      todayTransactionCount: 0,
      todayIn: '0.00',
      todayOut: '0.00',
      todayNetQuantity: '0.00',
    });
    expect(result.totals).toMatchObject({
      materialCount: 1,
      activeMaterialCount: 0,
      lowStockCount: 0,
      stockValue: '0.00',
      todayIn: '0.00',
      todayOut: '0.00',
    });
  });

  it('filters material facts by q across code, name, specification, unit, and pinyin', async () => {
    dbMock.material.findMany.mockResolvedValue([]);
    dbMock.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await getMaterialInventoryDashboard(
      new Date('2026-06-28T06:00:00Z'),
      { q: ' 铜版纸 ' },
    );

    expect(dbMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { code: { contains: '铜版纸', mode: 'insensitive' } },
            { name: { contains: '铜版纸', mode: 'insensitive' } },
            { specification: { contains: '铜版纸', mode: 'insensitive' } },
            { unit: { contains: '铜版纸', mode: 'insensitive' } },
            { searchPinyin: { contains: '铜版纸', mode: 'insensitive' } },
            { searchPinyinInitials: { contains: '铜版纸', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('sorts searched materials by relevance before computing low-stock rows', async () => {
    const base = {
      category: MaterialCategory.PAPER,
      specification: null,
      unit: '张',
      searchPinyin: null,
      searchPinyinInitials: null,
      currentStock: new Decimal('1.00'),
      safetyStock: new Decimal('2.00'),
      averageCost: null,
      isActive: true,
    };
    dbMock.material.findMany.mockResolvedValue([
      { ...base, id: 'contains', code: 'M1', name: '进口铜版纸' },
      { ...base, id: 'exact', code: 'M2', name: '铜版纸' },
      { ...base, id: 'prefix', code: 'M3', name: '铜版纸 100g' },
    ]);
    dbMock.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await getMaterialInventoryDashboard(
      new Date('2026-06-28T06:00:00Z'),
      { q: '铜版纸' },
    );

    expect(result.rows.map((row) => row.id)).toEqual([
      'exact',
      'prefix',
      'contains',
    ]);
    expect(result.lowStockRows.map((row) => row.id)).toEqual([
      'exact',
      'prefix',
      'contains',
    ]);
  });
});
