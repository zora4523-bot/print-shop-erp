import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OrderStatus,
  OrderKind,
  Role,
  TaskStatus,
  MachineType,
  OutsourceStatus,
  WorkerType,
} from '../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => {
  const mock: {
    order: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    craft: { findMany: ReturnType<typeof vi.fn> };
    user: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    orderItem: { findMany: ReturnType<typeof vi.fn> };
    outsourceOrder: { findMany: ReturnType<typeof vi.fn> };
    productionTask: {
      createMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    salaryRule: { findFirst: ReturnType<typeof vi.fn> };
    workerMachineSalaryRule: { findFirst: ReturnType<typeof vi.fn> };
    orderLog: { create: ReturnType<typeof vi.fn> };
    // 报工数量上限倍数现在从 Setting 读（report_qty_max_multiple）
    setting: { findUnique: ReturnType<typeof vi.fn> };
    $executeRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  } = {
    order: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    craft: { findMany: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    orderItem: { findMany: vi.fn() },
    outsourceOrder: { findMany: vi.fn() },
    productionTask: {
      createMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    salaryRule: { findFirst: vi.fn() },
    workerMachineSalaryRule: { findFirst: vi.fn() },
    orderLog: { create: vi.fn() },
    setting: { findUnique: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(mock);
      return fn;
    }),
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

// Slice C：spy dispatchNotification() 验证 wire 点 fire 正确事件 +
// payload。详见 lib/__tests__/order.test.ts 同名注释。
const { notifyMock } = vi.hoisted(() => ({
  notifyMock: vi.fn<(...args: unknown[]) => void>(() => undefined),
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: notifyMock,
}));

import {
  scheduleOrder,
  SchedulingError,
  beginTask,
  beginTasks,
  reportTask,
  reassignProductionTask,
  getPendingSchedulingBoard,
  getSchedulingView,
  getWorkerAssignmentEligibility,
  getWorkerTaskDetail,
  listWorkerTasks,
  ReportError,
  OverReportError,
} from '../production';
import { OrderInvariantError } from '../order';
import { InvalidOrderTransitionError } from '../order/status-machine';
import { InvalidTaskTransitionError } from '../production/status-machine';

const foremanActor = { id: 'foreman-1', role: Role.ADMIN };
const ownerActor = { id: 'owner-1', role: Role.ADMIN };

function fixtureOrder(
  overrides: Partial<{
    status: OrderStatus;
    items: Array<{ id: string; sequence: number; quantity: number; crafts: string[] }>;
  }> = {},
) {
  return {
    id: 'order-1',
    status: OrderStatus.SUBMITTED,
    submitterId: 'sales-1',
    items: [
      {
        id: 'item-1',
        sequence: 1,
        quantity: 5000,
        crafts: ['craft-foil', 'craft-glue'],
      },
    ],
    ...overrides,
  };
}

function fixtureCrafts(
  overrides: Array<Partial<{
    id: string;
    isActive: boolean;
    isOutsource: boolean;
    defaultMachineType: string | null;
    defaultWorkerType: WorkerType | null;
  }>> = [],
) {
  const base = [
    {
      id: 'craft-foil',
      isActive: true,
      isOutsource: false,
      defaultWorkerType: WorkerType.MACHINE,
      defaultMachineType: MachineType.WINDMILL,
    },
    {
      id: 'craft-glue',
      isActive: true,
      isOutsource: false,
      defaultWorkerType: WorkerType.MACHINE,
      defaultMachineType: MachineType.GLUE,
    },
    {
      id: 'craft-outsource',
      isActive: true,
      isOutsource: true,
      defaultWorkerType: null,
      defaultMachineType: null,
    },
  ];
  if (overrides.length === 0) return base;
  return base.map((c, i) => ({ ...c, ...overrides[i] }));
}

function fixtureWorker(id: string, overrides: Partial<{
  isActive: boolean;
  role: Role;
  workerType: WorkerType | null;
  machineType: MachineType | null;
}> = {}) {
  return {
    id,
    role: Role.WORKER,
    isActive: true,
    workerType: WorkerType.MACHINE,
    machineType: id === 'worker-2' ? MachineType.GLUE : MachineType.WINDMILL,
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.order.findFirst.mockReset();
  dbMock.order.findMany.mockReset();
  dbMock.order.findUnique.mockReset();
  dbMock.order.update.mockReset();
  // 默认值要让完工闸口的覆盖分支「适用但通过」，而不是被短路：
  // fixtureCrafts() 里 craft-foil / craft-glue 都是 isOutsource:false，
  // 默认款式不进应外协集合。给 orderItem 一个空数组反而会让覆盖分支静默
  // 短路，看起来「都过了」其实一次都没走到。
  dbMock.craft.findMany.mockReset().mockResolvedValue(fixtureCrafts());
  dbMock.orderItem.findMany.mockReset().mockResolvedValue([
    { id: 'item-1', sequence: 1, name: '款式一', crafts: ['craft-foil', 'craft-glue'] },
  ]);
  dbMock.user.findMany.mockReset();
  dbMock.user.findUnique.mockReset().mockResolvedValue({
    id: 'worker-1',
    role: Role.WORKER,
    isActive: true,
    workerType: WorkerType.MACHINE,
    machineType: MachineType.HAND_PRESS,
  });
  dbMock.outsourceOrder.findMany.mockReset().mockResolvedValue([
    { id: 'outsource-1', status: OutsourceStatus.SENT },
  ]);
  dbMock.productionTask.createMany.mockReset();
  dbMock.productionTask.findUnique.mockReset();
  dbMock.productionTask.findFirst.mockReset().mockResolvedValue(null);
  dbMock.productionTask.findMany.mockReset().mockResolvedValue([]);
  dbMock.productionTask.groupBy.mockReset().mockResolvedValue([]);
  dbMock.productionTask.update.mockReset();
  dbMock.productionTask.updateMany.mockReset().mockResolvedValue({ count: 0 });
  dbMock.salaryRule.findFirst.mockReset();
  dbMock.workerMachineSalaryRule.findFirst.mockReset().mockResolvedValue(null);
  dbMock.orderLog.create.mockReset().mockResolvedValue({});
  // 默认「没有配置行」→ resolveSetting 退回内置默认 3 倍。需要别的倍数的
  // 用例自己 mockResolvedValue({ value: { multiple: N } })。
  dbMock.setting.findUnique.mockReset().mockResolvedValue(null);
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
    if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
    return fn;
  });

  dbMock.productionTask.createMany.mockResolvedValue({ count: 0 });
  dbMock.order.update.mockResolvedValue({ id: 'order-1', status: OrderStatus.SCHEDULING });
  notifyMock.mockReset().mockResolvedValue(undefined);
});

describe('scheduleOrder', () => {
  it('uses any registered machine capability and distinguishes recommended crafts', () => {
    const craft = {
      id: 'craft-hybrid',
      isOutsource: true,
      defaultWorkerType: WorkerType.MACHINE,
      defaultMachineType: MachineType.WINDMILL,
      inHouseMachineTypes: [
        MachineType.HAND_PRESS,
        MachineType.WINDMILL,
      ],
    };
    const recommended = getWorkerAssignmentEligibility(craft, {
      id: 'worker-multi',
      workerType: WorkerType.MACHINE,
      machineType: MachineType.GLUE,
      machineCapabilities: [
        MachineType.WINDMILL,
        MachineType.HAND_PRESS,
        MachineType.GLUE,
      ],
      craftCapabilities: [{ craftId: 'craft-hybrid' }],
    });
    expect(recommended).toEqual({
      eligible: true,
      recommended: true,
      machineType: MachineType.HAND_PRESS,
      reason: null,
    });

    const notRecommended = getWorkerAssignmentEligibility(craft, {
      id: 'worker-support',
      workerType: WorkerType.MACHINE,
      machineType: MachineType.WINDMILL,
      machineCapabilities: [MachineType.WINDMILL],
      craftCapabilities: [],
    });
    expect(notRecommended).toEqual(
      expect.objectContaining({ eligible: true, recommended: false }),
    );
  });

  it('requires and audits a reason when assigning an equipment-capable but non-recommended worker', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      fixtureOrder({
        items: [
          {
            id: 'item-1',
            sequence: 1,
            quantity: 5000,
            crafts: ['craft-foil'],
          },
        ],
      }),
    );
    dbMock.craft.findMany.mockResolvedValue([fixtureCrafts()[0]]);
    dbMock.user.findMany.mockResolvedValue([
      {
        ...fixtureWorker('worker-1'),
        machineCapabilities: [
          MachineType.WINDMILL,
          MachineType.HAND_PRESS,
        ],
        craftCapabilities: [],
      },
    ]);

    await expect(
      scheduleOrder(
        {
          orderId: 'order-1',
          assignments: [
            {
              orderItemId: 'item-1',
              craftId: 'craft-foil',
              workerId: 'worker-1',
            },
          ],
        },
        foremanActor,
      ),
    ).rejects.toThrow(/非推荐派工原因/);

    dbMock.productionTask.createMany.mockResolvedValue({ count: 1 });
    await scheduleOrder(
      {
        orderId: 'order-1',
        assignments: [
          {
            orderItemId: 'item-1',
            craftId: 'craft-foil',
            workerId: 'worker-1',
            overrideReason: '临时支援，已确认本人可完成',
          },
        ],
      },
      foremanActor,
    );

    expect(dbMock.productionTask.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          workerId: 'worker-1',
          machineType: MachineType.WINDMILL,
        }),
      ],
    });
    expect(dbMock.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changedFields: expect.objectContaining({
          assignmentOverrides: [
            expect.objectContaining({
              workerId: 'worker-1',
              reason: '临时支援，已确认本人可完成',
            }),
          ],
        }),
        remark: expect.stringMatching(/非推荐派工 1 项/),
      }),
    });
  });

  it('throws OrderInvariantError when the order is missing', async () => {
    dbMock.order.findFirst.mockResolvedValue(null);
    await expect(
      scheduleOrder(
        { orderId: 'nope', assignments: [] },
        foremanActor,
      ),
    ).rejects.toBeInstanceOf(OrderInvariantError);
  });

  it('throws InvalidOrderTransitionError when the order is not SUBMITTED', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      fixtureOrder({ status: OrderStatus.IN_PRODUCTION }),
    );
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    await expect(
      scheduleOrder(
        {
          orderId: 'order-1',
          assignments: [
            { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
            { orderItemId: 'item-1', craftId: 'craft-glue', workerId: 'worker-2' },
          ],
        },
        foremanActor,
      ),
    ).rejects.toBeInstanceOf(InvalidOrderTransitionError);
  });

  it('creates ProductionTask rows for every non-outsource pair, transitions to SCHEDULING', async () => {
    dbMock.order.findFirst.mockResolvedValue(fixtureOrder());
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    dbMock.user.findMany.mockResolvedValue([
      fixtureWorker('worker-1'),
      fixtureWorker('worker-2'),
    ]);
    dbMock.productionTask.createMany.mockResolvedValue({ count: 2 });

    const result = await scheduleOrder(
      {
        orderId: 'order-1',
        assignments: [
          { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
          { orderItemId: 'item-1', craftId: 'craft-glue', workerId: 'worker-2' },
        ],
      },
      foremanActor,
    );

    expect(result.status).toBe(OrderStatus.SCHEDULING);
    expect(result.tasksCreated).toBe(2);

    const taskRows = dbMock.productionTask.createMany.mock.calls[0][0].data as Array<{
      craftId: string;
      workerId: string;
      machineType: string | null;
      status: TaskStatus;
      plannedQty: number;
    }>;
    expect(taskRows).toHaveLength(2);
    const foilRow = taskRows.find((r) => r.craftId === 'craft-foil')!;
    expect(foilRow.workerId).toBe('worker-1');
    expect(foilRow.machineType).toBe(MachineType.WINDMILL);
    expect(foilRow.status).toBe(TaskStatus.PENDING);
    expect(foilRow.plannedQty).toBe(5000);

    // Order update targets SCHEDULING; goes through the status-machine check.
    const updateArg = dbMock.order.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe(OrderStatus.SCHEDULING);
    expect(updateArg.data.scheduledAt).toBeInstanceOf(Date);

    // OrderLog captures the transition.
    const logData = dbMock.orderLog.create.mock.calls[0][0].data as {
      action: string;
      changedFields: Record<string, { before: string; after: string }>;
      remark: string;
    };
    expect(logData.action).toBe('STATUS_CHANGE');
    expect(logData.changedFields.status).toEqual({
      before: OrderStatus.SUBMITTED,
      after: OrderStatus.SCHEDULING,
    });
    expect(logData.remark).toMatch(/排产：确认 2 个任务/);
  });

  it('reuses staged PENDING tasks and creates only the missing assignment', async () => {
    dbMock.order.findFirst.mockResolvedValue(fixtureOrder());
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    dbMock.user.findMany.mockResolvedValue([
      fixtureWorker('worker-1'),
      fixtureWorker('worker-2'),
    ]);
    dbMock.productionTask.findMany.mockResolvedValue([
      {
        id: 'task-staged',
        orderItemId: 'item-1',
        craftId: 'craft-foil',
        workerId: 'worker-1',
        status: TaskStatus.PENDING,
      },
    ]);
    dbMock.productionTask.createMany.mockResolvedValue({ count: 1 });
    dbMock.productionTask.update.mockResolvedValue({ id: 'task-staged' });

    const result = await scheduleOrder(
      {
        orderId: 'order-1',
        assignments: [
          {
            orderItemId: 'item-1',
            craftId: 'craft-foil',
            workerId: 'worker-1',
          },
          {
            orderItemId: 'item-1',
            craftId: 'craft-glue',
            workerId: 'worker-2',
          },
        ],
      },
      foremanActor,
    );

    expect(result.tasksCreated).toBe(2);
    expect(dbMock.productionTask.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          craftId: 'craft-glue',
          workerId: 'worker-2',
        }),
      ],
    });
    expect(dbMock.productionTask.update).toHaveBeenCalledWith({
      where: { id: 'task-staged' },
      data: expect.objectContaining({ workerId: 'worker-1' }),
      select: { id: true },
    });
  });

  it('skips outsource crafts silently and notes them on the OrderLog', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      fixtureOrder({
        items: [
          {
            id: 'item-1',
            sequence: 1,
            quantity: 5000,
            crafts: ['craft-foil', 'craft-outsource'],
          },
        ],
      }),
    );
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    dbMock.user.findMany.mockResolvedValue([fixtureWorker('worker-1')]);
    dbMock.productionTask.createMany.mockResolvedValue({ count: 1 });

    const result = await scheduleOrder(
      {
        orderId: 'order-1',
        assignments: [
          { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
        ],
      },
      foremanActor,
    );
    expect(result.tasksCreated).toBe(1);
    expect(result.skippedOutsourceCrafts).toBe(1);

    const logRemark = (dbMock.orderLog.create.mock.calls[0][0] as { data: { remark: string } })
      .data.remark;
    expect(logRemark).toMatch(/外协工艺 1 项/);
  });

  it('creates an internal machine task for a hybrid outsource + in-house foil craft', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      fixtureOrder({
        items: [
          {
            id: 'item-1',
            sequence: 1,
            quantity: 5000,
            crafts: ['craft-hybrid'],
          },
        ],
      }),
    );
    dbMock.craft.findMany.mockResolvedValue([
      {
        id: 'craft-hybrid',
        isActive: true,
        isOutsource: true,
        defaultWorkerType: WorkerType.MACHINE,
        defaultMachineType: MachineType.WINDMILL,
        inHouseMachineTypes: [MachineType.HAND_PRESS, MachineType.WINDMILL],
      },
    ]);
    dbMock.user.findMany.mockResolvedValue([
      fixtureWorker('worker-1', { machineType: MachineType.HAND_PRESS }),
    ]);
    dbMock.productionTask.createMany.mockResolvedValue({ count: 1 });

    const result = await scheduleOrder(
      {
        orderId: 'order-1',
        assignments: [
          {
            orderItemId: 'item-1',
            craftId: 'craft-hybrid',
            workerId: 'worker-1',
          },
        ],
      },
      foremanActor,
    );

    expect(result.tasksCreated).toBe(1);
    expect(result.skippedOutsourceCrafts).toBe(1);
    expect(dbMock.productionTask.createMany.mock.calls[0][0].data[0]).toEqual(
      expect.objectContaining({
        craftId: 'craft-hybrid',
        workerId: 'worker-1',
        machineType: MachineType.HAND_PRESS,
      }),
    );
  });

  it('rejects an assignment targeting an outsource craft (they go to an outsource order, not production)', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      fixtureOrder({
        items: [
          {
            id: 'item-1',
            sequence: 1,
            quantity: 5000,
            crafts: ['craft-outsource'],
          },
        ],
      }),
    );
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    await expect(
      scheduleOrder(
        {
          orderId: 'order-1',
          assignments: [
            { orderItemId: 'item-1', craftId: 'craft-outsource', workerId: 'worker-1' },
          ],
        },
        foremanActor,
      ),
    ).rejects.toThrow(/外协/);
  });

  it('rejects duplicate assignment of the same (item, craft) pair', async () => {
    dbMock.order.findFirst.mockResolvedValue(fixtureOrder());
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    await expect(
      scheduleOrder(
        {
          orderId: 'order-1',
          assignments: [
            { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
            { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-2' },
          ],
        },
        foremanActor,
      ),
    ).rejects.toThrow(/重复派工/);
  });

  it('rejects partial scheduling — some non-outsource crafts unassigned', async () => {
    dbMock.order.findFirst.mockResolvedValue(fixtureOrder());
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    await expect(
      scheduleOrder(
        {
          orderId: 'order-1',
          assignments: [
            { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
          ],
        },
        foremanActor,
      ),
    ).rejects.toThrow(/还有工艺未派师傅/);
  });

  it('rejects a worker that is not a Role.WORKER', async () => {
    dbMock.order.findFirst.mockResolvedValue(fixtureOrder());
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    dbMock.user.findMany.mockResolvedValue([
      { id: 'worker-1', role: Role.SALES, isActive: true, machineType: null },
      fixtureWorker('worker-2'),
    ]);
    await expect(
      scheduleOrder(
        {
          orderId: 'order-1',
          assignments: [
            { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
            { orderItemId: 'item-1', craftId: 'craft-glue', workerId: 'worker-2' },
          ],
        },
        foremanActor,
      ),
    ).rejects.toThrow(/不是师傅/);
  });

  it('rejects an inactive worker (paused account)', async () => {
    dbMock.order.findFirst.mockResolvedValue(fixtureOrder());
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    dbMock.user.findMany.mockResolvedValue([
      fixtureWorker('worker-1', { isActive: false }),
      fixtureWorker('worker-2'),
    ]);
    await expect(
      scheduleOrder(
        {
          orderId: 'order-1',
          assignments: [
            { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
            { orderItemId: 'item-1', craftId: 'craft-glue', workerId: 'worker-2' },
          ],
        },
        foremanActor,
      ),
    ).rejects.toThrow(/已停用/);
  });

  it('rejects an unknown workerId', async () => {
    dbMock.order.findFirst.mockResolvedValue(fixtureOrder());
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    dbMock.user.findMany.mockResolvedValue([fixtureWorker('worker-2')]);
    await expect(
      scheduleOrder(
        {
          orderId: 'order-1',
          assignments: [
            { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'ghost' },
            { orderItemId: 'item-1', craftId: 'craft-glue', workerId: 'worker-2' },
          ],
        },
        foremanActor,
      ),
    ).rejects.toThrow(/师傅不存在/);
  });

  it('rejects a worker whose job type does not match the craft', async () => {
    dbMock.order.findFirst.mockResolvedValue(fixtureOrder());
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    dbMock.user.findMany.mockResolvedValue([
      fixtureWorker('worker-1', {
        workerType: WorkerType.PACKER,
        machineType: null,
      }),
      fixtureWorker('worker-2'),
    ]);
    await expect(
      scheduleOrder(
        {
          orderId: 'order-1',
          assignments: [
            { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
            { orderItemId: 'item-1', craftId: 'craft-glue', workerId: 'worker-2' },
          ],
        },
        foremanActor,
      ),
    ).rejects.toThrow(/岗位.*不匹配/);
  });

  it('creates a non-machine PACKER task with a worker-type snapshot', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      fixtureOrder({
        items: [{ id: 'item-1', sequence: 1, quantity: 5000, crafts: ['craft-pack'] }],
      }),
    );
    dbMock.craft.findMany.mockResolvedValue([{
      id: 'craft-pack',
      isActive: true,
      isOutsource: false,
      defaultWorkerType: WorkerType.PACKER,
      defaultMachineType: null,
    }]);
    dbMock.user.findMany.mockResolvedValue([
      fixtureWorker('packer-1', { workerType: WorkerType.PACKER, machineType: null }),
    ]);
    dbMock.productionTask.createMany.mockResolvedValue({ count: 1 });
    await scheduleOrder(
      {
        orderId: 'order-1',
        assignments: [{
          orderItemId: 'item-1',
          craftId: 'craft-pack',
          workerId: 'packer-1',
        }],
      },
      foremanActor,
    );
    expect(dbMock.productionTask.createMany.mock.calls[0][0].data[0]).toEqual(
      expect.objectContaining({
        workerType: WorkerType.PACKER,
        machineType: null,
      }),
    );
  });

  it('all-outsource order: zero tasks, linked outsource keeps it in SCHEDULING', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      fixtureOrder({
        items: [
          {
            id: 'item-1',
            sequence: 1,
            quantity: 5000,
            crafts: ['craft-outsource'],
          },
        ],
      }),
    );
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    dbMock.user.findMany.mockResolvedValue([]);
    dbMock.productionTask.createMany.mockResolvedValue({ count: 0 });

    const result = await scheduleOrder(
      { orderId: 'order-1', assignments: [] },
      ownerActor,
    );
    expect(result.status).toBe(OrderStatus.SCHEDULING);
    expect(result.tasksCreated).toBe(0);
    expect(result.skippedOutsourceCrafts).toBe(1);
  });

  it('refuses to schedule outsource work before an outsource order is linked', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      fixtureOrder({
        items: [{
          id: 'item-1',
          sequence: 1,
          quantity: 5000,
          crafts: ['craft-outsource'],
        }],
      }),
    );
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    dbMock.outsourceOrder.findMany.mockResolvedValue([]);
    await expect(
      scheduleOrder({ orderId: 'order-1', assignments: [] }, ownerActor),
    ).rejects.toThrow(/先.*创建外协单/);
  });

  it('completes an outsource-only order immediately when all linked work is already received', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      fixtureOrder({
        items: [{ id: 'item-1', sequence: 1, quantity: 5000, crafts: ['craft-outsource'] }],
      }),
    );
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    dbMock.user.findMany.mockResolvedValue([]);
    dbMock.outsourceOrder.findMany.mockResolvedValue([
      {
        id: 'outsource-1',
        status: OutsourceStatus.RECEIVED,
        orderItemIds: ['item-1'],
        itemSnapshots: [{ orderItemId: 'item-1', quantity: 5000 }],
      },
    ]);
    dbMock.orderItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        sequence: 1,
        name: '款式一',
        quantity: 5000,
        crafts: ['craft-outsource'],
      },
    ]);
    dbMock.productionTask.createMany.mockResolvedValue({ count: 0 });
    dbMock.productionTask.findMany.mockResolvedValue([]);
    dbMock.order.findUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        status: OrderStatus.SCHEDULING,
        requiresOutsource: true,
      })
      .mockResolvedValueOnce({ orderNo: 'O-OUT', customerRef: null });

    const result = await scheduleOrder(
      { orderId: 'order-1', assignments: [] },
      ownerActor,
    );
    expect(result.status).toBe(OrderStatus.COMPLETED);
    expect(result.orderCompleted).toBe(true);
    expect(dbMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: OrderStatus.COMPLETED }),
      }),
    );
  });

  it('acquires a per-order advisory xact lock before reading (Codex round 37 / P0)', async () => {
    dbMock.order.findFirst.mockResolvedValue(fixtureOrder());
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    dbMock.user.findMany.mockResolvedValue([
      fixtureWorker('worker-1'),
      fixtureWorker('worker-2'),
    ]);
    dbMock.productionTask.createMany.mockResolvedValue({ count: 2 });
    await scheduleOrder(
      {
        orderId: 'order-1',
        assignments: [
          { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
          { orderItemId: 'item-1', craftId: 'craft-glue', workerId: 'worker-2' },
        ],
      },
      foremanActor,
    );
    const firstCall = dbMock.$executeRaw.mock.calls[0];
    expect(firstCall).toBeDefined();
    const sql = (firstCall[0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    // Key value is passed as the template parameter. Unified key
    // namespace with transitionWithLog + worker cascade so all
    // Order.status writers serialize on the same lock (Codex round 88).
    expect(firstCall[1]).toMatch(/print-shop-erp:order-cascade:order-1/);
  });

  it('refuses when a craft on the order has been deactivated (Codex round 37 / P1)', async () => {
    dbMock.order.findFirst.mockResolvedValue(fixtureOrder());
    // craft-foil still exists but is now inactive — e.g. the owner
    // stopped it between submit and schedule.
    dbMock.craft.findMany.mockResolvedValue(
      fixtureCrafts().map((c) =>
        c.id === 'craft-foil' ? { ...c, isActive: false } : c,
      ),
    );
    await expect(
      scheduleOrder(
        {
          orderId: 'order-1',
          assignments: [
            { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
            { orderItemId: 'item-1', craftId: 'craft-glue', workerId: 'worker-2' },
          ],
        },
        foremanActor,
      ),
    ).rejects.toThrow(/工艺已停用/);
  });

  it('refuses when an order references a craft id that no longer exists in the dictionary', async () => {
    dbMock.order.findFirst.mockResolvedValue(
      fixtureOrder({
        items: [
          {
            id: 'item-1',
            sequence: 1,
            quantity: 5000,
            crafts: ['craft-foil', 'craft-deleted'],
          },
        ],
      }),
    );
    // Dictionary lookup returns only the remaining crafts.
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    await expect(
      scheduleOrder(
        {
          orderId: 'order-1',
          assignments: [
            { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
          ],
        },
        foremanActor,
      ),
    ).rejects.toBeInstanceOf(SchedulingError);
  });

  // ─── Slice C wire spec ───
  it('scheduleOrder fires notify("ORDER_SCHEDULED") with orderNo + taskCount', async () => {
    dbMock.order.findFirst.mockResolvedValue(fixtureOrder());
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    dbMock.user.findMany.mockResolvedValue([
      fixtureWorker('worker-1'),
      fixtureWorker('worker-2'),
    ]);
    dbMock.productionTask.createMany.mockResolvedValue({ count: 2 });
    // post-tx findUnique 取 orderNo
    dbMock.order.findUnique.mockResolvedValue({ orderNo: 'O-42' });

    await scheduleOrder(
      {
        orderId: 'order-1',
        assignments: [
          { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
          { orderItemId: 'item-1', craftId: 'craft-glue', workerId: 'worker-2' },
        ],
      },
      foremanActor,
    );
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
      'ORDER_SCHEDULED',
      {
        orderId: 'order-1',
        orderNo: 'O-42',
        taskCount: 2,
      },
      { dedupeKey: 'notification:ORDER_SCHEDULED:order-1' },
    );
  });

  it('scheduleOrder 业务异常（dup assignment）→ 不触发 notify', async () => {
    dbMock.order.findFirst.mockResolvedValue(fixtureOrder());
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());
    await expect(
      scheduleOrder(
        {
          orderId: 'order-1',
          assignments: [
            { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-1' },
            { orderItemId: 'item-1', craftId: 'craft-foil', workerId: 'worker-2' },
          ],
        },
        foremanActor,
      ),
    ).rejects.toThrow();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

// Shared fixtures for the worker-flow suites.
const workerActor = { id: 'worker-1', role: Role.WORKER };

function fixtureTask(
  overrides: Partial<{
    status: TaskStatus;
    workerId: string | null;
    workerType: WorkerType | null;
    machineType: MachineType | null;
    plannedQty: number;
    remark: string | null;
    orderStatus: OrderStatus;
    isDoubleSided: boolean;
    isDoubleColor: boolean;
  }> = {},
) {
  const {
    orderStatus,
    isDoubleSided,
    isDoubleColor,
    ...taskLevel
  } = overrides;
  return {
    id: 'task-1',
    status: TaskStatus.PENDING,
    workerId: 'worker-1',
    workerType: WorkerType.MACHINE,
    machineType: MachineType.HAND_PRESS,
    plannedQty: 5000,
    remark: null,
    ...taskLevel,
    orderItem: {
      id: 'item-1',
      orderId: 'order-1',
      isDoubleSided: isDoubleSided ?? false,
      isDoubleColor: isDoubleColor ?? false,
      name: '款式 A',
      sequence: 1,
      order: {
        id: 'order-1',
        status: orderStatus ?? OrderStatus.SCHEDULING,
      },
    },
  };
}

// Seed-matching HAND_PRESS rule.
const HAND_PRESS_RULE = {
  dailyBase: 100,
  pieceRate: 0.007,
  boardRate: 5,
  smallOrderThreshold: 1000,
  smallOrderFlatPrice: 12,
  multiplierFactors: ['DOUBLE_SIDED', 'DOUBLE_COLOR'],
};

describe('beginTask', () => {
  it('throws ReportError when the task does not exist', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(null);
    await expect(beginTask('ghost', workerActor)).rejects.toBeInstanceOf(
      ReportError,
    );
  });

  it('rejects a worker starting another worker\'s task', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ workerId: 'worker-OTHER' }),
    );
    await expect(beginTask('task-1', workerActor)).rejects.toThrow(
      /只能开始分配给自己的任务/,
    );
  });

  it('refuses to begin a task cancelled with its order (A1)', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ status: TaskStatus.CANCELLED }),
    );
    await expect(beginTask('task-1', workerActor)).rejects.toThrow(
      /已随工单取消，不能开工/,
    );
    // No status write happens for a voided task.
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('keeps staged tasks hidden from production until every craft is assigned', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ orderStatus: OrderStatus.SUBMITTED }),
    );
    await expect(beginTask('task-1', workerActor)).rejects.toThrow(
      /还有工艺未完成排产/,
    );
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('refuses pickup when the assigned worker machine no longer matches', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(fixtureTask());
    dbMock.user.findUnique.mockResolvedValue({
      id: 'worker-1',
      role: Role.WORKER,
      isActive: true,
      workerType: WorkerType.MACHINE,
      machineType: MachineType.GLUE,
    });
    await expect(beginTask('task-1', workerActor)).rejects.toThrow(
      /岗位或机型不匹配.*改派/,
    );
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('allows pickup on a registered secondary machine capability', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ machineType: MachineType.WINDMILL }),
    );
    dbMock.user.findUnique.mockResolvedValue({
      id: 'worker-1',
      role: Role.WORKER,
      isActive: true,
      workerType: WorkerType.MACHINE,
      machineType: MachineType.HAND_PRESS,
      machineCapabilities: [MachineType.HAND_PRESS, MachineType.WINDMILL],
    });
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.IN_PROGRESS,
    });
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SCHEDULING,
    });

    await expect(beginTask('task-1', workerActor)).resolves.toMatchObject({
      status: TaskStatus.IN_PROGRESS,
    });
  });

  it('serializes the task write on the per-ORDER cascade lock — the same key cancelOrder holds (A1 race guard)', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(fixtureTask());
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.IN_PROGRESS,
    });
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SCHEDULING,
    });
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
    });

    await beginTask('task-1', workerActor);

    // The FIRST advisory lock taken is the order-cascade key (shared with
    // cancelOrder), NOT the per-task key — this is what serializes 开工
    // against a concurrent 取消 and prevents the resurrection/half-cancel.
    const firstLockValue = dbMock.$executeRaw.mock.calls[0][1];
    expect(firstLockValue).toBe('print-shop-erp:order-cascade:order-1');

    // And it is acquired BEFORE the task status is written.
    const lockCallOrder = dbMock.$executeRaw.mock.invocationCallOrder[0];
    const taskUpdateOrder =
      dbMock.productionTask.update.mock.invocationCallOrder[0];
    expect(lockCallOrder).toBeLessThan(taskUpdateOrder);
  });

  it('ADMIN global override starts someone else\'s task', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ workerId: 'worker-OTHER' }),
    );
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.IN_PROGRESS,
    });
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SCHEDULING,
    });
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
    });
    const r = await beginTask('task-1', { id: 'o', role: Role.ADMIN });
    expect(r.status).toBe(TaskStatus.IN_PROGRESS);
  });

  it('transitions PENDING → IN_PROGRESS and stamps startedAt', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(fixtureTask());
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.IN_PROGRESS,
    });
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SCHEDULING,
    });
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
    });
    const now = new Date('2026-04-23T09:00:00Z');
    await beginTask('task-1', workerActor, now);
    const updateArg = dbMock.productionTask.update.mock.calls[0][0] as {
      data: { status: TaskStatus; startedAt: Date };
    };
    expect(updateArg.data.status).toBe(TaskStatus.IN_PROGRESS);
    expect(updateArg.data.startedAt).toBe(now);
  });

  it('cascades SCHEDULING → IN_PRODUCTION on first task pickup', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(fixtureTask());
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.IN_PROGRESS,
    });
    // Fresh-read inside cascade lock confirms the order is still
    // SCHEDULING, so cascade proceeds.
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SCHEDULING,
    });
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
    });
    const r = await beginTask('task-1', workerActor);
    expect(r.orderStatusChanged).toBe(true);
    const orderUpdate = dbMock.order.update.mock.calls[0][0];
    expect(orderUpdate.data.status).toBe(OrderStatus.IN_PRODUCTION);
    const log = dbMock.orderLog.create.mock.calls[0][0].data as {
      action: string;
      changedFields: Record<string, { before: string; after: string }>;
    };
    expect(log.action).toBe('STATUS_CHANGE');
    expect(log.changedFields.status).toEqual({
      before: OrderStatus.SCHEDULING,
      after: OrderStatus.IN_PRODUCTION,
    });
  });

  it('beginTask fresh-read: skips cascade if a concurrent tx already transitioned the order (Codex round 39 / P2)', async () => {
    // Initial snapshot sees SCHEDULING. After the cascade lock is
    // acquired, the fresh read shows IN_PRODUCTION — another worker
    // got here first. We must not re-emit the transition (which would
    // write a duplicate STATUS_CHANGE log and break the status machine).
    dbMock.productionTask.findUnique.mockResolvedValue(fixtureTask());
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.IN_PROGRESS,
    });
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
    });
    const r = await beginTask('task-1', workerActor);
    expect(r.orderStatusChanged).toBe(false);
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('does not cascade when order is already IN_PRODUCTION', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ orderStatus: OrderStatus.IN_PRODUCTION }),
    );
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.IN_PROGRESS,
    });
    const r = await beginTask('task-1', workerActor);
    expect(r.orderStatusChanged).toBe(false);
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('idempotent: second begin on already IN_PROGRESS task is a no-op', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ status: TaskStatus.IN_PROGRESS }),
    );
    const r = await beginTask('task-1', workerActor);
    expect(r.status).toBe(TaskStatus.IN_PROGRESS);
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('refuses to begin a COMPLETED task', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ status: TaskStatus.COMPLETED }),
    );
    await expect(beginTask('task-1', workerActor)).rejects.toBeInstanceOf(
      InvalidTaskTransitionError,
    );
  });
});

