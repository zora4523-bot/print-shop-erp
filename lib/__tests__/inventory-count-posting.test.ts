import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TxDirection } from '../../generated/prisma/enums';

const { dbMock, txMock, numberMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    inventoryCount: { findUnique: vi.fn(), create: vi.fn() },
    inventoryCountItem: { createManyAndReturn: vi.fn() },
    warehouseLocation: { findMany: vi.fn() },
    materialTransaction: { createMany: vi.fn() },
  };
  return {
    txMock: tx,
    numberMock: vi.fn(),
    dbMock: {
      $transaction: vi.fn(
        (cb: (client: typeof tx) => unknown, options?: unknown) => {
          void options;
          return cb(tx);
        },
      ),
      inventoryCount: { findUnique: vi.fn(), findMany: vi.fn() },
      materialLocationStock: { findMany: vi.fn() },
      material: { findMany: vi.fn() },
      warehouseLocation: { findMany: vi.fn() },
    },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/daily-document-number', () => ({
  nextDailyDocumentNumber: numberMock,
  DailyDocumentNumberExhaustedError: class DailyDocumentNumberExhaustedError extends Error {},
}));

import {
  InventoryCountInvariantError,
  InventoryCountStaleSnapshotError,
  postInventoryCount,
} from '../inventory-count-posting';

const input = {
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  remark: null,
  items: [
    {
      materialId: 'mat1',
      locationId: 'loc1',
      bookQuantity: '5.00',
      countedQuantity: '8.00',
    },
  ],
};
const summary = {
  id: 'count1',
  countNo: 'IC20260717-0001',
  countedAt: new Date(),
  remark: null,
  staleKeys: [],
  staleMessage: null,
  countedBy: { displayName: '管理员' },
  items: [],
};

beforeEach(() => {
  txMock.$executeRaw.mockReset().mockResolvedValue(1);
  txMock.$queryRaw.mockReset();
  txMock.inventoryCount.findUnique.mockReset();
  txMock.inventoryCount.create.mockReset();
  txMock.inventoryCountItem.createManyAndReturn.mockReset();
  txMock.warehouseLocation.findMany.mockReset();
  txMock.materialTransaction.createMany.mockReset().mockResolvedValue({ count: 1 });
  dbMock.$transaction.mockReset().mockImplementation((cb) => cb(txMock));
  dbMock.inventoryCount.findUnique.mockReset();
  dbMock.materialLocationStock.findMany.mockReset().mockResolvedValue([]);
  dbMock.material.findMany.mockReset().mockResolvedValue([]);
  dbMock.warehouseLocation.findMany.mockReset().mockResolvedValue([]);
  numberMock.mockReset().mockResolvedValue('IC20260717-0001');
});

function arrangeSingleRowPosting() {
  dbMock.inventoryCount.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(summary);
  txMock.inventoryCount.findUnique.mockResolvedValue(null);
  txMock.inventoryCount.create.mockResolvedValue({ id: 'count1' });
  txMock.$queryRaw
    .mockResolvedValueOnce([
      { id: 'mat1', code: 'M-001', name: '白卡纸', isActive: true },
    ])
    .mockResolvedValueOnce([
      {
        id: 'stock1',
        materialId: 'mat1',
        locationId: 'loc1',
        currentStock: '5.00',
      },
    ]);
  txMock.warehouseLocation.findMany.mockResolvedValue([
    {
      id: 'loc1',
      warehouseId: 'wh1',
      name: 'A货架',
      isActive: true,
      warehouse: { name: '默认仓库', isActive: true },
    },
  ]);
  txMock.inventoryCountItem.createManyAndReturn.mockResolvedValue([
    { id: 'item1', materialId: 'mat1', locationId: 'loc1' },
  ]);
}

