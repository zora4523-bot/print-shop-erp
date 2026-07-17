import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TxDirection } from '../../generated/prisma/client';

const { dbMock, txMock, movementMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    stockTransfer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    material: { findUnique: vi.fn() },
    warehouseLocation: { findUnique: vi.fn() },
  };
  return {
    txMock: tx,
    movementMock: vi.fn(),
    dbMock: {
      $transaction: vi.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
      stockTransfer: { findUnique: vi.fn(), findMany: vi.fn() },
    },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/material', () => ({
  applyMaterialStockMovement: movementMock,
  MaterialInvariantError: class MaterialInvariantError extends Error {},
}));

import { createStockTransfer } from '../stock-transfer';

const input = {
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  materialId: 'mat1',
  sourceLocationId: 'loc-a',
  destinationLocationId: 'loc-b',
  quantity: '3.00',
  remark: null,
};
const summary = {
  id: 'transfer1',
  transferNo: 'ST20260717-0001',
  materialId: 'mat1',
  sourceLocationId: 'loc-a',
  destinationLocationId: 'loc-b',
  quantity: '3.00',
  operatorId: 'owner1',
  remark: null,
  occurredAt: new Date(),
  material: { code: 'MAT1', name: '白卡纸', unit: '张' },
  sourceLocation: { code: 'A', name: 'A', warehouse: { code: 'WH', name: '仓库' } },
  destinationLocation: { code: 'B', name: 'B', warehouse: { code: 'WH', name: '仓库' } },
  operator: { displayName: '管理员' },
};

beforeEach(() => {
  for (const fn of Object.values(txMock.stockTransfer)) fn.mockReset();
  txMock.material.findUnique.mockReset();
  txMock.warehouseLocation.findUnique.mockReset();
  txMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation((cb) => cb(txMock));
  dbMock.stockTransfer.findUnique.mockReset();
  movementMock.mockReset().mockResolvedValue({ stockAlert: null });
});

describe('createStockTransfer', () => {
  it('writes paired OUT and IN movements with one transfer id', async () => {
    txMock.stockTransfer.findUnique.mockResolvedValue(null);
    txMock.stockTransfer.findFirst.mockResolvedValue(null);
    txMock.stockTransfer.create.mockResolvedValue({ id: 'transfer1' });
    txMock.material.findUnique.mockResolvedValue({ id: 'mat1', isActive: true });
    txMock.warehouseLocation.findUnique
      .mockResolvedValueOnce({ id: 'loc-a', isActive: true, warehouse: { isActive: true } })
      .mockResolvedValueOnce({ id: 'loc-b', isActive: true, warehouse: { isActive: true } });
    dbMock.stockTransfer.findUnique.mockResolvedValue(summary);

    await createStockTransfer(input, { id: 'owner1' }, new Date('2026-07-17T10:00:00+08:00'));

    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(movementMock).toHaveBeenCalledTimes(2);
    expect(movementMock.mock.calls[0][1]).toMatchObject({
      direction: TxDirection.OUT,
      stockTransferId: 'transfer1',
      locationId: 'loc-a',
    });
    expect(movementMock.mock.calls[1][1]).toMatchObject({
      direction: TxDirection.IN,
      stockTransferId: 'transfer1',
      locationId: 'loc-b',
    });
  });

  it('does not post stock again for an idempotent replay', async () => {
    txMock.stockTransfer.findUnique.mockResolvedValue({ id: 'transfer1' });
    dbMock.stockTransfer.findUnique.mockResolvedValue(summary);

    await createStockTransfer(input, { id: 'owner1' });

    expect(txMock.stockTransfer.create).not.toHaveBeenCalled();
    expect(movementMock).not.toHaveBeenCalled();
  });
});
