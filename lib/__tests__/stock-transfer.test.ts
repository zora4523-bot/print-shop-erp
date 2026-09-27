import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TxDirection } from '../../generated/prisma/enums';

const { dbMock, txMock, movementMock, numberMock } = vi.hoisted(() => {
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
    numberMock: vi.fn(),
    dbMock: {
      $transaction: vi.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
      stockTransfer: { findUnique: vi.fn(), findMany: vi.fn() },
    },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/daily-document-number', () => ({
  nextDailyDocumentNumber: numberMock,
  DailyDocumentNumberExhaustedError: class DailyDocumentNumberExhaustedError extends Error {},
}));
vi.mock('@/lib/material', () => ({
  applyMaterialStockMovement: movementMock,
  MaterialInvariantError: class MaterialInvariantError extends Error {},
}));

import { createStockTransfer, StockTransferInvariantError } from '../stock-transfer';

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
  numberMock.mockReset().mockResolvedValue('ST20260717-0001');
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
    dbMock.stockTransfer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(summary);

    await createStockTransfer(input, { id: 'owner1' }, new Date('2026-07-17T10:00:00+08:00'));

    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(numberMock).toHaveBeenCalledWith(
      'STOCK_TRANSFER',
      new Date('2026-07-17T10:00:00+08:00'),
    );
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
    expect(numberMock).not.toHaveBeenCalled();
  });

  it('replays the same request when only the quantity spelling differs', async () => {
    dbMock.stockTransfer.findUnique.mockResolvedValue(summary);

    const replay = await createStockTransfer({ ...input, quantity: '3' }, { id: 'owner1' });

    expect(replay.transferNo).toBe('ST20260717-0001');
    expect(txMock.stockTransfer.create).not.toHaveBeenCalled();
    expect(movementMock).not.toHaveBeenCalled();
  });

  // L-10：同一幂等键、内容不同的重提必须拒绝，不能把旧调拨单当作成功返回、
  // 静默丢掉操作员改过的数量 / 库位 / 物料。
  it.each([
    ['quantity', { quantity: '7.00' }, {}],
    ['material', { materialId: 'mat2' }, {}],
    ['source location', { sourceLocationId: 'loc-c' }, {}],
    ['destination location', { destinationLocationId: 'loc-c' }, {}],
    ['remark', { remark: '改过的备注' }, {}],
    ['operator', {}, { id: 'owner2' }],
  ])('rejects a fast-path replay whose %s differs from the committed transfer', async (_label, change, actorChange) => {
    dbMock.stockTransfer.findUnique.mockResolvedValue(summary);

    await expect(
      createStockTransfer({ ...input, ...change }, { id: 'owner1', ...actorChange }),
    ).rejects.toThrow(new StockTransferInvariantError('调拨请求与原记录不一致，请刷新页面后重新核对'));

    expect(numberMock).not.toHaveBeenCalled();
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(movementMock).not.toHaveBeenCalled();
  });

  it('rejects a replay that differs after winning the request lock inside the transaction', async () => {
    dbMock.stockTransfer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(summary);
    txMock.stockTransfer.findUnique.mockResolvedValue(summary);

    await expect(
      createStockTransfer({ ...input, quantity: '7.00' }, { id: 'owner1' }),
    ).rejects.toThrow(new StockTransferInvariantError('调拨请求与原记录不一致，请刷新页面后重新核对'));

    expect(txMock.stockTransfer.create).not.toHaveBeenCalled();
    expect(movementMock).not.toHaveBeenCalled();
  });
});
