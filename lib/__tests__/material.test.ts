import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MaterialCategory,
  TxDirection,
} from '../../generated/prisma/client';

const { dbMock, txMock } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    warehouseLocation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    material: { update: vi.fn() },
    materialLocationStock: { update: vi.fn() },
    materialTransaction: { create: vi.fn() },
  };
  return {
    txMock: tx,
    dbMock: {
      material: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      materialTransaction: {
        create: vi.fn(),
      },
      $transaction: vi.fn((cb: (txArg: typeof tx) => unknown) => cb(tx)),
    },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  createMaterial,
  createMaterialTransaction,
  getMaterialSummary,
  listMaterialsPage,
  listMaterials,
  MaterialInvariantError,
  setMaterialActive,
  updateMaterial,
} from '../material';

beforeEach(() => {
  for (const fn of Object.values(dbMock.material)) fn.mockReset();
  dbMock.materialTransaction.create.mockReset();
  dbMock.$transaction.mockReset().mockImplementation((cb) => cb(txMock));
  txMock.$queryRaw.mockReset();
  txMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  txMock.warehouseLocation.findUnique.mockReset();
  txMock.warehouseLocation.findFirst.mockReset().mockResolvedValue({
    id: 'loc-default',
    warehouseId: 'wh-default',
    isActive: true,
    warehouse: { id: 'wh-default', isActive: true },
  });
  txMock.material.update.mockReset();
  txMock.materialLocationStock.update.mockReset().mockResolvedValue({ id: 'stock1' });
  txMock.materialTransaction.create.mockReset();
});

const makeMaterial = (over = {}) => ({
  id: 'mat1',
  code: 'PAPER-A4',
  name: 'A4 白卡纸',
  category: MaterialCategory.PAPER,
  specification: '250g A4',
  unit: '张',
  searchPinyin: null,
  searchPinyinInitials: null,
  currentStock: '10.00',
  safetyStock: '2.00',
  averageCost: '0.1200',
  isActive: true,
  createdAt: new Date('2026-06-28T00:00:00Z'),
  updatedAt: new Date('2026-06-28T00:00:00Z'),
  ...over,
});

