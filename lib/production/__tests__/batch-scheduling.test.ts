import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MachineType,
  OrderStatus,
  Role,
  TaskStatus,
  WorkerType,
} from '@/generated/prisma/client';

const {
  dbMock,
  txMock,
  compatibilityMock,
  dispatchMock,
  MockSchedulingError,
} = vi.hoisted(() => {
  const transaction = {
    $executeRaw: vi.fn(),
    user: { findUnique: vi.fn() },
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    craft: { findMany: vi.fn() },
    productionTask: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    orderLog: { create: vi.fn() },
  };
  return {
    dbMock: {
      user: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    },
    txMock: transaction,
    compatibilityMock: vi.fn(),
    dispatchMock: vi.fn(),
    MockSchedulingError: class extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'SchedulingError';
      }
    },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/production', () => ({
  isWorkerCompatible: compatibilityMock,
  getWorkerAssignmentEligibility: (
    craft: { id: string; defaultMachineType: MachineType },
    worker: typeof handPressWorker & {
      craftCapabilities?: Array<{ craftId: string }>;
    },
  ) => ({
    eligible: compatibilityMock(craft, worker),
    recommended:
      worker.craftCapabilities === undefined ||
      worker.craftCapabilities.some(
        (capability) => capability.craftId === craft.id,
      ),
    machineType: worker.machineType,
    reason: null,
  }),
  SchedulingError: MockSchedulingError,
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: dispatchMock,
}));
vi.mock('@/lib/order', () => ({
  OrderInvariantError: class extends Error {},
  InvalidOrderTransitionError: class extends Error {},
}));

import { scheduleOrdersToWorker } from '../batch-scheduling';

const actor = { id: 'admin-1', role: Role.ADMIN };
const handPressWorker = {
  id: 'worker-hand',
  role: Role.WORKER,
  isActive: true,
  workerType: WorkerType.MACHINE,
  machineType: MachineType.HAND_PRESS,
};
const windmillWorker = {
  ...handPressWorker,
  id: 'worker-wind',
  machineType: MachineType.WINDMILL,
};
const handPressCraft = {
  id: 'craft-hand',
  isActive: true,
  isOutsource: false,
  defaultWorkerType: WorkerType.MACHINE,
  defaultMachineType: MachineType.HAND_PRESS,
  inHouseMachineTypes: [],
};
const windmillCraft = {
  ...handPressCraft,
  id: 'craft-wind',
  defaultMachineType: MachineType.WINDMILL,
};

function order(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    orderNo: `GD-${id}`,
    status: OrderStatus.SUBMITTED,
    items: [
      {
        id: `${id}-item`,
        quantity: 1000,
        crafts: ['craft-hand', 'craft-wind'],
      },
    ],
    outsourceOrders: [],
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.user.findUnique.mockReset().mockResolvedValue(handPressWorker);
  dbMock.$transaction
    .mockReset()
    .mockImplementation(
      async (callback: (tx: typeof txMock) => unknown) => callback(txMock),
    );
  txMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  txMock.user.findUnique.mockReset().mockResolvedValue(handPressWorker);
  txMock.order.findUnique.mockReset().mockResolvedValue(order('order-1'));
  txMock.order.update.mockReset().mockResolvedValue({ id: 'order-1' });
  txMock.craft.findMany
    .mockReset()
    .mockResolvedValue([handPressCraft, windmillCraft]);
  txMock.productionTask.findMany.mockReset().mockResolvedValue([]);
  txMock.productionTask.createMany
    .mockReset()
    .mockImplementation(async ({ data }: { data: unknown[] }) => ({
      count: data.length,
    }));
  txMock.orderLog.create.mockReset().mockResolvedValue({});
  compatibilityMock
    .mockReset()
    .mockImplementation(
      (craft: { defaultMachineType: MachineType }, worker: typeof handPressWorker) =>
        craft.defaultMachineType === worker.machineType,
    );
  dispatchMock.mockReset().mockResolvedValue(undefined);
});

