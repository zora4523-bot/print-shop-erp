import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MaterialCategory } from '../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    material: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { listInventoryCountMaterials } from '../inventory-count';

beforeEach(() => {
  dbMock.material.findMany.mockReset();
});

describe('listInventoryCountMaterials', () => {
  it('searches material fields and serializes Decimal-like stock values', async () => {
    dbMock.material.findMany.mockResolvedValue([
      {
        id: 'mat1',
        code: 'PAPER',
        name: '白卡纸',
        category: MaterialCategory.PAPER,
        specification: '250g',
        unit: '张',
        currentStock: { toString: () => '120.50' },
        safetyStock: { toString: () => '20.00' },
        isActive: true,
        locationStocks: [
          {
            id: 'stock1',
            currentStock: { toString: () => '80.00' },
            warehouse: { code: 'DEFAULT', name: '默认仓库' },
            location: { code: 'DEFAULT', name: '默认库位' },
          },
        ],
      },
    ]);

    const rows = await listInventoryCountMaterials({ q: ' 白卡 ', limit: 500 });

    expect(dbMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: expect.arrayContaining([
            { code: { contains: '白卡', mode: 'insensitive' } },
            { name: { contains: '白卡', mode: 'insensitive' } },
            { specification: { contains: '白卡', mode: 'insensitive' } },
          ]),
        },
        take: 100,
      }),
    );
    expect(rows).toEqual([
      {
        id: 'mat1',
        code: 'PAPER',
        name: '白卡纸',
        category: MaterialCategory.PAPER,
        specification: '250g',
        unit: '张',
        currentStock: '120.50',
        safetyStock: '20.00',
        isActive: true,
        locations: [
          {
            id: 'stock1',
            warehouseCode: 'DEFAULT',
            warehouseName: '默认仓库',
            locationCode: 'DEFAULT',
            locationName: '默认库位',
            currentStock: '80.00',
          },
        ],
      },
    ]);
  });
});
