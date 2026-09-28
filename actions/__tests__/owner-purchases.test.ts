import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormCreationError } from '@/lib/form-drafts/creation-request';

const {
  permissionsMock,
  purchaseMock,
  revalidatePathMock,
  MockPurchaseInvariantError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  purchaseMock: {
    cancelPurchaseOrder: vi.fn(),
    cancelPurchaseReceipt: vi.fn(),
    createPurchaseOrder: vi.fn(),
    createPurchaseReceipt: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  MockPurchaseInvariantError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'PurchaseInvariantError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/purchase', () => ({
  ...purchaseMock,
  PurchaseInvariantError: MockPurchaseInvariantError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import {
  createPurchaseOrderAction,
  cancelPurchaseOrderAction,
  cancelPurchaseReceiptAction,
} from '../owner-purchases';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
  workerType: null,
  machineType: null,
};

function reasonForm(reason: string): FormData {
  const formData = new FormData();
  formData.set('reason', reason);
  return formData;
}

beforeEach(() => {
  permissionsMock.requirePermission.mockReset().mockResolvedValue(ownerActor);
  purchaseMock.cancelPurchaseOrder.mockReset();
  purchaseMock.cancelPurchaseReceipt.mockReset();
  purchaseMock.createPurchaseOrder.mockReset();
  purchaseMock.createPurchaseReceipt.mockReset();
  revalidatePathMock.mockReset();
});

it('returns a structured creation conflict for recovery without changing the native action contract', async () => {
  purchaseMock.createPurchaseOrder.mockRejectedValue(new FormCreationError('当前内容不同，请核对原单据', true));
  const form = new FormData();
  for (const [key, value] of Object.entries({ supplierPartyId: 'supplier', materialId: 'material', quantity: '124', unitCost: '2.5', draftId: '11111111-1111-4111-8111-111111111111', clientRequestId: '22222222-2222-4222-8222-222222222222' })) form.set(key, value);
  expect(await createPurchaseOrderAction(null, form)).toEqual({ status: 'error', message: '当前内容不同，请核对原单据', creationConflict: true });
  expect(revalidatePathMock).not.toHaveBeenCalled();
});

describe('cancelPurchaseReceiptAction', () => {
  it('rejects a blank cancellation reason before changing inventory', async () => {
    const result = await cancelPurchaseReceiptAction(
      'receipt-1',
      null,
      reasonForm('   '),
    );

    expect(result).toEqual({
      status: 'invalid',
      fieldErrors: { reason: ['请填写取消原因'] },
    });
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'purchase:manage',
    );
    expect(purchaseMock.cancelPurchaseReceipt).not.toHaveBeenCalled();
  });

  it('trims and records the reason before revalidating inventory surfaces', async () => {
    purchaseMock.cancelPurchaseReceipt.mockResolvedValue({ id: 'purchase-1' });

    const result = await cancelPurchaseReceiptAction(
      'receipt-1',
      null,
      reasonForm('  供应商送错物料  '),
    );

    expect(result).toEqual({
      status: 'success',
      message: '收货单已取消并写入反向库存流水',
    });
    expect(purchaseMock.cancelPurchaseReceipt).toHaveBeenCalledWith(
      'receipt-1',
      ownerActor,
      '供应商送错物料',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/purchases');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/purchases/purchase-1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/materials');
    expect(revalidatePathMock).toHaveBeenCalledWith('/foreman/materials');
  });

  it('returns a business error without claiming that reversal succeeded', async () => {
    purchaseMock.cancelPurchaseReceipt.mockRejectedValue(
      new MockPurchaseInvariantError('库存不足，无法取消入库'),
    );

    await expect(
      cancelPurchaseReceiptAction(
        'receipt-1',
        null,
        reasonForm('收货数量登记错误'),
      ),
    ).resolves.toEqual({
      status: 'error',
      message: '库存不足，无法取消入库',
    });
  });
});

describe('cancelPurchaseOrderAction', () => {
  it('keeps the existing no-reason business contract and revalidates the order', async () => {
    purchaseMock.cancelPurchaseOrder.mockResolvedValue({ id: 'purchase-1' });

    await expect(cancelPurchaseOrderAction('purchase-1')).resolves.toEqual({
      status: 'success',
      message: '采购单已取消',
    });
    expect(purchaseMock.cancelPurchaseOrder).toHaveBeenCalledWith('purchase-1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/purchases/purchase-1');
  });
});