describe('postInventoryCount', () => {
  it('records book/count/difference and posts the adjustment direction in batches', async () => {
    arrangeSingleRowPosting();
    const now = new Date('2026-07-17T10:00:00+08:00');

    const posted = await postInventoryCount(input, { id: 'owner1' }, now);

    expect(txMock.inventoryCountItem.createManyAndReturn.mock.calls[0]![0].data[0])
      .toMatchObject({
        bookQuantity: '5.00',
        countedQuantity: '8.00',
        difference: '3.00',
      });
    expect(txMock.materialTransaction.createMany.mock.calls[0]![0].data[0])
      .toMatchObject({
        direction: TxDirection.IN,
        quantity: '3.00',
        inventoryCountItemId: 'item1',
        locationId: 'loc1',
      });
    expect(dbMock.$transaction.mock.calls[0]![1]).toEqual({
      maxWait: 5_000,
      timeout: 30_000,
    });
    expect(numberMock).toHaveBeenCalledWith('INVENTORY_COUNT', now, txMock);
    expect(posted.staleKeys).toEqual([]);
    expect(posted.count.countNo).toBe('IC20260717-0001');
  });

  it('rejects a duplicate material/location before reserving a number', async () => {
    await expect(
      postInventoryCount(
        { ...input, items: [...input.items, { ...input.items[0]! }] },
        { id: 'owner1' },
      ),
    ).rejects.toBeInstanceOf(InventoryCountInvariantError);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(numberMock).not.toHaveBeenCalled();
  });

  it('does not reserve a number or post differences again for an idempotent replay', async () => {
    dbMock.inventoryCount.findUnique.mockResolvedValue(summary);

    await postInventoryCount(input, { id: 'owner1' });

    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.inventoryCountItem.createManyAndReturn).not.toHaveBeenCalled();
    expect(txMock.materialTransaction.createMany).not.toHaveBeenCalled();
    expect(numberMock).not.toHaveBeenCalled();
    // 幂等重放走不到账面回声守卫：第一次过账已经把余额改成了实盘数。
    expect(dbMock.materialLocationStock.findMany).not.toHaveBeenCalled();
  });

  it('并发重放在事务锁后读到持久化的部分过账 outcome', async () => {
    const staleMessage = '物料2(M-002) 默认仓库/2号货架 账面数已变动';
    dbMock.inventoryCount.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(summary);
    txMock.inventoryCount.findUnique.mockResolvedValue({
      id: 'count1',
      staleKeys: ['mat2:loc2'],
      staleMessage,
    });

    const replayed = await postInventoryCount(input, { id: 'owner1' });

    expect(replayed.staleKeys).toEqual(['mat2:loc2']);
    expect(replayed.staleMessage).toBe(staleMessage);
    expect(numberMock).not.toHaveBeenCalled();
    expect(txMock.$queryRaw).not.toHaveBeenCalled();
    expect(txMock.inventoryCount.create).not.toHaveBeenCalled();
  });

  it('keeps database round trips bounded for a 100-row count', async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({
      materialId: `mat${String(index).padStart(3, '0')}`,
      locationId: `loc${String(index).padStart(3, '0')}`,
      bookQuantity: '5.00',
      countedQuantity: '8.00',
    }));
    dbMock.inventoryCount.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(summary);
    txMock.inventoryCount.findUnique.mockResolvedValue(null);
    txMock.inventoryCount.create.mockResolvedValue({ id: 'count1' });
    txMock.$queryRaw
      .mockResolvedValueOnce(
        items.map((item) => ({
          id: item.materialId,
          code: item.materialId,
          name: item.materialId,
          isActive: true,
        })),
      )
      .mockResolvedValueOnce(
        items.map((item, index) => ({
          id: `stock${index}`,
          materialId: item.materialId,
          locationId: item.locationId,
          currentStock: '5.00',
        })),
      );
    txMock.warehouseLocation.findMany.mockResolvedValue(
      items.map((item, index) => ({
        id: item.locationId,
        warehouseId: `wh${index}`,
        name: item.locationId,
        isActive: true,
        warehouse: { name: '默认仓库', isActive: true },
      })),
    );
    txMock.inventoryCountItem.createManyAndReturn.mockResolvedValue(
      items.map((item, index) => ({
        id: `item${index}`,
        materialId: item.materialId,
        locationId: item.locationId,
      })),
    );
    txMock.$executeRaw.mockResolvedValue(100);
    await postInventoryCount(
      { ...input, items },
      { id: 'owner1' },
      new Date('2026-07-17T10:00:00+08:00'),
    );

    expect(txMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(txMock.$executeRaw).toHaveBeenCalledTimes(3);
    expect(txMock.inventoryCountItem.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(txMock.materialTransaction.createMany).toHaveBeenCalledTimes(1);
    expect(dbMock.materialLocationStock.findMany).not.toHaveBeenCalled();
  });
});