describe('reassignProductionTask', () => {
  it('reassigns a PENDING task to a compatible active worker and logs it', async () => {
    dbMock.productionTask.findUnique
      .mockResolvedValueOnce({
        id: 'task-1',
        orderItem: { orderId: 'order-1' },
      })
      .mockResolvedValueOnce({
        id: 'task-1',
        status: TaskStatus.PENDING,
        workerId: 'worker-old',
        orderItem: { orderId: 'order-1', name: '款式 A', sequence: 1 },
        craft: {
          id: 'craft-foil',
          isOutsource: false,
          defaultWorkerType: WorkerType.MACHINE,
          defaultMachineType: MachineType.WINDMILL,
        },
      });
    dbMock.user.findUnique.mockResolvedValue({
      id: 'worker-new',
      displayName: '新师傅',
      role: Role.WORKER,
      isActive: true,
      workerType: WorkerType.MACHINE,
      machineType: MachineType.WINDMILL,
    });
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      workerId: 'worker-new',
      status: TaskStatus.PENDING,
    });

    const result = await reassignProductionTask(
      'task-1',
      'worker-new',
      ownerActor,
    );
    expect(result.workerId).toBe('worker-new');
    expect(dbMock.productionTask.update.mock.calls[0][0].data).toEqual({
      workerId: 'worker-new',
      workerType: WorkerType.MACHINE,
      machineType: MachineType.WINDMILL,
    });
    expect(dbMock.orderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'TASK_REASSIGN' }),
      }),
    );
  });

  it('refuses to move an already-started task', async () => {
    dbMock.productionTask.findUnique
      .mockResolvedValueOnce({
        id: 'task-1',
        orderItem: { orderId: 'order-1' },
      })
      .mockResolvedValueOnce({
        id: 'task-1',
        status: TaskStatus.IN_PROGRESS,
        workerId: 'worker-old',
        orderItem: { orderId: 'order-1', name: '款式 A', sequence: 1 },
        craft: {
          id: 'craft-foil',
          isOutsource: false,
          defaultWorkerType: WorkerType.MACHINE,
          defaultMachineType: MachineType.WINDMILL,
        },
      });
    await expect(
      reassignProductionTask('task-1', 'worker-new', ownerActor),
    ).rejects.toThrow(/只有未开工任务/);
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });
});

