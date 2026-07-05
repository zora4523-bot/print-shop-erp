import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PartyType,
  PurchaseOrderStatus,
  PurchaseReceiptStatus,
  TxDirection,
} from '../../generated/prisma/client';

const { dbMock, txMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    warehouseLocation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    party: { findUnique: vi.fn() },
    material: { findUnique: vi.fn(), update: vi.fn() },
    materialLocationStock: { update: vi.fn() },
    materialTransaction: { create: vi.fn() },
    purchaseOrder: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    purchaseOrderItem: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    purchaseReceipt: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    purchaseReceiptItem: { create: vi.fn() },
  };
  return {
    txMock: tx,
    dbMock: {
      purchaseOrder: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn((cb: (txArg: typeof tx) => unknown) => cb(tx)),
    },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));

// STOCK_ALERT wire spy：取消入库（OUT 方向）可能把库存带破安全线，
// dispatch 必须发生在 tx 提交后。
const { notifyMock } = vi.hoisted(() => ({
  notifyMock: vi.fn<(...args: unknown[]) => void>(() => undefined),
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: notifyMock,
}));

import {
  cancelPurchaseReceipt,
  createPurchaseOrder,
  createPurchaseReceipt,
  PurchaseInvariantError,
} from '../purchase';

const actor = { id: 'owner-1' };
const now = new Date('2026-06-28T10:00:00+08:00');

const detail = {
  id: 'po1',
  purchaseNo: 'PO20260628-0001',
  supplierPartyId: 'supplier1',
  supplierCode: 'SUP_001',
  supplierName: '供应商 A',
  status: PurchaseOrderStatus.ORDERED,
  expectedDate: null,
  remark: null,
  createdAt: now,
  updatedAt: now,
  items: [],
  receipts: [],
};