describe('postInventoryCount 账面回声守卫', () => {
  function arrangeThreeRows(stocks: Record<string, string>) {
    const materialIds = ['mat1', 'mat2', 'mat3'];
    dbMock.inventoryCount.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(summary);
    txMock.inventoryCount.findUnique.mockResolvedValue(null);
    txMock.inventoryCount.create.mockResolvedValue({ id: 'count1' });
    txMock.$queryRaw
      .mockResolvedValueOnce(
        materialIds.map((id, index) => ({
          id,
          code: `M-00${index + 1}`,
          name: `物料${index + 1}`,
          isActive: true,
        })),
      )
      .mockResolvedValueOnce(
        materialIds.map((id, index) => ({
          id: `stock${index}`,
          materialId: id,
          locationId: `loc${index + 1}`,
          currentStock: stocks[`${id}:loc${index + 1}`]!,
        })),
      );
    txMock.warehouseLocation.findMany.mockResolvedValue(
      materialIds.map((_, index) => ({
        id: `loc${index + 1}`,
        warehouseId: 'wh1',
        name: `${index + 1}号货架`,
        isActive: true,
        warehouse: { name: '默认仓库', isActive: true },
      })),
    );
    txMock.inventoryCountItem.createManyAndReturn.mockImplementation(
      (args: { data: { materialId: string; locationId: string }[] }) =>
        Promise.resolve(
          args.data.map((row, index) => ({
            id: `item${index}`,
            materialId: row.materialId,
            locationId: row.locationId,
          })),
        ),
    );
    txMock.$executeRaw.mockResolvedValue(3);
  }

  const threeRowInput = {
    ...input,
    items: [
      {
        materialId: 'mat1',
        locationId: 'loc1',
        bookQuantity: '5.00',
        countedQuantity: '8.00',
      },
      {
        materialId: 'mat2',
        locationId: 'loc2',
        bookQuantity: '5.00',
        countedQuantity: '9.00',
      },
      {
        materialId: 'mat3',
        locationId: 'loc3',
        bookQuantity: '5.00',
        countedQuantity: '10.00',
      },
    ],
  };

  it('剔除账面数已变动的行，其余照常过账（部分过账）', async () => {
    arrangeThreeRows({
      'mat1:loc1': '5.00',
      // 有人在盘点期间领了 3 个走：这一行不过账
      'mat2:loc2': '2.00',
      'mat3:loc3': '5.00',
    });
    txMock.$executeRaw.mockResolvedValue(2);

    const posted = await postInventoryCount(
      threeRowInput,
      { id: 'owner1' },
      new Date('2026-07-17T10:00:00+08:00'),
    );

    expect(posted.staleKeys).toEqual(['mat2:loc2']);
    expect(posted.staleMessage).toContain('物料2(M-002) 默认仓库/2号货架');
    expect(posted.staleMessage).toContain('账面数已从 5.00 变为 2.00');

    const createdRows =
      txMock.inventoryCountItem.createManyAndReturn.mock.calls[0]![0].data;
    expect(createdRows.map((row: { materialId: string }) => row.materialId))
      .toEqual(['mat1', 'mat3']);
    const ledgerRows =
      txMock.materialTransaction.createMany.mock.calls[0]![0].data;
    expect(ledgerRows).toHaveLength(2);
    expect(ledgerRows.map((row: { materialId: string }) => row.materialId))
      .toEqual(['mat1', 'mat3']);

    expect(txMock.inventoryCount.create.mock.calls[0]![0].data).toMatchObject({
      staleKeys: ['mat2:loc2'],
      staleMessage: expect.stringContaining('物料2(M-002)'),
    });

    // 第一次事务已提交但 HTTP 回执丢失：同 key 重放必须原样返回
    // 部分过账 outcome，不能把 staleKeys 伪造成 []。
    const transactionCalls = dbMock.$transaction.mock.calls.length;
    dbMock.inventoryCount.findUnique
      .mockReset()
      .mockResolvedValueOnce({
        id: 'count1',
        staleKeys: ['mat2:loc2'],
        staleMessage: posted.staleMessage,
      })
      .mockResolvedValueOnce(summary);

    const replayed = await postInventoryCount(threeRowInput, { id: 'owner1' });

    expect(replayed.staleKeys).toEqual(posted.staleKeys);
    expect(replayed.staleMessage).toBe(posted.staleMessage);
    expect(dbMock.$transaction).toHaveBeenCalledTimes(transactionCalls);
    expect(txMock.materialTransaction.createMany).toHaveBeenCalledTimes(1);
  });

  it('一行都不剩时在取号/建单前整体回滚', async () => {
    arrangeThreeRows({
      'mat1:loc1': '2.00',
      'mat2:loc2': '3.00',
      'mat3:loc3': '4.00',
    });

    const error = await postInventoryCount(threeRowInput, { id: 'owner1' }).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(InventoryCountStaleSnapshotError);
    expect((error as InventoryCountStaleSnapshotError).staleKeys).toEqual([
      'mat1:loc1',
      'mat2:loc2',
      'mat3:loc3',
    ]);
    // 幂等锁、CAS 与取号同事务；全量失效时不烧号。
    expect(numberMock).not.toHaveBeenCalled();
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.inventoryCount.create).not.toHaveBeenCalled();
  });

  it('事务内加锁的 CAS 是唯一权威判定', async () => {
    arrangeThreeRows({
      'mat1:loc1': '1.00',
      'mat2:loc2': '2.00',
      'mat3:loc3': '3.00',
    });

    const error = await postInventoryCount(threeRowInput, { id: 'owner1' }).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(InventoryCountStaleSnapshotError);
    expect((error as InventoryCountStaleSnapshotError).staleKeys).toEqual([
      'mat1:loc1',
      'mat2:loc2',
      'mat3:loc3',
    ]);
    expect(txMock.inventoryCountItem.createManyAndReturn).not.toHaveBeenCalled();
    expect(txMock.materialTransaction.createMany).not.toHaveBeenCalled();
  });

  it('账面数写法不同但数值相同（5 与 5.00）不算冲突', async () => {
    arrangeSingleRowPosting();

    const posted = await postInventoryCount(
      { ...input, items: [{ ...input.items[0]!, bookQuantity: '5' }] },
      { id: 'owner1' },
      new Date('2026-07-17T10:00:00+08:00'),
    );

    expect(posted.staleKeys).toEqual([]);
    expect(txMock.inventoryCountItem.createManyAndReturn).toHaveBeenCalledTimes(1);
  });

  it('账面数为负数直接拒绝，连事务都不进', async () => {
    await expect(
      postInventoryCount(
        { ...input, items: [{ ...input.items[0]!, bookQuantity: '-1.00' }] },
        { id: 'owner1' },
      ),
    ).rejects.toBeInstanceOf(InventoryCountInvariantError);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(numberMock).not.toHaveBeenCalled();
  });

  it('冲突提示最多点名 3 个库位，其余折叠成一句', async () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      materialId: `mat${index + 1}`,
      locationId: `loc${index + 1}`,
      bookQuantity: '5.00',
      countedQuantity: '8.00',
    }));
    dbMock.inventoryCount.findUnique.mockResolvedValueOnce(null);
    txMock.inventoryCount.findUnique.mockResolvedValue(null);
    txMock.$queryRaw
      .mockResolvedValueOnce(
        items.map((item, index) => ({
          id: item.materialId,
          code: `M-00${index + 1}`,
          name: `物料${index + 1}`,
          isActive: true,
        })),
      )
      .mockResolvedValueOnce(
        items.map((item, index) => ({
          id: `stock${index + 1}`,
          materialId: item.materialId,
          locationId: item.locationId,
          currentStock: '1.00',
        })),
      );
    txMock.warehouseLocation.findMany.mockResolvedValue(
      items.map((item, index) => ({
        id: item.locationId,
        warehouseId: 'wh1',
        name: `${index + 1}号货架`,
        isActive: true,
        warehouse: { name: '默认仓库', isActive: true },
      })),
    );

    const error = await postInventoryCount(
      { ...input, items },
      { id: 'owner1' },
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(InventoryCountStaleSnapshotError);
    expect((error as Error).message).toContain('另有 2 个库位同样有变动');
    expect((error as InventoryCountStaleSnapshotError).staleKeys).toHaveLength(5);
  });
});
