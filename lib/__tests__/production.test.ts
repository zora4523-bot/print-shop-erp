import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OrderStatus,
  Role,
  TaskStatus,
  MachineType,
} from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
  const mock: {
    order: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    craft: { findMany: ReturnType<typeof vi.fn> };
    user: { findMany: ReturnType<typeof vi.fn> };
    productionTask: {
      createMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    salaryRule: { findFirst: ReturnType<typeof vi.fn> };
    orderLog: { create: ReturnType<typeof vi.fn> };
    $executeRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  } = {
    order: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    craft: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    productionTask: {
      createMany: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    salaryRule: { findFirst: vi.fn() },
    orderLog: { create: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(mock);
      return fn;
    }),
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  scheduleOrder,
  SchedulingError,
  beginTask,
  reportTask,
  ReportError,
} from '../production';
import { OrderInvariantError } from '../order';
import { InvalidOrderTransitionError } from '../order/status-machine';
import { InvalidTaskTransitionError } from '../production/status-machine';

const foremanActor = { id: 'foreman-1', role: Role.FOREMAN };
const ownerActor = { id: 'owner-1', role: Role.OWNER };

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
  }>> = [],
) {
  const base = [
    {
      id: 'craft-foil',
      isActive: true,
      isOutsource: false,
      defaultMachineType: MachineType.WINDMILL,
    },
    {
      id: 'craft-glue',
      isActive: true,
      isOutsource: false,
      defaultMachineType: MachineType.GLUE,
    },
    {
      id: 'craft-outsource',
      isActive: true,
      isOutsource: true,
      defaultMachineType: null,
    },
  ];
  if (overrides.length === 0) return base;
  return base.map((c, i) => ({ ...c, ...overrides[i] }));
}

function fixtureWorker(id: string, overrides: Partial<{ isActive: boolean; role: Role }> = {}) {
  return {
    id,
    role: Role.WORKER,
    isActive: true,
    machineType: MachineType.WINDMILL,
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.order.findFirst.mockReset();
  dbMock.order.findUnique.mockReset();
  dbMock.order.update.mockReset();
  dbMock.craft.findMany.mockReset();
  dbMock.user.findMany.mockReset();
  dbMock.productionTask.createMany.mockReset();
  dbMock.productionTask.findUnique.mockReset();
  dbMock.productionTask.findMany.mockReset();
  dbMock.productionTask.update.mockReset();
  dbMock.salaryRule.findFirst.mockReset();
  dbMock.orderLog.create.mockReset().mockResolvedValue({});
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
    if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
    return fn;
  });

  dbMock.productionTask.createMany.mockResolvedValue({ count: 0 });
  dbMock.order.update.mockResolvedValue({ id: 'order-1', status: OrderStatus.SCHEDULING });
});

describe('scheduleOrder', () => {
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
    expect(logData.remark).toMatch(/排产：派工 2 个任务/);
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

  it('all-outsource order: zero tasks, still transitions to SCHEDULING', async () => {
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
});

// Shared fixtures for the worker-flow suites.
const workerActor = { id: 'worker-1', role: Role.WORKER };

function fixtureTask(
  overrides: Partial<{
    status: TaskStatus;
    workerId: string | null;
    machineType: MachineType | null;
    plannedQty: number;
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
    machineType: MachineType.HAND_PRESS,
    plannedQty: 5000,
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

  it('OWNER global override starts someone else\'s task', async () => {
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
    const r = await beginTask('task-1', { id: 'o', role: Role.OWNER });
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

  it('refuses to report when task has no machineType', async () => {
    dbMock.productionTask.findUnique.mockResolvedValue(
      fixtureTask({ status: TaskStatus.IN_PROGRESS, machineType: null }),
    );
    await expect(
      reportTask('task-1', validInput, workerActor),
    ).rejects.toThrow(/不支持计件报工/);
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
});
