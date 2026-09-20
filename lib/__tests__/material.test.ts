import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MaterialCategory,
  TxDirection,
} from '../../generated/prisma/enums';

const { dbMock, txMock } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    warehouseLocation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    material: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    product: { count: vi.fn(), findMany: vi.fn() },
    customerPriceRule: { findMany: vi.fn() },
    billOfMaterial: { count: vi.fn() },
    orderItem: { findMany: vi.fn() },
    materialLocationStock: { update: vi.fn() },
    materialTransaction: { create: vi.fn(), findUnique: vi.fn() },
  };
  return {
    txMock: tx,
    dbMock: {
      businessCodeSequence: {
        upsert: vi.fn(),
      },
      material: {
        count: vi.fn(),
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

// spy dispatch 整条链（同 order.test.ts 的 wire 测试模式）：
// STOCK_ALERT 必须在 tx 提交后由 createMaterialTransaction 发出。
const { notifyMock } = vi.hoisted(() => ({
  notifyMock: vi.fn<(...args: unknown[]) => void>(() => undefined),
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: notifyMock,
}));

import {
  createMaterial,
  createMaterialTransaction,
  getMaterialSummary,
  listActivePaperOrderOptions,
  listMaterialsPage,
  listMaterials,
  MaterialInvariantError,
  MaterialUnitChangeError,
  setMaterialActive,
  updateMaterial,
} from '../material';

beforeEach(() => {
  txMock.product.count.mockReset().mockResolvedValue(0);
  txMock.material.findMany.mockReset().mockResolvedValue([]);
  txMock.product.findMany.mockReset().mockResolvedValue([]);
  txMock.customerPriceRule.findMany.mockReset().mockResolvedValue([]);
  txMock.billOfMaterial.count.mockReset().mockResolvedValue(0);
  txMock.orderItem.findMany.mockReset().mockResolvedValue([]);
  dbMock.businessCodeSequence.upsert.mockReset();
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
  txMock.material.create.mockReset();
  txMock.material.findUnique.mockReset();
  txMock.material.update.mockReset();
  txMock.materialLocationStock.update.mockReset().mockResolvedValue({ id: 'stock1' });
  txMock.materialTransaction.create.mockReset();
  txMock.materialTransaction.findUnique.mockReset().mockResolvedValue(null);
  notifyMock.mockReset();
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
  it('uses count, skip, take, and database ordering instead of loading all rows', async () => {
    dbMock.material.count.mockResolvedValue(3);
    dbMock.material.findMany.mockResolvedValue([
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
    expect(dbMock.material.count).toHaveBeenCalledWith({ where: undefined });
    expect(dbMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 1,
        take: 1,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('applies the search filter to both count and bounded row queries', async () => {
    dbMock.material.count.mockResolvedValue(3);
    dbMock.material.findMany.mockResolvedValue([
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
    const expectedWhere = expect.objectContaining({ OR: expect.any(Array) });
    expect(dbMock.material.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(dbMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedWhere,
        skip: 0,
        take: 2,
      }),
    );
  });

  it('applies an exact material category scope to count and row queries', async () => {
    dbMock.material.count.mockResolvedValue(1);
    dbMock.material.findMany.mockResolvedValue([makeMaterial()]);

    await listMaterialsPage({
      category: MaterialCategory.PAPER,
      page: 1,
      pageSize: 20,
      sort: 'default',
      direction: 'asc',
    });

    expect(dbMock.material.count).toHaveBeenCalledWith({
      where: { category: MaterialCategory.PAPER },
    });
    expect(dbMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { category: MaterialCategory.PAPER },
      }),
    );
  });

  it('可从通用物料列表同时排除纸张主数据', async () => {
    dbMock.material.count.mockResolvedValue(1);
    dbMock.material.findMany.mockResolvedValue([
      makeMaterial({ category: MaterialCategory.FOIL }),
    ]);

    await listMaterialsPage({
      excludeCategory: MaterialCategory.PAPER,
      page: 1,
      pageSize: 20,
      sort: 'default',
      direction: 'asc',
    });

    const expectedWhere = {
      category: { not: MaterialCategory.PAPER },
    };
    expect(dbMock.material.count).toHaveBeenCalledWith({
      where: expectedWhere,
    });
    expect(dbMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
  });
});

describe('listActivePaperOrderOptions', () => {
  it('returns only active paper fields in stable display order', async () => {
    dbMock.material.findMany.mockResolvedValue([]);

    await listActivePaperOrderOptions();

    expect(dbMock.material.findMany).toHaveBeenCalledWith({
      where: { category: MaterialCategory.PAPER, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        specification: true,
        unit: true,
      },
      orderBy: [{ name: 'asc' }, { specification: 'asc' }, { id: 'asc' }],
    });
  });
});

describe('createMaterial', () => {
  it('generates a material code when the operator leaves it blank', async () => {
    dbMock.businessCodeSequence.upsert.mockResolvedValueOnce({ value: 23 });
    txMock.material.create.mockResolvedValue(makeMaterial({ code: 'MAT-000023' }));

    await createMaterial({
      code: null,
      name: 'A4 白卡纸',
      category: MaterialCategory.PAPER,
      specification: null,
      unit: '张',
      safetyStock: null,
      averageCost: null,
    });

    expect(txMock.material.create.mock.calls[0][0].data.code).toBe('MAT-000023');
  });

  it('forces isActive=true and leaves stock changes to transaction flow', async () => {
    txMock.material.create.mockResolvedValue(makeMaterial());
    await createMaterial({
      code: 'PAPER-A4',
      name: 'A4 白卡纸',
      category: MaterialCategory.PAPER,
      specification: '250g A4',
      unit: '张',
      safetyStock: '2.00',
      averageCost: '0.1200',
    });
    const data = txMock.material.create.mock.calls[0][0].data;
    expect(data.isActive).toBe(true);
    expect('currentStock' in data).toBe(false);
  });

  it.each([MaterialCategory.PAPER, MaterialCategory.FOIL])(
    'takes the price snapshot write lock before creating %s catalog facts',
    async (category) => {
      txMock.material.create.mockResolvedValue(makeMaterial({ category }));

      await createMaterial({
        code: 'CATALOG-FACT',
        name: '建单目录事实',
        category,
        specification: null,
        unit: '张',
        safetyStock: null,
        averageCost: null,
      });

      expect(txMock.$executeRaw).toHaveBeenCalledTimes(1);
      expect(txMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        txMock.material.create.mock.invocationCallOrder[0],
      );
    },
  );
});

describe('updateMaterial', () => {
  it('已关联建单产品的纸张不能改写身份，避免销售选择和历史规则失联', async () => {
    const material = makeMaterial({ unit: '张' });
    txMock.material.findUnique.mockResolvedValue(material);
    txMock.product.count.mockResolvedValue(1);
    await expect(updateMaterial('mat1', { code: material.code, name: '改名', category: MaterialCategory.PAPER,
      specification: material.specification, unit: '张', safetyStock: null, averageCost: null,
    })).rejects.toThrow('纸张已用于历史产品');
    expect(txMock.material.update).not.toHaveBeenCalled();
  });

  it('throws when target missing', async () => {
    txMock.material.findUnique.mockResolvedValue(null);
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
    expect(txMock.material.update).not.toHaveBeenCalled();
  });

  it('allows same-unit metadata edits without writing unit or stock fields', async () => {
    txMock.material.findUnique.mockResolvedValue(makeMaterial({ unit: '张' }));
    txMock.material.update.mockResolvedValue(makeMaterial({ name: '改名' }));

    await updateMaterial('mat1', {
      code: 'PAPER-A4',
      name: '改名',
      category: MaterialCategory.PAPER,
      specification: null,
      unit: '张',
      safetyStock: null,
      averageCost: null,
    });
    const data = txMock.material.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect('unit' in data).toBe(false);
    expect('isActive' in data).toBe(false);
    expect('currentStock' in data).toBe(false);
  });

  it('rejects a unit change even when the material has zero stock and no facts', async () => {
    txMock.material.findUnique.mockResolvedValue(
      makeMaterial({ unit: 'kg', currentStock: '0.00' }),
    );
    await expect(
      updateMaterial('mat1', {
        code: 'INK-1',
        name: '专色油墨',
        category: MaterialCategory.OTHER,
        specification: null,
        unit: '卷',
        safetyStock: null,
        averageCost: null,
      }),
    ).rejects.toMatchObject({
      name: MaterialUnitChangeError.name,
      message: expect.stringContaining('请新建物料'),
    });
    expect(txMock.material.update).not.toHaveBeenCalled();
  });

  it('holds the price snapshot write lock across read and update', async () => {
    txMock.material.findUnique.mockResolvedValue(makeMaterial({ unit: '张' }));
    txMock.material.update.mockResolvedValue(makeMaterial({ name: '改名' }));

    await updateMaterial('mat1', {
      code: 'PAPER-A4',
      name: '改名',
      category: MaterialCategory.PAPER,
      specification: null,
      unit: '张',
      safetyStock: null,
      averageCost: null,
    });

    expect(txMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.material.findUnique.mock.invocationCallOrder[0],
    );
    expect(txMock.material.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.material.update.mock.invocationCallOrder[0],
    );
  });
});

describe('setMaterialActive', () => {
  it('no-ops when already matching', async () => {
    const material = makeMaterial({ isActive: true });
    txMock.material.findUnique.mockResolvedValue(material);
    const result = await setMaterialActive('mat1', true);
    expect(result).toBe(material);
    expect(txMock.material.update).not.toHaveBeenCalled();
    expect(txMock.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('flips isActive when different', async () => {
    txMock.material.findUnique.mockResolvedValue(makeMaterial({ isActive: true }));
    txMock.material.update.mockResolvedValue(makeMaterial({ isActive: false }));
    await setMaterialActive('mat1', false);
    expect(txMock.material.update.mock.calls[0][0].data).toEqual({ isActive: false });
    expect(txMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.material.findUnique.mock.invocationCallOrder[0],
    );
    expect(txMock.material.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.material.update.mock.invocationCallOrder[0],
    );
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
      idempotencyKey: 'eac25702-5e61-45b3-908c-f177a27ba835',
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
      idempotencyKey: 'eac25702-5e61-45b3-908c-f177a27ba835',
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

  const mockTransactionRow = (over = {}) => ({
    id: 'tx1',
    materialId: 'mat1',
    warehouseId: 'wh-default',
    locationId: 'loc-default',
    direction: TxDirection.OUT,
    quantity: '2.00',
    reasonType: 'PRODUCTION_USE',
    purchaseReceiptItemId: null,
    unitCost: null,
    remark: null,
    operatorId: 'owner1',
    occurredAt: new Date('2026-07-05T01:00:00Z'),
    createdAt: new Date('2026-07-05T01:00:00Z'),
    ...over,
  });

  const runStockOut = async (currentStock: string, quantity: string, materialOver = {}) => {
    txMock.$queryRaw
      .mockResolvedValueOnce([{ id: 'mat1', currentStock }])
      .mockResolvedValueOnce([{ id: 'stock1', currentStock }]);
    txMock.material.update.mockResolvedValue(makeMaterial(materialOver));
    txMock.materialTransaction.create.mockResolvedValue(mockTransactionRow({ quantity }));
    return createMaterialTransaction({
      idempotencyKey: 'eac25702-5e61-45b3-908c-f177a27ba835',
      materialId: 'mat1',
      direction: TxDirection.OUT,
      quantity,
      reasonType: 'PRODUCTION_USE',
      unitCost: null,
      remark: null,
      operatorId: 'owner1',
    });
  };

  // STOCK_ALERT 跨越检测（SPEC §8.1；makeMaterial 的 safetyStock = 2.00）
  it('fires STOCK_ALERT after tx commit when stock-out crosses below safety stock', async () => {
    // 锁死"提交后才推送"的顺序——tx 内 dispatch 会在回滚时留幽灵消息
    const callOrder: string[] = [];
    dbMock.$transaction.mockImplementation(async (cb) => {
      const result = await cb(txMock);
      callOrder.push('commit');
      return result;
    });
    notifyMock.mockImplementation(() => {
      callOrder.push('dispatch');
    });

    const result = await runStockOut('3.00', '2', { currentStock: '1.00' });
    expect(result.stockAlert).toEqual({
      materialName: 'A4 白卡纸',
      currentStock: '1.00',
      safetyStock: '2.00',
    });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
      'STOCK_ALERT',
      {
        materialName: 'A4 白卡纸',
        currentStock: '1.00',
        safetyStock: '2.00',
      },
      { dedupeKey: 'notification:STOCK_ALERT:tx1' },
    );
    expect(callOrder).toEqual(['commit', 'dispatch']);
  });

  it('does not fire when stock stays at or above safety stock', async () => {
    // 落到恰好等于安全库存也不算跌破
    const result = await runStockOut('3.00', '1', { currentStock: '2.00' });
    expect(result.stockAlert).toBeNull();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('does not re-fire when stock was already below safety stock', async () => {
    const result = await runStockOut('1.50', '0.5', { currentStock: '1.00' });
    expect(result.stockAlert).toBeNull();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('does not fire when safety stock is unset', async () => {
    const result = await runStockOut('3.00', '2', {
      currentStock: '1.00',
      safetyStock: null,
    });
    expect(result.stockAlert).toBeNull();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('does not fire on stock-in', async () => {
    txMock.$queryRaw
      .mockResolvedValueOnce([{ id: 'mat1', currentStock: '1.00' }])
      .mockResolvedValueOnce([{ id: 'stock1', currentStock: '1.00' }]);
    txMock.material.update.mockResolvedValue(makeMaterial({ currentStock: '4.00' }));
    txMock.materialTransaction.create.mockResolvedValue(
      mockTransactionRow({ direction: TxDirection.IN, quantity: '3.00', reasonType: 'PURCHASE' }),
    );
    const result = await createMaterialTransaction({
      idempotencyKey: 'eac25702-5e61-45b3-908c-f177a27ba835',
      materialId: 'mat1',
      direction: TxDirection.IN,
      quantity: '3',
      reasonType: 'PURCHASE',
      unitCost: null,
      remark: null,
      operatorId: 'owner1',
    });
    expect(result.stockAlert).toBeNull();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('throws when target material is missing', async () => {
    txMock.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      createMaterialTransaction({
      idempotencyKey: 'eac25702-5e61-45b3-908c-f177a27ba835',
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

// A lost HTTP response can replay the exact mutation while the first one has
// already committed. Only one movement and notification may be recorded.
describe('manual material movement request replay', () => {
  const request = {
    idempotencyKey: 'ba9c9ef6-261c-4dbb-b03c-a485d8888d1d',
    materialId: 'mat1', direction: TxDirection.OUT, quantity: '2.00',
    reasonType: 'PRODUCTION_USE', unitCost: null, remark: '领料', operatorId: 'owner1',
  };

  beforeEach(() => {
    let stored: Record<string, unknown> | null = null;
    txMock.$queryRaw.mockResolvedValue([{ id: 'stock1', currentStock: '3.00' }]);
    txMock.material.update.mockResolvedValue(makeMaterial({ currentStock: '1.00' }));
    txMock.materialTransaction.findUnique.mockImplementation(async () => stored);
    txMock.materialTransaction.create.mockImplementation(async ({ data }) => {
      stored = { ...data, id: 'tx-replay', material: makeMaterial({ currentStock: '1.00' }) };
      return stored;
    });
  });

  it('returns the original movement without changing balances or repeating an alert', async () => {
    const first = await createMaterialTransaction(request);
    const replay = await createMaterialTransaction({ ...request, quantity: '2' });
    expect(replay.transaction.id).toBe(first.transaction.id);
    expect(txMock.materialTransaction.create).toHaveBeenCalledTimes(1);
    expect(txMock.material.update).toHaveBeenCalledTimes(1);
    expect(txMock.materialLocationStock.update).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it.each([{ quantity: '1.00' }, { operatorId: 'other-actor' }, { remark: '不同业务内容' }])(
    'rejects a reused key with changed business facts or operator: %j', async (overrides) => {
      await createMaterialTransaction(request);
      await expect(createMaterialTransaction({ ...request, ...overrides }))
        .rejects.toThrow('出入库请求与原记录不一致');
      expect(txMock.materialTransaction.create).toHaveBeenCalledTimes(1);
    },
  );
});

describe('paper identity guard entry points', () => {
  const data = {
    code: 'PAPER-IDENTITY', name: '160g红卡', category: MaterialCategory.PAPER,
    specification: null, unit: '张', safetyStock: null, averageCost: null,
  };
  it('checks duplicates under the existing write lock before creating', async () => {
    txMock.material.findMany.mockResolvedValue([makeMaterial({ name: '红卡', specification: '160g', isActive: false })]);
    await expect(createMaterial(data)).rejects.toBeInstanceOf(MaterialInvariantError);
    expect(txMock.material.create).not.toHaveBeenCalled();
    expect(txMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(txMock.material.findMany.mock.invocationCallOrder[0]);
  });
  it('rejects a rename referenced only by product text under the same lock', async () => {
    txMock.material.findUnique.mockResolvedValue(makeMaterial(data));
    txMock.product.findMany.mockResolvedValue([{ paperType: '160g红卡', weight: 160 }]);
    await expect(updateMaterial('mat1', { ...data, name: '160g新纸' })).rejects.toBeInstanceOf(MaterialInvariantError);
    expect(txMock.material.update).not.toHaveBeenCalled();
    expect(txMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(txMock.product.findMany.mock.invocationCallOrder[0]);
  });
  it('keeps FK protection when another material carries the same identity', async () => {
    txMock.material.findUnique.mockResolvedValue(makeMaterial(data));
    txMock.material.findMany.mockResolvedValue([makeMaterial({ ...data, id: 'duplicate' })]);
    txMock.product.count.mockResolvedValue(1);
    await expect(updateMaterial('mat1', { ...data, name: '160g新纸' })).rejects.toThrow('纸张已用于历史产品');
    expect(txMock.material.update).not.toHaveBeenCalled();
  });
  it('ordinary metadata edits on duplicate paper remain editable', async () => {
    txMock.material.findUnique.mockResolvedValue(makeMaterial(data));
    txMock.material.findMany.mockResolvedValue([makeMaterial({ ...data, id: 'duplicate' })]);
    await updateMaterial('mat1', { ...data, averageCost: '0.1200' });
    expect(txMock.material.findMany).not.toHaveBeenCalled();
    expect(txMock.material.update).toHaveBeenCalledOnce();
  });
  it('unweighted acceptance paper creation retains existing behavior', async () => {
    await createMaterial({ ...data, name: '验收纸张20260920' });
    expect(txMock.material.findMany).not.toHaveBeenCalled();
    expect(txMock.material.create).toHaveBeenCalledOnce();
  });
});