describe('beginTasks', () => {
  function batchTask(
    id: string,
    workerId = 'worker-1',
    orderStatus: OrderStatus = OrderStatus.SCHEDULING,
  ) {
    return {
      id,
      status: TaskStatus.PENDING,
      workerId,
      workerType: WorkerType.MACHINE,
      machineType: MachineType.HAND_PRESS,
      orderItem: {
        name: `款式 ${id}`,
        sequence: 1,
        orderId: 'order-1',
        order: { id: 'order-1', status: orderStatus },
      },
    };
  }

  it('starts all selected pending tasks and advances their order once', async () => {
    const tasks = [batchTask('task-1'), batchTask('task-2')];
    dbMock.productionTask.findMany.mockResolvedValue(tasks);
    dbMock.order.findUnique.mockResolvedValue({
      status: OrderStatus.SCHEDULING,
    });
    dbMock.productionTask.updateMany.mockResolvedValue({ count: 2 });

    const result = await beginTasks(
      ['task-2', 'task-1', 'task-1'],
      workerActor,
      new Date('2026-07-31T08:00:00Z'),
    );

    expect(result.taskIds).toEqual(['task-1', 'task-2']);
    expect(dbMock.productionTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['task-1', 'task-2'] },
        status: TaskStatus.PENDING,
      },
      data: {
        status: TaskStatus.IN_PROGRESS,
        startedAt: new Date('2026-07-31T08:00:00Z'),
      },
    });
    expect(dbMock.order.update).toHaveBeenCalledTimes(1);
  });

  it('validates the complete selection before writing any task', async () => {
    dbMock.productionTask.findMany.mockResolvedValue([
      batchTask('task-1'),
      batchTask('task-2', 'worker-2'),
    ]);

    await expect(
      beginTasks(['task-1', 'task-2'], workerActor),
    ).rejects.toThrow(/只能开始分配给自己的任务/);
    expect(dbMock.productionTask.updateMany).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('rejects staged tasks whose order is still submitted', async () => {
    const staged = batchTask(
      'task-1',
      'worker-1',
      OrderStatus.SUBMITTED,
    );
    dbMock.productionTask.findMany.mockResolvedValue([staged]);

    await expect(
      beginTasks(['task-1'], workerActor),
    ).rejects.toThrow(/尚未完成全部排产/);
    expect(dbMock.productionTask.updateMany).not.toHaveBeenCalled();
  });

  it('batch-starts tasks assigned on a registered secondary machine capability', async () => {
    const task = {
      ...batchTask('task-1'),
      machineType: MachineType.WINDMILL,
    };
    dbMock.productionTask.findMany.mockResolvedValue([task]);
    dbMock.user.findUnique.mockResolvedValue({
      id: 'worker-1',
      role: Role.WORKER,
      isActive: true,
      workerType: WorkerType.MACHINE,
      machineType: MachineType.HAND_PRESS,
      machineCapabilities: [MachineType.HAND_PRESS, MachineType.WINDMILL],
    });
    dbMock.order.findUnique.mockResolvedValue({
      status: OrderStatus.SCHEDULING,
    });

    await expect(beginTasks(['task-1'], workerActor)).resolves.toEqual({
      taskIds: ['task-1'],
    });
    expect(dbMock.productionTask.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('worker task visibility', () => {
  it('excludes staged tasks while their order is still submitted', async () => {
    dbMock.productionTask.findMany.mockResolvedValue([]);

    await listWorkerTasks('worker-1');

    expect(dbMock.productionTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workerId: 'worker-1',
          orderItem: {
            order: { status: { not: OrderStatus.SUBMITTED } },
          },
        }),
      }),
    );
  });
});

describe('getWorkerTaskDetail', () => {
  // 这个函数原来是 findUnique 整行读出来、再在 JS 里判 workerId 和
  // 工单状态。改成 findFirst + lib/auth/task-scope 的共享片段之后，
  // 同一条 authz 规则只剩一份（标题查询 lib/page-title/refs.ts 也用它）。
  // 下面钉住等价性：闸口确实落在 where 上，不是 SQL 拉全量再过滤。
  it('ADMIN 无行级限制，where 只有主键', async () => {
    await getWorkerTaskDetail('task-1', ownerActor);

    expect(dbMock.productionTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-1' } }),
    );
  });

  it('WORKER 的 where 带 workerId 与「工单已离开 SUBMITTED」', async () => {
    await getWorkerTaskDetail('task-1', { id: 'worker-1', role: Role.WORKER });

    expect(dbMock.productionTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'task-1',
          workerId: 'worker-1',
          orderItem: { order: { status: { not: OrderStatus.SUBMITTED } } },
        },
      }),
    );
  });

  it('查不到（被 where 挡掉或本就不存在）时返回 null', async () => {
    dbMock.productionTask.findFirst.mockResolvedValue(null);

    await expect(
      getWorkerTaskDetail('task-1', { id: 'worker-9', role: Role.WORKER }),
    ).resolves.toBeNull();
  });
});