describe('listMaterials', () => {
  it('orders by active status, category, then name', async () => {
    dbMock.material.findMany.mockResolvedValue([]);
    await listMaterials();
    expect(dbMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
      }),
    );
  });

  it('adds q search across code, name, specification, unit, and pinyin', async () => {
    dbMock.material.findMany.mockResolvedValue([]);
    await listMaterials({ q: '  白卡 ' });
    expect(dbMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { code: { contains: '白卡', mode: 'insensitive' } },
            { name: { contains: '白卡', mode: 'insensitive' } },
            { specification: { contains: '白卡', mode: 'insensitive' } },
            { unit: { contains: '白卡', mode: 'insensitive' } },
            { searchPinyin: { contains: '白卡', mode: 'insensitive' } },
            { searchPinyinInitials: { contains: '白卡', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('sorts q results by relevance while keeping database order as tie-break', async () => {
    dbMock.material.findMany.mockResolvedValue([
      makeMaterial({ id: 'contains', name: '进口白卡纸' }),
      makeMaterial({ id: 'exact', name: '白卡纸' }),
      makeMaterial({ id: 'prefix', name: '白卡纸 250g' }),
    ]);

    const rows = await listMaterials({ q: '白卡纸' });

    expect(rows.map((row) => row.id)).toEqual(['exact', 'prefix', 'contains']);
  });
});

describe('listMaterialsPage', () => {
  it('sorts by code and paginates the result', async () => {
    dbMock.material.findMany.mockResolvedValue([
      makeMaterial({ id: 'c', code: 'C' }),
      makeMaterial({ id: 'a', code: 'A' }),
      makeMaterial({ id: 'b', code: 'B' }),
    ]);

    const page = await listMaterialsPage({
      page: 2,
      pageSize: 1,
      sort: 'code',
      direction: 'asc',
    });

    expect(page.rows.map((row) => row.id)).toEqual(['b']);
    expect(page.total).toBe(3);
    expect(page.page).toBe(2);
    expect(page.pageCount).toBe(3);
  });

  it('keeps relevance order for default search sorting before pagination', async () => {
    dbMock.material.findMany.mockResolvedValue([
      makeMaterial({ id: 'contains', name: '进口白卡纸' }),
      makeMaterial({ id: 'exact', name: '白卡纸' }),
      makeMaterial({ id: 'prefix', name: '白卡纸 250g' }),
    ]);

    const page = await listMaterialsPage({
      q: '白卡纸',
      page: 1,
      pageSize: 2,
      sort: 'default',
      direction: 'asc',
    });

    expect(page.rows.map((row) => row.id)).toEqual(['exact', 'prefix']);
    expect(page.total).toBe(3);
  });
});

describe('createMaterial', () => {
  it('forces isActive=true and leaves stock changes to transaction flow', async () => {
    dbMock.material.create.mockResolvedValue(makeMaterial());
    await createMaterial({
      code: 'PAPER-A4',
      name: 'A4 白卡纸',
      category: MaterialCategory.PAPER,
      specification: '250g A4',
      unit: '张',
      safetyStock: '2.00',
      averageCost: '0.1200',
    });
    const data = dbMock.material.create.mock.calls[0][0].data;
    expect(data.isActive).toBe(true);
    expect('currentStock' in data).toBe(false);
  });
});

describe('updateMaterial', () => {
  it('throws when target missing', async () => {
    dbMock.material.findUnique.mockResolvedValue(null);
    await expect(
      updateMaterial('missing', {
        code: 'PAPER-A4',
        name: 'A4 白卡纸',
        category: MaterialCategory.PAPER,
        specification: null,
        unit: '张',
        safetyStock: null,
        averageCost: null,
      }),
    ).rejects.toBeInstanceOf(MaterialInvariantError);
    expect(dbMock.material.update).not.toHaveBeenCalled();
  });

  it('never writes isActive or currentStock through the dictionary update path', async () => {
    dbMock.material.findUnique.mockResolvedValue(makeMaterial());
    dbMock.material.update.mockResolvedValue(makeMaterial({ name: '改名' }));
    await updateMaterial('mat1', {
      code: 'PAPER-A4',
      name: '改名',
      category: MaterialCategory.PAPER,
      specification: null,
      unit: '张',
      safetyStock: null,
      averageCost: null,
    });
    const data = dbMock.material.update.mock.calls[0][0].data as Record<string, unknown>;
    expect('isActive' in data).toBe(false);
    expect('currentStock' in data).toBe(false);
  });
});

describe('setMaterialActive', () => {
  it('no-ops when already matching', async () => {
    const material = makeMaterial({ isActive: true });
    dbMock.material.findUnique.mockResolvedValue(material);
    const result = await setMaterialActive('mat1', true);
    expect(result).toBe(material);
    expect(dbMock.material.update).not.toHaveBeenCalled();
  });

  it('flips isActive when different', async () => {
    dbMock.material.findUnique.mockResolvedValue(makeMaterial({ isActive: true }));
    dbMock.material.update.mockResolvedValue(makeMaterial({ isActive: false }));
    await setMaterialActive('mat1', false);
    expect(dbMock.material.update.mock.calls[0][0].data).toEqual({ isActive: false });
  });
});

describe('getMaterialSummary', () => {
  it('returns null when absent', async () => {
    dbMock.material.findUnique.mockResolvedValue(null);
    await expect(getMaterialSummary('missing')).resolves.toBeNull();
  });
});

describe('createMaterialTransaction', () => {
  it('locks the material row, increments stock, and writes transaction', async () => {
    txMock.$queryRaw
      .mockResolvedValueOnce([{ id: 'mat1', currentStock: '10.00' }])
      .mockResolvedValueOnce([{ id: 'stock1', currentStock: '10.00' }]);
    txMock.material.update.mockResolvedValue(makeMaterial({ currentStock: '13.50' }));
    txMock.materialTransaction.create.mockResolvedValue({
      id: 'tx1',
      materialId: 'mat1',
      warehouseId: 'wh-default',
      locationId: 'loc-default',
      direction: TxDirection.IN,
      quantity: '3.50',
      reasonType: 'PURCHASE',
      purchaseReceiptItemId: null,
      unitCost: '0.1200',
      remark: null,
      operatorId: 'owner1',
      occurredAt: new Date('2026-06-28T01:00:00Z'),
      createdAt: new Date('2026-06-28T01:00:00Z'),
    });

    const result = await createMaterialTransaction({
      materialId: 'mat1',
      direction: TxDirection.IN,
      quantity: '3.5',
      reasonType: 'PURCHASE',
      unitCost: '0.1200',
      remark: null,
      operatorId: 'owner1',
    });

    expect(result.material.currentStock).toBe('13.50');
    expect(txMock.material.update.mock.calls[0][0].data).toEqual({
      currentStock: '13.50',
    });
    expect(txMock.materialLocationStock.update.mock.calls[0][0].data).toEqual({
      currentStock: '13.50',
    });
    expect(txMock.materialTransaction.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        materialId: 'mat1',
        warehouseId: 'wh-default',
        locationId: 'loc-default',
        direction: TxDirection.IN,
        quantity: '3.50',
        operatorId: 'owner1',
      }),
    );
  });

  it('rejects stock-out that would make current stock negative', async () => {
    txMock.$queryRaw
      .mockResolvedValueOnce([{ id: 'mat1', currentStock: '1.00' }])
      .mockResolvedValueOnce([{ id: 'stock1', currentStock: '1.00' }]);
    await expect(
      createMaterialTransaction({
        materialId: 'mat1',
        direction: TxDirection.OUT,
        quantity: '2',
        reasonType: 'PRODUCTION_USE',
        unitCost: null,
        remark: null,
        operatorId: 'owner1',
      }),
    ).rejects.toBeInstanceOf(MaterialInvariantError);
    expect(txMock.material.update).not.toHaveBeenCalled();
    expect(txMock.materialTransaction.create).not.toHaveBeenCalled();
  });

  it('throws when target material is missing', async () => {
    txMock.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      createMaterialTransaction({
        materialId: 'missing',
        direction: TxDirection.IN,
        quantity: '1',
        reasonType: 'PURCHASE',
        unitCost: null,
        remark: null,
        operatorId: 'owner1',
      }),
    ).rejects.toBeInstanceOf(MaterialInvariantError);
  });
});
