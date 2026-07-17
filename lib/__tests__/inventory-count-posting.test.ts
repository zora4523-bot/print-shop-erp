import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TxDirection } from '../../generated/prisma/client';

const { dbMock, txMock, movementMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    inventoryCount: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    inventoryCountItem: { create: vi.fn() },
    material: { findUnique: vi.fn() },
    warehouseLocation: { findUnique: vi.fn() },
  };
  return {
    txMock: tx,
    movementMock: vi.fn(),
    dbMock: {
      $transaction: vi.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
      inventoryCount: { findUnique: vi.fn(), findMany: vi.fn() },
    },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/material', () => ({
  applyMaterialStockMovement: movementMock,
  MaterialInvariantError: class MaterialInvariantError extends Error {},
}));

import { postInventoryCount, InventoryCountInvariantError } from '../inventory-count-posting';

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
  for (const fn of Object.values(txMock.inventoryCount)) fn.mockReset();
  txMock.inventoryCountItem.create.mockReset();
  txMock.material.findUnique.mockReset();
  txMock.warehouseLocation.findUnique.mockReset();
  txMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  txMock.$queryRaw.mockReset();
  dbMock.$transaction.mockReset().mockImplementation((cb) => cb(txMock));
  dbMock.inventoryCount.findUnique.mockReset();
  movementMock.mockReset().mockResolvedValue({ stockAlert: null });
});

describe('postInventoryCount', () => {
  it('records book/count/difference and posts the adjustment direction', async () => {
    txMock.inventoryCount.findUnique.mockResolvedValue(null);
    txMock.inventoryCount.findFirst.mockResolvedValue(null);
    txMock.inventoryCount.create.mockResolvedValue({ id: 'count1' });
    txMock.material.findUnique.mockResolvedValue({ id: 'mat1', isActive: true });
    txMock.warehouseLocation.findUnique.mockResolvedValue({
      id: 'loc1', warehouseId: 'wh1', isActive: true, warehouse: { isActive: true },
    });
    txMock.$queryRaw
      .mockResolvedValueOnce([{ id: 'mat1' }])
      .mockResolvedValueOnce([{ currentStock: '5.00' }]);
    txMock.inventoryCountItem.create.mockResolvedValue({ id: 'item1' });
    dbMock.inventoryCount.findUnique.mockResolvedValue(summary);

    await postInventoryCount(input, { id: 'owner1' }, new Date('2026-07-17T10:00:00+08:00'));

    expect(txMock.inventoryCountItem.create.mock.calls[0][0].data).toMatchObject({
      bookQuantity: '5.00', countedQuantity: '8.00', difference: '3.00',
    });
    expect(movementMock.mock.calls[0][1]).toMatchObject({
      direction: TxDirection.IN,
      quantity: '3.00',
      inventoryCountItemId: 'item1',
      locationId: 'loc1',
    });
  });

  it('rejects a duplicate material/location before opening a transaction', async () => {
    await expect(postInventoryCount({
      ...input,
      items: [...input.items, { ...input.items[0] }],
    }, { id: 'owner1' })).rejects.toBeInstanceOf(InventoryCountInvariantError);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('does not post differences again for an idempotent replay', async () => {
    txMock.inventoryCount.findUnique.mockResolvedValue({ id: 'count1' });
    dbMock.inventoryCount.findUnique.mockResolvedValue(summary);

    await postInventoryCount(input, { id: 'owner1' });

    expect(txMock.inventoryCountItem.create).not.toHaveBeenCalled();
    expect(movementMock).not.toHaveBeenCalled();
  });
});