beforeEach(() => {
  dbMock.purchaseOrder.findMany.mockReset();
  dbMock.purchaseOrder.findUnique.mockReset();
  dbMock.purchaseOrder.update.mockReset();
  dbMock.$transaction.mockReset().mockImplementation((cb) => cb(txMock));
  for (const group of [
    txMock.party,
    txMock.material,
    txMock.warehouseLocation,
    txMock.materialLocationStock,
    txMock.materialTransaction,
    txMock.purchaseOrder,
    txMock.purchaseOrderItem,
    txMock.purchaseReceipt,
    txMock.purchaseReceiptItem,
  ]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
  txMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  txMock.$queryRaw.mockReset();
  const defaultLocation = {
    id: 'loc-default',
    warehouseId: 'wh-default',
    isActive: true,
    warehouse: { id: 'wh-default', isActive: true },
  };
  txMock.warehouseLocation.findUnique.mockReset().mockResolvedValue(defaultLocation);
  txMock.warehouseLocation.findFirst.mockReset().mockResolvedValue(defaultLocation);
  txMock.materialLocationStock.update.mockReset().mockResolvedValue({ id: 'stock1' });
  notifyMock.mockReset();
});

describe('createPurchaseOrder', () => {
  it('copies supplier snapshot and creates the first purchase item', async () => {
    txMock.party.findUnique.mockResolvedValue({
      id: 'supplier1',
      type: PartyType.SUPPLIER,
      isActive: true,
      code: 'SUP_001',
      name: '供应商 A',
    });
    txMock.material.findUnique.mockResolvedValue({ id: 'mat1', isActive: true });
    txMock.purchaseOrder.findFirst.mockResolvedValue(null);
    txMock.purchaseOrder.create.mockResolvedValue({ id: 'po1' });
    dbMock.purchaseOrder.findUnique.mockResolvedValue(detail);

    await createPurchaseOrder(
      {
        supplierPartyId: 'supplier1',
        materialId: 'mat1',
        quantity: '10.00',
        unitCost: '1.2300',
        expectedDate: null,
        remark: null,
      },
      now,
    );

    const data = txMock.purchaseOrder.create.mock.calls[0][0].data;
    expect(data.purchaseNo).toBe('PO20260628-0001');
    expect(data.supplierCode).toBe('SUP_001');
    expect(data.supplierName).toBe('供应商 A');
    expect(data.items.create[0]).toMatchObject({
      materialId: 'mat1',
      quantity: '10.00',
      unitCost: '1.2300',
    });
  });

  it('refuses customer-only parties as suppliers', async () => {
    txMock.party.findUnique.mockResolvedValue({
      id: 'customer1',
      type: PartyType.CUSTOMER,
      isActive: true,
      code: 'CUST_001',
      name: '客户 A',
    });
    txMock.material.findUnique.mockResolvedValue({ id: 'mat1', isActive: true });

    await expect(
      createPurchaseOrder(
        {
          supplierPartyId: 'customer1',
          materialId: 'mat1',
          quantity: '10.00',
          unitCost: null,
          expectedDate: null,
          remark: null,
        },
        now,
      ),
    ).rejects.toThrowError(/客户不能作为采购供应商/);
  });
});

describe('createPurchaseReceipt', () => {
  it('supports partial receipt and writes a material IN transaction in the same transaction', async () => {
    txMock.purchaseOrder.findUnique.mockResolvedValue({
      id: 'po1',
      status: PurchaseOrderStatus.ORDERED,
    });
    txMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'poi1',
          materialId: 'mat1',
          quantity: '10.00',
          receivedQuantity: '0.00',
        },
      ])
      .mockResolvedValueOnce([{ id: 'mat1', currentStock: '5.00' }])
      .mockResolvedValueOnce([{ id: 'stock1', currentStock: '5.00' }]);
    txMock.purchaseReceipt.findFirst.mockResolvedValue(null);
    txMock.purchaseReceipt.create.mockResolvedValue({ id: 'pr1' });
    txMock.purchaseReceiptItem.create.mockResolvedValue({ id: 'pri1' });
    txMock.material.update.mockResolvedValue({ id: 'mat1' });
    txMock.materialTransaction.create.mockResolvedValue({ id: 'tx1' });
    txMock.purchaseOrderItem.update.mockResolvedValue({ id: 'poi1' });
    txMock.purchaseOrderItem.findMany.mockResolvedValue([
      { quantity: '10.00', receivedQuantity: '4.00' },
    ]);
    txMock.purchaseOrder.update.mockResolvedValue({ id: 'po1' });
    dbMock.purchaseOrder.findUnique.mockResolvedValue({
      ...detail,
      status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
    });

    await createPurchaseReceipt(
      'po1',
      {
        purchaseOrderItemId: 'poi1',
        locationId: null,
        quantity: '4.00',
        unitCost: '1.2300',
        remark: '到货一部分',
      },
      actor,
      now,
    );

    expect(txMock.material.update.mock.calls[0][0].data.currentStock).toBe('9.00');
    expect(txMock.materialLocationStock.update.mock.calls[0][0].data.currentStock).toBe('9.00');
    expect(txMock.materialTransaction.create.mock.calls[0][0].data).toMatchObject({
      materialId: 'mat1',
      warehouseId: 'wh-default',
      locationId: 'loc-default',
      direction: TxDirection.IN,
      quantity: '4.00',
      reasonType: 'PURCHASE_RECEIPT',
      purchaseReceiptItemId: 'pri1',
    });
    expect(txMock.purchaseOrder.update.mock.calls[0][0].data.status).toBe(
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
    );
  });

  it('refuses receiving more than the remaining quantity', async () => {
    txMock.purchaseOrder.findUnique.mockResolvedValue({
      id: 'po1',
      status: PurchaseOrderStatus.ORDERED,
    });
    txMock.$queryRaw.mockResolvedValueOnce([
      {
        id: 'poi1',
        materialId: 'mat1',
        quantity: '10.00',
        receivedQuantity: '8.00',
      },
    ]);

    await expect(
      createPurchaseReceipt(
        'po1',
        {
          purchaseOrderItemId: 'poi1',
          locationId: null,
          quantity: '3.00',
          unitCost: null,
          remark: null,
        },
        actor,
        now,
      ),
    ).rejects.toThrowError(/入库数量不能超过剩余 2.00/);
    expect(txMock.materialTransaction.create).not.toHaveBeenCalled();
  });
});

