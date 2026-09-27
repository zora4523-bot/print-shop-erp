import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TxDirection } from '../../generated/prisma/enums';

const { dbMock, txMock, numberMock, enqueueMock, dispatchMock } = vi.hoisted(() => {
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
    enqueueMock: vi.fn(),
    dispatchMock: vi.fn(),
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
vi.mock('@/lib/notification/transactional-outbox', () => ({
  enqueueNotificationInTransaction: enqueueMock,
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: dispatchMock,
}));

import {
  InventoryCountInvariantError,
  InventoryCountStaleSnapshotError,
  postInventoryCount,
} from '../inventory-count-posting';

const input = {
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  remark: '月末例行盘点',
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
// 幂等命中时读取的「原请求」：盘点单持久化的操作人、原因、已过账行
// （账面数 = 当时回传的账面回声，实盘数）与未过账行的 key。
function storedCount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'count1',
    countedById: 'owner1',
    remark: '月末例行盘点',
    staleKeys: [] as string[],
    staleMessage: null as string | null,
    items: [
      {
        materialId: 'mat1',
        locationId: 'loc1',
        bookQuantity: '5.00',
        countedQuantity: '8.00',
      },
    ],
    ...overrides,
  };
}
const REQUEST_MISMATCH = '盘点请求与原记录不一致，请刷新页面后重新核对';

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
  enqueueMock.mockReset().mockResolvedValue(true);
  dispatchMock.mockReset().mockResolvedValue(undefined);
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
    dbMock.inventoryCount.findUnique
      .mockResolvedValueOnce(storedCount())
      .mockResolvedValueOnce(summary);

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
    txMock.inventoryCount.findUnique.mockResolvedValue(
      storedCount({ staleKeys: ['mat2:loc2'], staleMessage }),
    );

    const replayed = await postInventoryCount(
      {
        ...input,
        items: [
          ...input.items,
          { materialId: 'mat2', locationId: 'loc2', bookQuantity: '5.00', countedQuantity: '9.00' },
        ],
      },
      { id: 'owner1' },
    );

    expect(replayed.staleKeys).toEqual(['mat2:loc2']);
    expect(replayed.staleMessage).toBe(staleMessage);
    expect(numberMock).not.toHaveBeenCalled();
    expect(txMock.$queryRaw).not.toHaveBeenCalled();
    expect(txMock.inventoryCount.create).not.toHaveBeenCalled();
  });

  it('replays when only the decimal spelling of the same quantities differs', async () => {
    dbMock.inventoryCount.findUnique
      .mockResolvedValueOnce(storedCount())
      .mockResolvedValueOnce(summary);

    const replayed = await postInventoryCount(
      { ...input, items: [{ ...input.items[0]!, bookQuantity: '5', countedQuantity: '8.0' }] },
      { id: 'owner1' },
    );

    expect(replayed.count.countNo).toBe('IC20260717-0001');
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  // L-10：同一幂等键、内容不同的重提必须拒绝，不能把旧盘点单当作已过账
  // 返回、静默丢掉操作员改过的实盘数。
  it.each([
    ['counted quantity', { items: [{ materialId: 'mat1', locationId: 'loc1', bookQuantity: '5.00', countedQuantity: '9.00' }] }, 'owner1'],
    ['book echo', { items: [{ materialId: 'mat1', locationId: 'loc1', bookQuantity: '6.00', countedQuantity: '8.00' }] }, 'owner1'],
    ['row set (extra row)', { items: [...input.items, { materialId: 'mat2', locationId: 'loc2', bookQuantity: '1.00', countedQuantity: '1.00' }] }, 'owner1'],
    ['row set (different row)', { items: [{ materialId: 'mat1', locationId: 'loc9', bookQuantity: '5.00', countedQuantity: '8.00' }] }, 'owner1'],
    ['reason', { remark: '临时抽盘' }, 'owner1'],
    ['operator', {}, 'owner2'],
  ])('rejects a fast-path replay whose %s differs from the posted count', async (_label, change, actorId) => {
    dbMock.inventoryCount.findUnique.mockResolvedValueOnce(storedCount());

    await expect(
      postInventoryCount({ ...input, ...change }, { id: actorId }),
    ).rejects.toThrow(new InventoryCountInvariantError(REQUEST_MISMATCH));

    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(numberMock).not.toHaveBeenCalled();
  });

  it('rejects a changed replay found after the request lock inside the transaction', async () => {
    dbMock.inventoryCount.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(summary);
    txMock.inventoryCount.findUnique.mockResolvedValue(storedCount());

    await expect(
      postInventoryCount(
        { ...input, items: [{ ...input.items[0]!, countedQuantity: '9.00' }] },
        { id: 'owner1' },
      ),
    ).rejects.toThrow(new InventoryCountInvariantError(REQUEST_MISMATCH));

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
    // One extra transaction-level shared configuration lock, independent of row count.
    expect(txMock.$executeRaw).toHaveBeenCalledTimes(4);
    expect(txMock.$executeRaw.mock.calls[0]?.[0].join('')).toContain('pg_advisory_xact_lock_shared');
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
      .mockResolvedValueOnce(
        storedCount({
          staleKeys: ['mat2:loc2'],
          staleMessage: posted.staleMessage,
          items: [
            { materialId: 'mat1', locationId: 'loc1', bookQuantity: '5.00', countedQuantity: '8.00' },
            { materialId: 'mat3', locationId: 'loc3', bookQuantity: '5.00', countedQuantity: '10.00' },
          ],
        }),
      )
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

describe('postInventoryCount 安全库存通知', () => {
  function arrangeCount(options: {
    globalStock: string;
    safetyStock: string | null;
    locations: { book: string; counted: string; actual?: string }[];
  }) {
    dbMock.inventoryCount.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(summary);
    txMock.inventoryCount.findUnique.mockResolvedValue(null);
    txMock.inventoryCount.create.mockResolvedValue({ id: 'count1' });
    txMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'mat1',
          code: 'M-001',
          name: '白卡纸',
          isActive: true,
          currentStock: options.globalStock,
          safetyStock: options.safetyStock,
        },
      ])
      .mockResolvedValueOnce(
        options.locations.map((location, index) => ({
          id: `stock${index}`,
          materialId: 'mat1',
          locationId: `loc${index}`,
          currentStock: location.actual ?? location.book,
        })),
      );
    txMock.warehouseLocation.findMany.mockResolvedValue(
      options.locations.map((_, index) => ({
        id: `loc${index}`,
        warehouseId: 'wh1',
        name: `货架${index}`,
        isActive: true,
        warehouse: { name: '默认仓库', isActive: true },
      })),
    );
    txMock.inventoryCountItem.createManyAndReturn.mockImplementation(
      (args: { data: { materialId: string; locationId: string }[] }) =>
        args.data.map((row, index) => ({ id: `item${index}`, ...row })),
    );
    const acceptedChanges = options.locations.filter(
      (location) =>
        (location.actual ?? location.book) === location.book &&
        location.book !== location.counted,
    ).length;
    txMock.$executeRaw.mockResolvedValue(acceptedChanges);
    return {
      ...input,
      items: options.locations.map((location, index) => ({
        materialId: 'mat1',
        locationId: `loc${index}`,
        bookQuantity: location.book,
        countedQuantity: location.counted,
      })),
    };
  }

  it('同物料多库位盘亏以最终全局余额只入队一次，并与盘点同事务提交', async () => {
    const request = arrangeCount({
      globalStock: '100.00',
      safetyStock: '50.00',
      locations: [
        { book: '60.00', counted: '10.00' },
        { book: '40.00', counted: '10.00' },
      ],
    });
    let committed = false;
    dbMock.$transaction.mockImplementation(async (run) => {
      const result = await run(txMock);
      committed = true;
      return result;
    });
    enqueueMock.mockImplementation(async () => {
      expect(committed).toBe(false);
      expect(txMock.materialTransaction.createMany).toHaveBeenCalledOnce();
      return true;
    });

    await postInventoryCount(request, { id: 'owner1' });

    expect(enqueueMock).toHaveBeenCalledExactlyOnceWith(
      txMock,
      'STOCK_ALERT',
      { materialName: '白卡纸', currentStock: '20.00', safetyStock: '50.00' },
      {
        dedupeKey: 'notification:STOCK_ALERT:inventory-count:count1:mat1',
        spreadIndex: 0,
      },
    );
    expect(committed).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();

    // A replay returns the committed count without reserving another delivery.
    dbMock.inventoryCount.findUnique
      .mockResolvedValueOnce(
        storedCount({
          items: [
            { materialId: 'mat1', locationId: 'loc0', bookQuantity: '60.00', countedQuantity: '10.00' },
            { materialId: 'mat1', locationId: 'loc1', bookQuantity: '40.00', countedQuantity: '10.00' },
          ],
        }),
      )
      .mockResolvedValueOnce(summary);
    await postInventoryCount(request, { id: 'owner1' });
    expect(enqueueMock).toHaveBeenCalledOnce();
  });

  it.each([
    { label: '持续低位', globalStock: '30.00', book: '30.00', counted: '20.00', safetyStock: '50.00' },
    { label: '库位低但其他库位仍充足', globalStock: '100.00', book: '30.00', counted: '20.00', safetyStock: '50.00' },
    { label: '刚好安全线', globalStock: '100.00', book: '80.00', counted: '30.00', safetyStock: '50.00' },
    { label: '盘盈回补', globalStock: '30.00', book: '20.00', counted: '50.00', safetyStock: '50.00' },
    { label: '无安全线', globalStock: '100.00', book: '100.00', counted: '0.00', safetyStock: null },
  ])('$label 不发预警', async ({ globalStock, safetyStock, book, counted }) => {
    const request = arrangeCount({
      globalStock,
      safetyStock,
      locations: [{ book, counted }],
    });
    await postInventoryCount(request, { id: 'owner1' });
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('库位盘亏被同物料另一库位盘盈抵消时不因中间余额告警', async () => {
    const request = arrangeCount({
      globalStock: '100.00',
      safetyStock: '80.00',
      locations: [
        { book: '60.00', counted: '10.00' },
        { book: '40.00', counted: '90.00' },
      ],
    });
    await postInventoryCount(request, { id: 'owner1' });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('部分过账只汇总通过CAS的库位差额', async () => {
    const request = arrangeCount({
      globalStock: '100.00',
      safetyStock: '75.00',
      locations: [
        { book: '80.00', actual: '60.00', counted: '10.00' },
        { book: '40.00', counted: '0.00' },
      ],
    });
    const result = await postInventoryCount(request, { id: 'owner1' });
    expect(result.staleKeys).toEqual(['mat1:loc0']);
    expect(enqueueMock).toHaveBeenCalledExactlyOnceWith(
      txMock,
      'STOCK_ALERT',
      { materialName: '白卡纸', currentStock: '60.00', safetyStock: '75.00' },
      expect.objectContaining({
        dedupeKey: 'notification:STOCK_ALERT:inventory-count:count1:mat1',
      }),
    );
  });

  it('inline fallback只在事务提交后发送', async () => {
    const request = arrangeCount({
      globalStock: '100.00',
      safetyStock: '50.00',
      locations: [{ book: '100.00', counted: '20.00' }],
    });
    let committed = false;
    dbMock.$transaction.mockImplementation(async (run) => {
      const result = await run(txMock);
      committed = true;
      return result;
    });
    enqueueMock.mockResolvedValue(false);
    dispatchMock.mockImplementation(async () => {
      expect(committed).toBe(true);
    });
    await postInventoryCount(request, { id: 'owner1' });
    expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(
      'STOCK_ALERT',
      { materialName: '白卡纸', currentStock: '20.00', safetyStock: '50.00' },
      {
        dedupeKey: 'notification:STOCK_ALERT:inventory-count:count1:mat1',
        spreadIndex: 0,
      },
    );
  });

  it('通知入队失败使整个盘点事务拒绝，不落入提交后发送', async () => {
    const request = arrangeCount({
      globalStock: '100.00',
      safetyStock: '50.00',
      locations: [{ book: '100.00', counted: '20.00' }],
    });
    enqueueMock.mockRejectedValue(new Error('outbox unavailable'));
    await expect(postInventoryCount(request, { id: 'owner1' })).rejects.toThrow(
      'outbox unavailable',
    );
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(dbMock.inventoryCount.findUnique).toHaveBeenCalledOnce();
  });

  it('并发重放在事务锁后发现已过账时不重复入队', async () => {
    const request = arrangeCount({
      globalStock: '100.00',
      safetyStock: '50.00',
      locations: [{ book: '100.00', counted: '20.00' }],
    });
    txMock.inventoryCount.findUnique.mockResolvedValue(
      storedCount({
        items: [
          { materialId: 'mat1', locationId: 'loc0', bookQuantity: '100.00', countedQuantity: '20.00' },
        ],
      }),
    );
    await postInventoryCount(request, { id: 'owner1' });
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('盘点提交失败时不会提前执行inline fallback', async () => {
    const request = arrangeCount({
      globalStock: '100.00',
      safetyStock: '50.00',
      locations: [{ book: '100.00', counted: '20.00' }],
    });
    enqueueMock.mockResolvedValue(false);
    dbMock.$transaction.mockImplementation(async (run) => {
      await run(txMock);
      throw new Error('commit failed');
    });
    await expect(postInventoryCount(request, { id: 'owner1' })).rejects.toThrow(
      'commit failed',
    );
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