describe('scheduleOrdersToWorker', () => {
  it('stages only the selected worker compatible tasks and leaves the order submitted', async () => {
    const result = await scheduleOrdersToWorker(
      { orderIds: ['order-1'], workerId: handPressWorker.id },
      actor,
    );

    expect(result.failed).toEqual([]);
    expect(result.assigned).toEqual([
      expect.objectContaining({
        orderId: 'order-1',
        tasksCreated: 1,
        remainingTaskCount: 1,
        fullyScheduled: false,
      }),
    ]);
    expect(txMock.productionTask.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          orderItemId: 'order-1-item',
          craftId: 'craft-hand',
          workerId: handPressWorker.id,
        }),
      ],
    });
    expect(txMock.order.update).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('finalizes the order after a second worker fills the last remaining task', async () => {
    dbMock.user.findUnique.mockResolvedValue(windmillWorker);
    txMock.user.findUnique.mockResolvedValue(windmillWorker);
    txMock.productionTask.findMany.mockResolvedValue([
      {
        id: 'task-hand',
        orderItemId: 'order-1-item',
        craftId: 'craft-hand',
        status: TaskStatus.PENDING,
      },
    ]);

    const result = await scheduleOrdersToWorker(
      { orderIds: ['order-1'], workerId: windmillWorker.id },
      actor,
    );

    expect(result.assigned[0]).toEqual(
      expect.objectContaining({
        tasksCreated: 1,
        remainingTaskCount: 0,
        fullyScheduled: true,
      }),
    );
    expect(txMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({ status: OrderStatus.SCHEDULING }),
      select: { id: true },
    });
    expect(dispatchMock).toHaveBeenCalledWith(
      'ORDER_SCHEDULED',
      expect.objectContaining({ orderId: 'order-1', taskCount: 2 }),
      expect.objectContaining({
        dedupeKey: 'notification:ORDER_SCHEDULED:order-1',
      }),
    );
  });

  it('rejects an order when the selected worker has no compatible remaining task', async () => {
    compatibilityMock.mockReturnValue(false);

    const result = await scheduleOrdersToWorker(
      { orderIds: ['order-1'], workerId: handPressWorker.id },
      actor,
    );

    expect(result.assigned).toEqual([]);
    expect(result.failed[0]?.message).toMatch(/没有可以承接/);
    expect(txMock.productionTask.createMany).not.toHaveBeenCalled();
  });

  it('requires and audits one reason for non-recommended tasks in a batch', async () => {
    const supportWorker = {
      ...handPressWorker,
      machineCapabilities: [MachineType.HAND_PRESS],
      craftCapabilities: [],
    };
    dbMock.user.findUnique.mockResolvedValue(supportWorker);
    txMock.user.findUnique.mockResolvedValue(supportWorker);
    txMock.order.findUnique.mockResolvedValue(
      order('order-1', {
        items: [
          {
            id: 'order-1-item',
            quantity: 1000,
            crafts: ['craft-hand'],
          },
        ],
      }),
    );

    const rejected = await scheduleOrdersToWorker(
      {
        orderIds: ['order-1'],
        workerId: supportWorker.id,
      },
      actor,
    );
    expect(rejected.assigned).toEqual([]);
    expect(rejected.failed[0]?.message).toMatch(/非推荐派工原因/);

    const result = await scheduleOrdersToWorker(
      {
        orderIds: ['order-1'],
        workerId: supportWorker.id,
        overrideReason: '临时支援',
      },
      actor,
    );
    expect(result.failed).toEqual([]);
    expect(txMock.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changedFields: expect.objectContaining({
          assignmentOverrides: [
            expect.objectContaining({ reason: '临时支援' }),
          ],
        }),
      }),
    });
  });

  it('requires an active outsource order before staging a hybrid craft', async () => {
    txMock.order.findUnique.mockResolvedValue(
      order('order-1', {
        items: [
          {
            id: 'order-1-item',
            quantity: 1000,
            crafts: ['craft-hybrid'],
          },
        ],
      }),
    );
    txMock.craft.findMany.mockResolvedValue([
      {
        ...handPressCraft,
        id: 'craft-hybrid',
        isOutsource: true,
        inHouseMachineTypes: [MachineType.HAND_PRESS],
      },
    ]);
    compatibilityMock.mockReturnValue(true);

    const result = await scheduleOrdersToWorker(
      { orderIds: ['order-1'], workerId: handPressWorker.id },
      actor,
    );

    expect(result.failed[0]?.message).toMatch(/先创建外协单/);
    expect(txMock.productionTask.createMany).not.toHaveBeenCalled();
  });

  it('reports a stale order and continues the rest of the batch', async () => {
    txMock.order.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === 'order-1'
          ? order('order-1', { status: OrderStatus.SCHEDULING })
          : order('order-2', {
              items: [
                {
                  id: 'order-2-item',
                  quantity: 500,
                  crafts: ['craft-hand'],
                },
              ],
            }),
    );

    const result = await scheduleOrdersToWorker(
      {
        orderIds: ['order-1', 'order-2'],
        workerId: handPressWorker.id,
      },
      actor,
    );

    expect(result.failed).toEqual([
      expect.objectContaining({
        orderId: 'order-1',
        message: expect.stringMatching(/刷新列表/),
      }),
    ]);
    expect(result.assigned).toEqual([
      expect.objectContaining({
        orderId: 'order-2',
        fullyScheduled: true,
      }),
    ]);
  });

  it('rejects a disabled worker before opening any order transaction', async () => {
    dbMock.user.findUnique.mockResolvedValue({
      ...handPressWorker,
      isActive: false,
    });

    await expect(
      scheduleOrdersToWorker(
        { orderIds: ['order-1'], workerId: handPressWorker.id },
        actor,
      ),
    ).rejects.toThrow(/已停用/);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });
});
