import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OrderStatus,
  Role,
  TaskStatus,
  MachineType,
} from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
  const mock: {
    order: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    craft: { findMany: ReturnType<typeof vi.fn> };
    user: { findMany: ReturnType<typeof vi.fn> };
    productionTask: { createMany: ReturnType<typeof vi.fn> };
    orderLog: { create: ReturnType<typeof vi.fn> };
    $queryRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  } = {
    order: { findFirst: vi.fn(), update: vi.fn() },
    craft: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    productionTask: { createMany: vi.fn() },
    orderLog: { create: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(mock);
      return fn;
    }),
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import { scheduleOrder, SchedulingError } from '../production';
import { OrderInvariantError } from '../order';
import { InvalidOrderTransitionError } from '../order/status-machine';

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
  dbMock.order.update.mockReset();
  dbMock.craft.findMany.mockReset();
  dbMock.user.findMany.mockReset();
  dbMock.productionTask.createMany.mockReset();
  dbMock.orderLog.create.mockReset().mockResolvedValue({});
  dbMock.$queryRaw.mockReset().mockResolvedValue(undefined);
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
    const firstCall = dbMock.$queryRaw.mock.calls[0];
    expect(firstCall).toBeDefined();
    const sql = (firstCall[0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    // Key value is passed as the template parameter.
    expect(firstCall[1]).toMatch(/print-shop-erp:schedule:order:order-1/);
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