describe('cancelPurchaseReceipt', () => {
  it('writes a reversing OUT transaction and rolls back received quantity', async () => {
    txMock.purchaseReceipt.findUnique.mockResolvedValue({
      id: 'pr1',
      purchaseOrderId: 'po1',
      receiptNo: 'PR20260628-0001',
      status: PurchaseReceiptStatus.POSTED,
      items: [
        {
          id: 'pri1',
          purchaseOrderItemId: 'poi1',
          materialId: 'mat1',
          quantity: '4.00',
          unitCost: '1.2300',
          materialTransactions: [{ locationId: 'loc-default' }],
        },
      ],
    });
    txMock.$queryRaw
      .mockResolvedValueOnce([{ id: 'mat1', currentStock: '9.00' }])
      .mockResolvedValueOnce([{ id: 'stock1', currentStock: '9.00' }])
      .mockResolvedValueOnce([
        { id: 'poi1', quantity: '10.00', receivedQuantity: '4.00' },
      ]);
    txMock.material.update.mockResolvedValue({ id: 'mat1' });
    txMock.materialTransaction.create.mockResolvedValue({ id: 'tx2' });
    txMock.purchaseOrderItem.update.mockResolvedValue({ id: 'poi1' });
    txMock.purchaseReceipt.update.mockResolvedValue({ id: 'pr1' });
    txMock.purchaseOrderItem.findMany.mockResolvedValue([
      { quantity: '10.00', receivedQuantity: '0.00' },
    ]);
    txMock.purchaseOrder.update.mockResolvedValue({ id: 'po1' });
    dbMock.purchaseOrder.findUnique.mockResolvedValue(detail);

    await cancelPurchaseReceipt('pr1', actor, '供应商送错', now);

    expect(txMock.material.update.mock.calls[0][0].data.currentStock).toBe('5.00');
    expect(txMock.materialLocationStock.update.mock.calls[0][0].data.currentStock).toBe('5.00');
    expect(txMock.materialTransaction.create.mock.calls[0][0].data).toMatchObject({
      materialId: 'mat1',
      warehouseId: 'wh-default',
      locationId: 'loc-default',
      direction: TxDirection.OUT,
      quantity: '4.00',
      reasonType: 'PURCHASE_RECEIPT_CANCEL',
      purchaseReceiptItemId: 'pri1',
    });
    expect(txMock.purchaseReceipt.update.mock.calls[0][0].data.status).toBe(
      PurchaseReceiptStatus.CANCELLED,
    );
    expect(txMock.purchaseOrder.update.mock.calls[0][0].data.status).toBe(
      PurchaseOrderStatus.ORDERED,
    );
  });

  it('fires STOCK_ALERT after commit when cancellation crosses below safety stock', async () => {
    txMock.purchaseReceipt.findUnique.mockResolvedValue({
      id: 'pr1',
      purchaseOrderId: 'po1',
      receiptNo: 'PR20260628-0001',
      status: PurchaseReceiptStatus.POSTED,
      items: [
        {
          id: 'pri1',
          purchaseOrderItemId: 'poi1',
          materialId: 'mat1',
          quantity: '4.00',
          unitCost: null,
          materialTransactions: [{ locationId: 'loc-default' }],
        },
      ],
    });
    txMock.$queryRaw
      .mockResolvedValueOnce([{ id: 'mat1', currentStock: '5.00' }])
      .mockResolvedValueOnce([{ id: 'stock1', currentStock: '5.00' }])
      .mockResolvedValueOnce([
        { id: 'poi1', quantity: '10.00', receivedQuantity: '4.00' },
      ]);
    txMock.material.update.mockResolvedValue({
      id: 'mat1',
      name: 'A4 白卡纸',
      safetyStock: '2.00',
    });
    txMock.materialTransaction.create.mockResolvedValue({ id: 'tx2' });
    txMock.purchaseOrderItem.update.mockResolvedValue({ id: 'poi1' });
    txMock.purchaseReceipt.update.mockResolvedValue({ id: 'pr1' });
    txMock.purchaseOrderItem.findMany.mockResolvedValue([
      { quantity: '10.00', receivedQuantity: '0.00' },
    ]);
    txMock.purchaseOrder.update.mockResolvedValue({ id: 'po1' });
    dbMock.purchaseOrder.findUnique.mockResolvedValue(detail);

    await cancelPurchaseReceipt('pr1', actor, null, now);

    // 5.00 - 4.00 = 1.00 < 安全库存 2.00，且取消前 >= 2.00 → 跨越告警
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith('STOCK_ALERT', {
      materialName: 'A4 白卡纸',
      currentStock: 1,
      safetyStock: 2,
    });
  });

  it('refuses cancellation when stock would become negative', async () => {
    txMock.purchaseReceipt.findUnique.mockResolvedValue({
      id: 'pr1',
      purchaseOrderId: 'po1',
      receiptNo: 'PR20260628-0001',
      status: PurchaseReceiptStatus.POSTED,
      items: [
        {
          id: 'pri1',
          purchaseOrderItemId: 'poi1',
          materialId: 'mat1',
          quantity: '4.00',
          unitCost: null,
          materialTransactions: [{ locationId: 'loc-default' }],
        },
      ],
    });
    txMock.$queryRaw
      .mockResolvedValueOnce([{ id: 'mat1', currentStock: '1.00' }])
      .mockResolvedValueOnce([{ id: 'stock1', currentStock: '1.00' }]);

    await expect(cancelPurchaseReceipt('pr1', actor, null, now)).rejects.toBeInstanceOf(
      PurchaseInvariantError,
    );
    expect(txMock.materialTransaction.create).not.toHaveBeenCalled();
    // 事务失败时不得发出任何库存告警（幽灵消息）
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
