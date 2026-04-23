import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, Role } from '../../generated/prisma/client';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  productionMock,
  revalidatePathMock,
  MockSchedulingError,
  MockOrderInvariantError,
  MockInvalidOrderTransitionError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  productionMock: { scheduleOrder: vi.fn() },
  revalidatePathMock: vi.fn(),
  MockSchedulingError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'SchedulingError';
    }
  },
  MockOrderInvariantError: class extends Error {
    constructor(msg: string) {
      super(msg);
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
vi.mock('@/lib/production', () => ({
  scheduleOrder: productionMock.scheduleOrder,
  SchedulingError: MockSchedulingError,
}));
vi.mock('@/lib/order', () => ({
  OrderInvariantError: MockOrderInvariantError,
  InvalidOrderTransitionError: MockInvalidOrderTransitionError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import { scheduleOrderAction } from '../production';

const foremanActor = {
  id: 'foreman-1',
  username: 'fm',
  displayName: '车间主管',
  role: Role.FOREMAN,
  workerType: null,
  machineType: null,
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  productionMock.scheduleOrder.mockReset();
  revalidatePathMock.mockReset();
});

const validPayload = {
  orderId: 'order-1',
  assignments: [
    { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
  ],
};

describe('scheduleOrderAction', () => {
  it("first-line requirePermission('order:schedule')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(scheduleOrderAction(null, validPayload)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('order:schedule');
    expect(productionMock.scheduleOrder).not.toHaveBeenCalled();
  });

  it('short-circuits on schema failure (path-injection workerId)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    const result = await scheduleOrderAction(null, {
      orderId: 'order-1',
      assignments: [
        { orderItemId: 'item-1', craftId: 'craft-foil', workerId: '../etc' },
      ],
    });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      // dotted path: assignments.0.workerId
      expect(
        Object.keys(result.fieldErrors).some((k) => k.startsWith('assignments.0')),
      ).toBe(true);
    }
    expect(productionMock.scheduleOrder).not.toHaveBeenCalled();
  });

  it('maps SchedulingError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    productionMock.scheduleOrder.mockRejectedValueOnce(
      new MockSchedulingError('还有工艺未派师傅：item-1:craft-glue'),
    );
    const result = await scheduleOrderAction(null, validPayload);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toMatch(/还有工艺未派师傅/);
    }
  });

  it('maps InvalidOrderTransitionError → error (e.g. already SCHEDULING)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    productionMock.scheduleOrder.mockRejectedValueOnce(
      new MockInvalidOrderTransitionError(
        OrderStatus.SCHEDULING,
        OrderStatus.SCHEDULING,
      ),
    );
    const result = await scheduleOrderAction(null, validPayload);
    expect(result.status).toBe('error');
  });

  it('maps OrderInvariantError → error (工单不存在)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    productionMock.scheduleOrder.mockRejectedValueOnce(
      new MockOrderInvariantError('工单不存在'),
    );
    const result = await scheduleOrderAction(null, validPayload);
    expect(result.status).toBe('error');
  });

  it('revalidates + returns success with tasksCreated count', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    productionMock.scheduleOrder.mockResolvedValue({
      orderId: 'order-1',
      status: OrderStatus.SCHEDULING,
      tasksCreated: 2,
      skippedOutsourceCrafts: 0,
    });
    const result = await scheduleOrderAction(null, validPayload);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.tasksCreated).toBe(2);
      expect(result.orderId).toBe('order-1');
    }
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/order-1');
  });

  it('passes the actor through to scheduleOrder', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    productionMock.scheduleOrder.mockResolvedValue({
      orderId: 'order-1',
      status: OrderStatus.SCHEDULING,
      tasksCreated: 1,
      skippedOutsourceCrafts: 0,
    });
    await scheduleOrderAction(null, validPayload);
    const args = productionMock.scheduleOrder.mock.calls[0];
    expect(args[1]).toMatchObject({ id: 'foreman-1', role: Role.FOREMAN });
  });
});