describe('reportTask', () => {
  const validInput = { completedQty: 4900, defectQty: 50, reworkQty: 50 };

  it('throws ReportError when the task is missing', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(null);
    await expect(
      reportTask('ghost', validInput, workerActor),
    ).rejects.toBeInstanceOf(ReportError);
  });

  it('rejects a worker reporting another worker\'s task', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ status: TaskStatus.IN_PROGRESS, workerId: 'worker-OTHER' }),
    );
    await expect(
      reportTask('task-1', validInput, workerActor),
    ).rejects.toThrow(/只能报工分配给自己的任务/);
  });

  it('refuses to report when a machine task has no machineType', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ status: TaskStatus.IN_PROGRESS, machineType: null }),
    );
    await expect(
      reportTask('task-1', validInput, workerActor),
    ).rejects.toThrow(/缺少机型快照/);
  });

  it('completes a PACKER task without creating machine piecework', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({
        status: TaskStatus.IN_PROGRESS,
        workerType: WorkerType.PACKER,
        machineType: null,
        orderStatus: OrderStatus.IN_PRODUCTION,
      }),
    );
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.COMPLETED,
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.COMPLETED },
      { id: 'task-2', status: TaskStatus.PENDING },
    ]);

    const result = await reportTask('task-1', validInput, workerActor);
    expect(result.pieceworkAmount).toBe('0.00');
    expect(result.boardCount).toBe(0);
    expect(result.pressCount).toBe(0);
    expect(dbMock.salaryRule.findFirst).not.toHaveBeenCalled();
    expect(dbMock.productionTask.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        salaryRuleSnapshot: {
          payrollMode: 'HOURLY',
          workerType: WorkerType.PACKER,
        },
      }),
    );
  });

  it('refuses to report a task cancelled with its order — no piecework computed (A1)', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ status: TaskStatus.CANCELLED }),
    );
    await expect(
      reportTask('task-1', validInput, workerActor),
    ).rejects.toThrow(/已随工单取消，不能报工/);
    // Guarded before any rule lookup or piecework write.
    expect(dbMock.salaryRule.findFirst).not.toHaveBeenCalled();
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('refuses to report when no active SalaryRule exists for the machineType', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ status: TaskStatus.IN_PROGRESS }),
    );
    dbMock.salaryRule.findFirst.mockResolvedValue(null);
    await expect(
      reportTask('task-1', validInput, workerActor),
    ).rejects.toThrow(/无当前生效的.*薪资规则/);
  });

  it('writes pieceworkAmount + boardCount + pressCount + rule snapshot', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ status: TaskStatus.IN_PROGRESS }),
    );
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.COMPLETED,
    });
    // Non-empty sibling list means cascade-to-COMPLETED check reads
    // sibling statuses after the update.
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.COMPLETED },
      { id: 'task-2', status: TaskStatus.IN_PROGRESS },
    ]);

    await reportTask('task-1', validInput, workerActor);

    const update = dbMock.productionTask.update.mock.calls[0][0];
    // totalPressed = 4900 + 50 + 50 = 5000; no multiplier.
    // boardCount = 1 × 1 = 1; pressCount = 5000 × 1 = 5000
    // amount = 1×5 + 5000×0.007 = 5 + 35 = 40
    expect(update.data.completedQty).toBe(4900);
    expect(update.data.defectQty).toBe(50);
    expect(update.data.reworkQty).toBe(50);
    expect(update.data.boardCount).toBe(1);
    expect(update.data.pressCount).toBe(5000);
    expect(update.data.pieceworkAmount).toBe('40.00');
    expect(update.data.status).toBe(TaskStatus.COMPLETED);
    // CLAUDE.md §4.4 rule snapshot (non-null, carries same shape as seed).
    expect(update.data.salaryRuleSnapshot).toMatchObject({
      pieceRate: 0.007,
      boardRate: 5,
      multiplierFactors: ['DOUBLE_SIDED', 'DOUBLE_COLOR'],
    });
    expect(dbMock.$executeRaw.mock.calls.map((call) => call[1])).toContain(
      'print-shop-erp:piecework-rule:worker-1:HAND_PRESS',
    );
  });

  it('applies double-sided / double-color multipliers at report time', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({
        status: TaskStatus.IN_PROGRESS,
        orderStatus: OrderStatus.IN_PRODUCTION,
        isDoubleSided: true,
        isDoubleColor: true,
      }),
    );
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.COMPLETED,
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.COMPLETED },
    ]);
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
    });
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.COMPLETED,
    });

    await reportTask(
      'task-1',
      { completedQty: 2000, defectQty: 0, reworkQty: 0 },
      workerActor,
    );

    const update = dbMock.productionTask.update.mock.calls[0][0];
    // multiplier = 4; boardCount = 4; pressCount = 8000
    // amount = 4×5 + 8000×0.007 = 20 + 56 = 76
    expect(update.data.boardCount).toBe(4);
    expect(update.data.pressCount).toBe(8000);
    expect(update.data.pieceworkAmount).toBe('76.00');
  });

  it('rejects a legacy rule whose computed amount exceeds Decimal(10,2)', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({
        status: TaskStatus.IN_PROGRESS,
        orderStatus: OrderStatus.IN_PRODUCTION,
        isDoubleSided: true,
        isDoubleColor: true,
        // ⚠️ 故意把 plannedQty 拉到和报工合计一致（30,000,000），让数量守卫
        // 走「等于计划数 → 直接通过」分支。这条用例测的是**另一个**闸口：
        // calculateStorablePiecework 的 Decimal(10,2) 溢出。有人把它改回
        // 5000，数量守卫会先抛 OverReportError，这道算钱门禁就被静默遮掉。
        plannedQty: 30_000_000,
      }),
    );
    dbMock.salaryRule.findFirst.mockResolvedValue({
      ruleValue: { ...HAND_PRESS_RULE, pieceRate: 1, boardRate: 0 },
    });

    await expect(
      reportTask(
        'task-1',
        {
          completedQty: 10_000_000,
          defectQty: 10_000_000,
          reworkQty: 10_000_000,
        },
        workerActor,
      ),
    ).rejects.toThrow(/99,999,999\.99/);
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('cascades Order IN_PRODUCTION → COMPLETED when this is the last active task', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({
        status: TaskStatus.IN_PROGRESS,
        orderStatus: OrderStatus.IN_PRODUCTION,
      }),
    );
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.COMPLETED,
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.COMPLETED },
    ]);
    // Fresh read confirms order still IN_PRODUCTION → cascade fires.
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
    });
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.COMPLETED,
    });

    const r = await reportTask('task-1', validInput, workerActor);
    expect(r.orderCompleted).toBe(true);
    const orderUpdate = dbMock.order.update.mock.calls[0][0];
    expect(orderUpdate.data.status).toBe(OrderStatus.COMPLETED);
  });

  it('reportTask fresh-read: skips cascade when the order has already completed (Codex round 39 / P1)', async () => {
    // Two workers finish simultaneously. First finisher transitioned
    // the order to COMPLETED; the second tx lands inside the cascade
    // lock and sees COMPLETED from the fresh read. No duplicate log.
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({
        status: TaskStatus.IN_PROGRESS,
        orderStatus: OrderStatus.IN_PRODUCTION,
      }),
    );
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.COMPLETED,
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.COMPLETED },
      { id: 'task-2', status: TaskStatus.COMPLETED },
    ]);
    // The first finisher already transitioned this to COMPLETED.
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.COMPLETED,
    });

    const r = await reportTask('task-1', validInput, workerActor);
    expect(r.orderCompleted).toBe(false);
    // order.update called ONCE by the task's own update flow? No —
    // order.update is only invoked for the cascade in this module.
    // Confirm it wasn't called a second time for a redundant cascade.
    expect(dbMock.order.update).not.toHaveBeenCalled();
    // No redundant STATUS_CHANGE log.
    const statusChangeLogs = dbMock.orderLog.create.mock.calls.filter(
      (c) =>
        (c[0] as { data: { action: string } }).data.action === 'STATUS_CHANGE',
    );
    expect(statusChangeLogs).toHaveLength(0);
  });

  it('skips cascade when other tasks are still PENDING/IN_PROGRESS', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({
        status: TaskStatus.IN_PROGRESS,
        orderStatus: OrderStatus.IN_PRODUCTION,
      }),
    );
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.COMPLETED,
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.COMPLETED },
      { id: 'task-2', status: TaskStatus.PENDING },
    ]);

    const r = await reportTask('task-1', validInput, workerActor);
    expect(r.orderCompleted).toBe(false);
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('waits for linked outsource work after the final internal task completes', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({
        status: TaskStatus.IN_PROGRESS,
        orderStatus: OrderStatus.IN_PRODUCTION,
      }),
    );
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.COMPLETED,
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.COMPLETED },
    ]);
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
      requiresOutsource: true,
    });
    dbMock.outsourceOrder.findMany.mockResolvedValue([
      { id: 'outsource-1', status: OutsourceStatus.IN_PROGRESS },
    ]);

    const result = await reportTask('task-1', validInput, workerActor);
    expect(result.orderCompleted).toBe(false);
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('外协单已收货但没覆盖到含外协工艺的款式二 → 报完最后一根内部任务也不完工', async () => {
    // 报工路径上的端到端回归：闸口从「有外协单且全部 RECEIVED」收紧成
    // 款式级覆盖之后，这种「只给款式一发了外协单」的工单不能再自动完工。
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({
        status: TaskStatus.IN_PROGRESS,
        orderStatus: OrderStatus.IN_PRODUCTION,
      }),
    );
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.COMPLETED,
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.COMPLETED },
    ]);
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
      requiresOutsource: true,
    });
    dbMock.outsourceOrder.findMany.mockResolvedValue([
      {
        id: 'outsource-1',
        status: OutsourceStatus.RECEIVED,
        orderItemIds: ['item-1'],
        itemSnapshots: [{ orderItemId: 'item-1', quantity: 5000 }],
      },
    ]);
    dbMock.orderItem.findMany.mockResolvedValue([
      { id: 'item-1', sequence: 1, name: '款式一', quantity: 5000, crafts: ['craft-outsource'] },
      { id: 'item-2', sequence: 2, name: '款式二', quantity: 5000, crafts: ['craft-outsource'] },
    ]);
    dbMock.craft.findMany.mockResolvedValue(fixtureCrafts());

    const result = await reportTask('task-1', validInput, workerActor);
    expect(result.orderCompleted).toBe(false);
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('counts CANCELLED siblings out of the cascade check (order can still complete)', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({
        status: TaskStatus.IN_PROGRESS,
        orderStatus: OrderStatus.IN_PRODUCTION,
      }),
    );
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.COMPLETED,
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.COMPLETED },
      { id: 'task-2', status: TaskStatus.CANCELLED },
    ]);
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
    });
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.COMPLETED,
    });

    const r = await reportTask('task-1', validInput, workerActor);
    expect(r.orderCompleted).toBe(true);
  });

  it('rejects reporting a PENDING task (must begin first)', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ status: TaskStatus.PENDING }),
    );
    await expect(
      reportTask('task-1', validInput, workerActor),
    ).rejects.toBeInstanceOf(InvalidTaskTransitionError);
  });

  it('rejects re-reporting a COMPLETED task', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ status: TaskStatus.COMPLETED }),
    );
    await expect(
      reportTask('task-1', validInput, workerActor),
    ).rejects.toBeInstanceOf(InvalidTaskTransitionError);
  });

  // ─── Slice C wire spec ───
  it('reportTask cascade COMPLETED 后 fire notify("ORDER_COMPLETED")', async () => {
    dbMock.productionTask.findUnique
      .mockResolvedValueOnce(
        // tx 内：取 task w/ orderItem.order
        fixtureTask({
          status: TaskStatus.IN_PROGRESS,
          orderStatus: OrderStatus.IN_PRODUCTION,
        }),
      )
      .mockResolvedValueOnce({
        // tx 后：单查 task → orderItem.order.{id, orderNo, customerRef}
        orderItem: {
          order: {
            id: 'order-1',
            orderNo: 'O-77',
            customerRef: '客户 A',
          },
        },
      });
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.COMPLETED,
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.COMPLETED },
    ]);
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
    });
    dbMock.order.update.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.COMPLETED,
    });

    await reportTask('task-1', validInput, workerActor);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
      'ORDER_COMPLETED',
      {
        orderId: 'order-1',
        orderNo: 'O-77',
        customerRef: '客户 A',
      },
      { dedupeKey: 'notification:ORDER_COMPLETED:order-1' },
    );
  });

  it('reportTask 非 cascade 路径（还有兄弟任务未完）→ 不 fire notify', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({
        status: TaskStatus.IN_PROGRESS,
        orderStatus: OrderStatus.IN_PRODUCTION,
      }),
    );
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.COMPLETED,
    });
    // 还有 1 个 IN_PROGRESS 兄弟 → cascade 不触发
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.COMPLETED },
      { id: 'task-2', status: TaskStatus.IN_PROGRESS },
    ]);

    const r = await reportTask('task-1', validInput, workerActor);
    expect(r.orderCompleted).toBe(false);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('reportTask 业务异常（PENDING task）→ 不 fire notify', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ status: TaskStatus.PENDING }),
    );
    await expect(
      reportTask('task-1', validInput, workerActor),
    ).rejects.toBeInstanceOf(InvalidTaskTransitionError);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe('reportTask 数量守卫（业主 2026-08-21）', () => {
  // 计划数 5000（fixtureTask 默认）。缺配置行 → fallback 3 倍 → 合计上限
  // 15000，判据是 **>=**（合计达到 15000 就硬拒）。
  function armMachineReport(taskOverrides = {}) {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({
        status: TaskStatus.IN_PROGRESS,
        orderStatus: OrderStatus.IN_PRODUCTION,
        ...taskOverrides,
      }),
    );
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.productionTask.update.mockResolvedValue({
      id: 'task-1',
      status: TaskStatus.COMPLETED,
    });
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
      requiresOutsource: false,
    });
    // 还有兄弟任务没完 → 完工闸口在 INTERNAL_TASKS 早退，不写 STATUS_CHANGE
    // 日志，所以 orderLog 上就只可能有超报那一条。
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.COMPLETED },
      { id: 'task-2', status: TaskStatus.IN_PROGRESS },
    ]);
  }

  const updateData = () => dbMock.productionTask.update.mock.calls[0][0].data;

  it('少报（3000 < 计划 5000）直接通过，不写超报备注也不写工单日志', async () => {
    armMachineReport();
    await reportTask(
      'task-1',
      { completedQty: 3000, defectQty: 0, reworkQty: 0 },
      workerActor,
    );
    expect(updateData().status).toBe(TaskStatus.COMPLETED);
    expect(updateData().remark).toBeUndefined();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('合计正好等于计划数 → 通过，且不算超报', async () => {
    armMachineReport();
    await reportTask(
      'task-1',
      { completedQty: 4900, defectQty: 50, reworkQty: 50 },
      workerActor,
    );
    expect(updateData().status).toBe(TaskStatus.COMPLETED);
    expect(updateData().remark).toBeUndefined();
  });

  it('超报未勾确认 → 抛可确认的 OverReportError，且一行都不写', async () => {
    armMachineReport();
    await expect(
      reportTask(
        'task-1',
        { completedQty: 5001, defectQty: 0, reworkQty: 0 },
        workerActor,
      ),
    ).rejects.toThrow(/请勾选「确认超出计划数」/);
    // 守卫在规则查询和计件计算之前 —— 被拒的报工不该产生任何计件计算。
    expect(dbMock.salaryRule.findFirst).not.toHaveBeenCalled();
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('超报未勾确认时错误对象带 confirmable=true 和数量，供 action 拼提示', async () => {
    armMachineReport();
    const err = await reportTask(
      'task-1',
      { completedQty: 6200, defectQty: 0, reworkQty: 0 },
      workerActor,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OverReportError);
    expect((err as OverReportError).confirmable).toBe(true);
    expect((err as OverReportError).plannedQty).toBe(5000);
    expect((err as OverReportError).totalReported).toBe(6200);
    expect((err as OverReportError).limitQty).toBe(15000);
  });

  it('超报已勾确认 → 通过，把超出情况写进任务备注 + 一条 TASK_OVER_REPORT 工单日志', async () => {
    armMachineReport();
    await reportTask(
      'task-1',
      {
        completedQty: 6000,
        defectQty: 100,
        reworkQty: 100,
        overReportConfirmed: true,
      },
      workerActor,
    );

    const remark = updateData().remark as string;
    expect(remark).toContain('[超计划报工]');
    expect(remark).toContain('计划 5000');
    expect(remark).toContain('合计 6200');
    expect(remark).toContain('合格 6000');
    expect(remark).toContain('不良 100');
    expect(remark).toContain('返工 100');

    expect(dbMock.orderLog.create).toHaveBeenCalledTimes(1);
    const log = dbMock.orderLog.create.mock.calls[0][0].data;
    expect(log.action).toBe('TASK_OVER_REPORT');
    expect(log.orderId).toBe('order-1');
    expect(log.operatorId).toBe(workerActor.id);
    expect(log.changedFields.completedQty).toEqual({ before: 0, after: 6000 });
    expect(log.remark).toContain('[超计划报工]');
  });

  it('已有任务备注时追加而不是覆盖', async () => {
    armMachineReport({ remark: '机台中途换刀' });
    await reportTask(
      'task-1',
      { completedQty: 6000, defectQty: 0, reworkQty: 0, overReportConfirmed: true },
      workerActor,
    );
    const remark = updateData().remark as string;
    expect(remark.startsWith('机台中途换刀\n')).toBe(true);
    expect(remark).toContain('[超计划报工]');
  });

  it('合计恰好等于上限（计划 5000 × 3 = 15000）时硬拒 —— 挡多打一个零', async () => {
    // 判据必须是 >= 而不是 >：多打一个零把 P 变成 10P，严格大于时 N=10
    // 恰好落进「勾一下就能过」的分支，守卫要挡的唯一场景一次都挡不住。
    // 这条用例就是钉住那个等号的。
    armMachineReport();
    const err = await reportTask(
      'task-1',
      { completedQty: 15_000, defectQty: 0, reworkQty: 0, overReportConfirmed: true },
      workerActor,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OverReportError);
    expect((err as OverReportError).confirmable).toBe(false);
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('计划 5000 时把合格数多打一个零（50000）一律拒绝', async () => {
    armMachineReport();
    await expect(
      reportTask(
        'task-1',
        { completedQty: 50_000, defectQty: 0, reworkQty: 0, overReportConfirmed: true },
        workerActor,
      ),
    ).rejects.toThrow(/已达到.*3 倍上限（15000）/);
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('Setting 把倍数改成 5 后上限变成 25000（阈值真的从库里读，不是写死的 3）', async () => {
    // 这条是「Setting 表只写不读」的回归门禁，和 owner-watchlist /
    // cdr bundle 两处同型。默认 3 倍下上限是 15000，改成 5 倍后必须变成
    // 25000 —— 报文里的两个数字同时变，写死任何一个都会红。
    dbMock.setting.findUnique.mockResolvedValue({ value: { multiple: 5 } });
    armMachineReport();
    await expect(
      reportTask(
        'task-1',
        { completedQty: 25_000, defectQty: 0, reworkQty: 0, overReportConfirmed: true },
        workerActor,
      ),
    ).rejects.toThrow(/5 倍上限（25000）/);
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('Setting 为 5 时 20000 仍在上限内，勾确认即可通过', async () => {
    // 和上一条配对：同一个数字在默认 3 倍下是硬拒（20000 >= 15000），
    // 5 倍下是「勾确认就过」。一起看才证明阈值真的在动。
    dbMock.setting.findUnique.mockResolvedValue({ value: { multiple: 5 } });
    armMachineReport();
    await reportTask(
      'task-1',
      { completedQty: 20_000, defectQty: 0, reworkQty: 0, overReportConfirmed: true },
      workerActor,
    );
    expect(updateData().status).toBe(TaskStatus.COMPLETED);
    expect(updateData().remark).toContain('合计 20000');
  });

  it('plannedQty 为 0 的脏任务 fail-closed，不产生状态或计件写入', async () => {
    armMachineReport({ plannedQty: 0 });
    await expect(
      reportTask(
        'task-1',
        { completedQty: 100, defectQty: 0, reworkQty: 0 },
        workerActor,
      ),
    ).rejects.toThrow(/计划数量异常.*不能报工/);
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });
});

describe('getSchedulingView', () => {
  it('prefills staged worker assignments for the single-order form', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNo: 'GD-STAGED',
      customName: null,
      isUrgent: false,
      customerRef: null,
      submitter: { displayName: '销售 A' },
      items: [
        {
          id: 'item-1',
          sequence: 1,
          name: '款式 A',
          quantity: 1000,
          specification: null,
          paperType: null,
          foilColors: [],
          remark: null,
          crafts: ['craft-foil'],
          tasks: [{ craftId: 'craft-foil', workerId: 'worker-1' }],
        },
      ],
    });
    dbMock.craft.findMany.mockResolvedValue([
      {
        id: 'craft-foil',
        name: '局部烫金',
        isOutsource: false,
        defaultWorkerType: WorkerType.MACHINE,
        defaultMachineType: MachineType.HAND_PRESS,
        inHouseMachineTypes: [],
      },
    ]);
    dbMock.user.findMany.mockResolvedValue([
      fixtureWorker('worker-1', {
        machineType: MachineType.HAND_PRESS,
      }),
    ]);

    const view = await getSchedulingView('order-1');

    expect(view?.items[0]?.crafts[0]).toEqual(
      expect.objectContaining({ assignedWorkerId: 'worker-1' }),
    );
  });
});

describe('getPendingSchedulingBoard', () => {
  it('returns visible craft summaries, task counts and safe batch blockers', async () => {
    const createdAt = new Date('2026-07-31T00:00:00.000Z');
    dbMock.order.findMany.mockResolvedValue([
      {
        id: 'order-ready',
        orderNo: 'GD-READY',
        customName: '可批量排产',
        kind: OrderKind.NORMAL,
        sourceOrder: null,
        isUrgent: false,
        customerRef: '客户 A',
        promisedDate: null,
        submittedAt: createdAt,
        createdAt,
        items: [
          {
            id: 'item-1',
            quantity: 1000,
            crafts: ['craft-foil'],
            tasks: [
              {
                craftId: 'craft-foil',
                status: TaskStatus.PENDING,
              },
            ],
          },
          {
            id: 'item-2',
            quantity: 2000,
            crafts: ['craft-foil'],
            tasks: [],
          },
        ],
        outsourceOrders: [],
        submitter: { displayName: '销售 A', role: Role.SALES },
      },
      {
        id: 'order-hybrid',
        orderNo: 'GD-HYBRID',
        customName: '缺外协单',
        kind: OrderKind.NORMAL,
        sourceOrder: null,
        isUrgent: false,
        customerRef: '客户 B',
        promisedDate: null,
        submittedAt: createdAt,
        createdAt,
        items: [
          {
            id: 'item-3',
            quantity: 500,
            crafts: ['craft-hybrid'],
            tasks: [],
          },
        ],
        outsourceOrders: [],
        submitter: { displayName: '销售 B', role: Role.SALES },
      },
    ]);
    dbMock.craft.findMany.mockResolvedValue([
      {
        id: 'craft-foil',
        name: '局部烫金',
        isActive: true,
        isOutsource: false,
        defaultWorkerType: WorkerType.MACHINE,
        defaultMachineType: MachineType.HAND_PRESS,
        inHouseMachineTypes: [],
      },
      {
        id: 'craft-hybrid',
        name: '铜版纸彩印+烫金',
        isActive: true,
        isOutsource: true,
        defaultWorkerType: WorkerType.MACHINE,
        defaultMachineType: MachineType.HAND_PRESS,
        inHouseMachineTypes: [MachineType.HAND_PRESS],
      },
    ]);
    dbMock.user.findMany.mockResolvedValue([
      fixtureWorker('worker-1', { machineType: MachineType.HAND_PRESS }),
    ]);
    dbMock.productionTask.groupBy.mockResolvedValue([
      {
        workerId: 'worker-1',
        status: TaskStatus.PENDING,
        _count: { _all: 3 },
      },
    ]);

    const board = await getPendingSchedulingBoard();

    expect(board.workers[0]).toEqual(
      expect.objectContaining({ id: 'worker-1', pendingTaskCount: 3 }),
    );
    expect(board.orders[0]).toEqual(
      expect.objectContaining({
        itemCount: 2,
        totalQuantity: 3000,
        internalTaskCount: 2,
        assignedTaskCount: 1,
        remainingTaskCount: 1,
        compatibleWorkerIds: ['worker-1'],
        compatibleTaskCounts: { 'worker-1': 1 },
        batchBlockReason: null,
        craftSummaries: [
          expect.objectContaining({
            name: '局部烫金',
            count: 2,
            assignedCount: 1,
            isOutsource: false,
          }),
        ],
      }),
    );
    expect(board.orders[1]).toEqual(
      expect.objectContaining({
        compatibleWorkerIds: [],
        batchBlockReason: '请先创建外协单',
        craftSummaries: [
          expect.objectContaining({
            name: '铜版纸彩印+烫金',
            isHybrid: true,
          }),
        ],
      }),
    );
  });
});
