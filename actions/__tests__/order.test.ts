import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, Role } from '../../generated/prisma/client';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  orderMock,
  revalidatePathMock,
  redirectMock,
  MockOrderInvariantError,
  MockInvalidOrderTransitionError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  orderMock: {
    createOrder: vi.fn(),
    submitOrder: vi.fn(),
    cancelOrder: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  MockOrderInvariantError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'OrderInvariantError';
    }
  },
  MockInvalidOrderTransitionError: class extends Error {
    readonly from: OrderStatus;
    readonly to: OrderStatus;
    constructor(from: OrderStatus, to: OrderStatus) {
      super(`工单状态不能从 ${from} 直接切到 ${to}`);
      this.name = 'InvalidOrderTransitionError';
      this.from = from;
      this.to = to;
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/order', () => ({
  createOrder: orderMock.createOrder,
  submitOrder: orderMock.submitOrder,
  cancelOrder: orderMock.cancelOrder,
  OrderInvariantError: MockOrderInvariantError,
  InvalidOrderTransitionError: MockInvalidOrderTransitionError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  createOrderAction,
  submitOrderAction,
  cancelOrderAction,
} from '../order';

const salesActor = {
  id: 'sales-1',
  username: 'sal',
  displayName: '销售小王',
  role: Role.SALES,
  workerType: null,
  machineType: null,
};

function baseOrderInput(over: Record<string, unknown> = {}) {
  return {
    customerRef: '苹果福',
    receiverName: null,
    receiverPhone: null,
    receiverAddress: null,
    expressCode: null,
    packageRequirement: null,
    remark: null,
    isUrgent: false,
    items: [
      {
        name: '烫金款 A',
        productId: null,
        specification: null,
        paperType: null,
        quantity: 1000,
        crafts: ['craft-1'],
        foilColor: null,
        isDoubleSided: false,
        isDoubleColor: false,
        unitPrice: '0.5',
        suggestedPrice: null,
        remark: null,
      },
    ],
    ...over,
  };
}

const fd = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  orderMock.createOrder.mockReset();
  orderMock.submitOrder.mockReset();
  orderMock.cancelOrder.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockReset().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('createOrderAction', () => {
  it("first-line requirePermission('order:create')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(createOrderAction(null, baseOrderInput())).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('order:create');
    expect(orderMock.createOrder).not.toHaveBeenCalled();
  });

  it('short-circuits on schema failure (empty items)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    const result = await createOrderAction(null, baseOrderInput({ items: [] }));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.items).toBeDefined();
    }
    expect(orderMock.createOrder).not.toHaveBeenCalled();
  });

  it('flattens nested error paths (items.0.quantity) into dotted keys', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    const input = baseOrderInput();
    // Tamper: quantity = 0, which fails min(1) inside an item.
    const badItems = input.items.map((it) => ({ ...it, quantity: 0 }));
    const result = await createOrderAction(null, { ...input, items: badItems });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(Object.keys(result.fieldErrors).some((k) => k.startsWith('items.0'))).toBe(
        true,
      );
    }
  });

  it('maps OrderInvariantError → error status', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.createOrder.mockRejectedValueOnce(
      new MockOrderInvariantError('工艺不存在：craft-X'),
    );
    const result = await createOrderAction(null, baseOrderInput());
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('工艺不存在');
    }
  });

  it('revalidates + redirects to the new order detail page on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.createOrder.mockResolvedValue({ id: 'order-new', orderNo: '20260423-0001' });

    await expect(createOrderAction(null, baseOrderInput())).rejects.toThrow(/NEXT_REDIRECT/);

    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
    expect(redirectMock).toHaveBeenCalledWith('/orders/order-new');
  });

  it('passes the actor through to lib.createOrder (submitter + createdBy attribution)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.createOrder.mockResolvedValue({ id: 'order-new', orderNo: '20260423-0001' });

    await expect(createOrderAction(null, baseOrderInput())).rejects.toThrow(/NEXT_REDIRECT/);
    expect(orderMock.createOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'sales-1', role: Role.SALES }),
    );
  });
});

describe('submitOrderAction', () => {
  it('requires order:create', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(submitOrderAction('o1')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('maps InvalidOrderTransitionError → error (client-facing message)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.submitOrder.mockRejectedValueOnce(
      new MockInvalidOrderTransitionError(OrderStatus.IN_PRODUCTION, OrderStatus.SUBMITTED),
    );
    const r = await submitOrderAction('o1');
    expect(r.status).toBe('error');
  });

  it('revalidates both routes on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.submitOrder.mockResolvedValue({ id: 'o1', status: OrderStatus.SUBMITTED });
    const r = await submitOrderAction('o1');
    expect(r.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/o1');
  });
});

describe('cancelOrderAction', () => {
  it("first-line requirePermission('order:cancel') — cancellation is OWNER-only", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      cancelOrderAction('o1', null, fd({ reason: '' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('order:cancel');
  });

  it('accepts an empty reason and forwards null to lib.cancelOrder', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.cancelOrder.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });
    const r = await cancelOrderAction('o1', null, fd({ reason: '' }));
    expect(r.status).toBe('success');
    expect(orderMock.cancelOrder).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ id: 'sales-1', role: Role.SALES }),
      null,
    );
  });

  it('forwards a trimmed reason', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.cancelOrder.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });
    await cancelOrderAction('o1', null, fd({ reason: '  客户临时取消  ' }));
    expect(orderMock.cancelOrder).toHaveBeenCalledWith(
      'o1',
      expect.anything(),
      '客户临时取消',
    );
  });

  it('maps InvalidOrderTransitionError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.cancelOrder.mockRejectedValueOnce(
      new MockInvalidOrderTransitionError(OrderStatus.FINISHED, OrderStatus.CANCELLED),
    );
    const r = await cancelOrderAction('o1', null, fd({ reason: '' }));
    expect(r.status).toBe('error');
  });

  it('revalidates both routes on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.cancelOrder.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });
    await cancelOrderAction('o1', null, fd({ reason: '' }));
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/o1');
  });
});
