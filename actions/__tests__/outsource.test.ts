import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  outsourceMock,
  revalidatePathMock,
  MockOutsourceError,
  MockInvalidOutsourceTransitionError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  outsourceMock: {
    createOutsourceOrder: vi.fn(),
    confirmOutsourceAmount: vi.fn(),
    recordOutsourcePayment: vi.fn(),
    markOutsourceReceived: vi.fn(),
    cancelOutsourceOrder: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  MockOutsourceError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'OutsourceError';
    }
  },
  MockInvalidOutsourceTransitionError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'InvalidOutsourceTransitionError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/outsource', () => ({
  ...outsourceMock,
  OutsourceError: MockOutsourceError,
  InvalidOutsourceTransitionError: MockInvalidOutsourceTransitionError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import {
  confirmOutsourceAmountAction,
  createOutsourceAction,
  recordOutsourcePaymentAction,
} from '../outsource';

const actor = {
  id: 'owner-1',
  username: 'admin',
  displayName: '管理员',
  role: Role.ADMIN,
  workerType: null,
  machineType: null,
};
const requestKey = '00000000-0000-4000-8000-000000000001';
const createPayload = {
  idempotencyKey: requestKey,
  orderId: 'order-1',
  orderItemIds: ['item-1'],
  supplierName: '外协厂',
  supplierContact: null,
  craftDescription: '局部 UV',
  specialRequirement: null,
  totalQty: '1000',
  expectedDate: null,
  amount: null,
  remark: null,
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset().mockResolvedValue(actor);
  outsourceMock.createOutsourceOrder.mockReset();
  outsourceMock.confirmOutsourceAmount.mockReset();
  outsourceMock.recordOutsourcePayment.mockReset();
  outsourceMock.markOutsourceReceived.mockReset();
  outsourceMock.cancelOutsourceOrder.mockReset();
  revalidatePathMock.mockReset();
});

describe('createOutsourceAction', () => {
  it('authenticates before validating or writing', async () => {
    permissionsMock.requirePermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );
    await expect(
      createOutsourceAction(null, createPayload),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(outsourceMock.createOutsourceOrder).not.toHaveBeenCalled();
  });

  it('requires and forwards the browser UUID, then returns the created id', async () => {
    outsourceMock.createOutsourceOrder.mockResolvedValue({ id: 'outsource-1' });
    await expect(
      createOutsourceAction(null, createPayload),
    ).resolves.toEqual({ status: 'success', id: 'outsource-1' });
    expect(outsourceMock.createOutsourceOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: requestKey,
        orderId: 'order-1',
        totalQty: 1000,
      }),
      actor,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/foreman/outsource');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/order-1');
  });

  it('returns invalid without writing when the request key is missing', async () => {
    const result = await createOutsourceAction(null, {
      ...createPayload,
      idempotencyKey: undefined,
    });
    expect(result.status).toBe('invalid');
    expect(outsourceMock.createOutsourceOrder).not.toHaveBeenCalled();
  });
});

describe('confirmOutsourceAmountAction', () => {
  const formData = () => {
    const data = new FormData();
    data.set('idempotencyKey', requestKey);
    data.set('amount', '680.50');
    data.set('reason', '回货后按对账单确认');
    return data;
  };

  it('forwards the audit payload and revalidates the detail and source order', async () => {
    outsourceMock.confirmOutsourceAmount.mockResolvedValue({
      id: 'outsource-1',
      orderId: 'order-1',
      amount: '680.50',
    });
    await expect(
      confirmOutsourceAmountAction('outsource-1', null, formData()),
    ).resolves.toEqual({
      status: 'success',
      id: 'outsource-1',
      amount: '680.50',
    });
    expect(outsourceMock.confirmOutsourceAmount).toHaveBeenCalledWith(
      'outsource-1',
      {
        idempotencyKey: requestKey,
        amount: '680.50',
        reason: '回货后按对账单确认',
      },
      actor,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/foreman/outsource/outsource-1',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/order-1');
  });

  it('keeps domain conflicts user-visible', async () => {
    outsourceMock.confirmOutsourceAmount.mockRejectedValue(
      new MockOutsourceError('外协金额请求标识已被其他内容使用'),
    );
    await expect(
      confirmOutsourceAmountAction('outsource-1', null, formData()),
    ).resolves.toEqual({
      status: 'error',
      message: '外协金额请求标识已被其他内容使用',
    });
  });
});

describe('recordOutsourcePaymentAction', () => {
  const formData = () => {
    const data = new FormData();
    data.set('idempotencyKey', requestKey);
    data.set('amount', '320.50');
    data.set('paidAt', '2026-08-07T12:30');
    data.set('method', ' 银行转账 ');
    data.set('reference', ' PAY-001 ');
    data.set('remark', ' 首付款 ');
    return data;
  };

  it('authenticates before validating or recording a payment', async () => {
    permissionsMock.requirePermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );
    await expect(
      recordOutsourcePaymentAction('outsource-1', null, formData()),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'outsource:manage',
    );
    expect(outsourceMock.recordOutsourcePayment).not.toHaveBeenCalled();
  });

  it('parses Shanghai wall time, records the independent payment, and revalidates views', async () => {
    outsourceMock.recordOutsourcePayment.mockResolvedValue({
      paymentId: 'payment-1',
      outsourceOrderId: 'outsource-1',
      totalAmount: '1000.00',
      newPaidAmount: '320.50',
      remainingAmount: '679.50',
      isFullyPaid: false,
    });

    await expect(
      recordOutsourcePaymentAction('outsource-1', null, formData()),
    ).resolves.toEqual({
      status: 'success',
      paymentId: 'payment-1',
      totalAmount: '1000.00',
      newPaidAmount: '320.50',
      remainingAmount: '679.50',
      isFullyPaid: false,
    });
    expect(outsourceMock.recordOutsourcePayment).toHaveBeenCalledWith(
      'outsource-1',
      {
        idempotencyKey: requestKey,
        amount: '320.50',
        paidAt: new Date('2026-08-07T04:30:00.000Z'),
        method: '银行转账',
        reference: 'PAY-001',
        remark: '首付款',
      },
      actor,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/foreman/outsource');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/foreman/outsource/outsource-1',
    );
  });

  it.each([
    ['bad request key', 'idempotencyKey', 'not-a-uuid'],
    ['zero', 'amount', '0'],
    ['negative', 'amount', '-1'],
    ['overprecision', 'amount', '1.001'],
    ['bad date', 'paidAt', '2026-02-30T12:30'],
  ])('returns invalid for %s without writing', async (_name, field, value) => {
    const data = formData();
    data.set(field, value);
    const result = await recordOutsourcePaymentAction(
      'outsource-1',
      null,
      data,
    );
    expect(result.status).toBe('invalid');
    expect(outsourceMock.recordOutsourcePayment).not.toHaveBeenCalled();
  });

  it('keeps payment ledger conflicts user-visible', async () => {
    outsourceMock.recordOutsourcePayment.mockRejectedValue(
      new MockOutsourceError('付款金额超出未付余额'),
    );
    await expect(
      recordOutsourcePaymentAction('outsource-1', null, formData()),
    ).resolves.toEqual({
      status: 'error',
      message: '付款金额超出未付余额',
    });
  });

  it('rethrows unknown failures', async () => {
    outsourceMock.recordOutsourcePayment.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(
      recordOutsourcePaymentAction('outsource-1', null, formData()),
    ).rejects.toThrow('database unavailable');
  });
});
