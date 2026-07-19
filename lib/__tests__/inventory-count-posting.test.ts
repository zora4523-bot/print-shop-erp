import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TxDirection } from '../../generated/prisma/client';

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
      $transaction: vi.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
      inventoryCount: { findUnique: vi.fn(), findMany: vi.fn() },
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
  postInventoryCount,
} from '../inventory-count-posting';

const input = {
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  remark: null,
  items: [{ materialId: 'mat1', locationId: 'loc1', countedQuantity: '8.00' }],
};
const summary = {
  id: 'count1',
  countNo: 'IC20260717-0001',
  countedAt: new Date(),
  remark: null,
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
  numberMock.mockReset().mockResolvedValue('IC20260717-0001');
});

function arrangeSingleRowPosting() {
  dbMock.inventoryCount.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(summary);
  txMock.inventoryCount.findUnique.mockResolvedValue(null);
  txMock.inventoryCount.create.mockResolvedValue({ id: 'count1' });
  txMock.$queryRaw
    .mockResolvedValueOnce([{ id: 'mat1', isActive: true }])
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
      isActive: true,
      warehouse: { isActive: true },
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

    await postInventoryCount(input, { id: 'owner1' }, now);

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
    expect(numberMock).toHaveBeenCalledWith('INVENTORY_COUNT', now);
  });

  it('rejects a duplicate material/location before reserving a number', async () => {
    await expect(
      postInventoryCount(
        { ...input, items: [...input.items, { ...input.items[0] }] },
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
  });

  it('keeps database round trips bounded for a 100-row count', async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({
      materialId: `mat${String(index).padStart(3, '0')}`,
      locationId: `loc${String(index).padStart(3, '0')}`,
      countedQuantity: '8.00',
    }));
    dbMock.inventoryCount.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(summary);
    txMock.inventoryCount.findUnique.mockResolvedValue(null);
    txMock.inventoryCount.create.mockResolvedValue({ id: 'count1' });
    txMock.$queryRaw
      .mockResolvedValueOnce(
        items.map((item) => ({ id: item.materialId, isActive: true })),
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
        isActive: true,
        warehouse: { isActive: true },
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
  });
});
