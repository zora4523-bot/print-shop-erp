import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MachineType,
  OrderStatus,
  Role,
  TaskStatus,
  WorkerType,
} from '../../../generated/prisma/enums';

const { dbMock, databaseNowMock } = vi.hoisted(() => {
  const mock = {
    setting: { findUnique: vi.fn() },
    productionTask: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    orderLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { dbMock: mock, databaseNowMock: vi.fn() };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseNow: databaseNowMock,
}));

import {
  claimTask,
  listClaimableTasks,
  releaseTaskToClaimPool,
  TaskClaimError,
} from '../task-claim';

const ADMIN = { id: 'admin-1', role: Role.ADMIN };
const WORKER = { id: 'worker-2', role: Role.WORKER };
const DB_NOW = new Date('2026-08-26T03:00:00.000Z');

function taskFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'task-1',
    status: TaskStatus.PENDING,
    workerId: 'worker-1',
    workerType: WorkerType.MACHINE,
    machineType: MachineType.WINDMILL,
    isSelfClaimable: false,
    selfClaimOpenedAt: null,
    selfClaimedAt: null,
    claimMachineTypes: [],
    orderItem: {
      name: '大号信封',
      sequence: 1,
      orderId: 'order-1',
      order: {
        id: 'order-1',
        orderNo: 'GD-001',
        status: OrderStatus.SCHEDULING,
      },
    },
    craft: {
      id: 'craft-foil',
      name: '专版单色平烫',
      isActive: true,
      isOutsource: false,
      defaultWorkerType: WorkerType.MACHINE,
      defaultMachineType: MachineType.WINDMILL,
      inHouseMachineTypes: [],
    },
    worker: { displayName: '原师傅' },
    ...overrides,
  };
}

function workerFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKER.id,
    displayName: '张师傅',
    role: Role.WORKER,
    isActive: true,
    workerType: WorkerType.MACHINE,
    machineType: MachineType.WINDMILL,
    machineCapabilities: [MachineType.WINDMILL],
    craftCapabilities: [{ craftId: 'craft-foil' }],
    ...overrides,
  };
}

function arrangeMutationTask(task: Record<string, unknown>) {
  dbMock.productionTask.findUnique
    .mockResolvedValueOnce({
      id: task.id,
      orderItem: { orderId: 'order-1' },
    })
    .mockResolvedValueOnce(task);
}

function executedSql(): string[] {
  return dbMock.$executeRaw.mock.calls.map((call) =>
    (call[0] as TemplateStringsArray).join('?'),
  );
}

beforeEach(() => {
  for (const delegate of [
    dbMock.setting,
    dbMock.productionTask,
    dbMock.user,
    dbMock.orderLog,
  ]) {
    for (const mock of Object.values(delegate)) mock.mockReset();
  }
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$transaction.mockReset().mockImplementation(async (fn) => fn(dbMock));
  dbMock.setting.findUnique.mockResolvedValue({ value: { enabled: true } });
  dbMock.productionTask.update.mockResolvedValue({ id: 'task-1' });
  dbMock.productionTask.updateMany.mockResolvedValue({ count: 1 });
  dbMock.orderLog.create.mockResolvedValue({ id: 'log-1' });
  dbMock.user.findUnique.mockResolvedValue(workerFixture());
  databaseNowMock.mockReset().mockResolvedValue(DB_NOW);
});

describe('releaseTaskToClaimPool', () => {
  it('允许带回厂机型的 hybrid 外协工艺，并冻结全部可接机型', async () => {
    const task = taskFixture({
      craft: {
        ...(taskFixture().craft as object),
        isOutsource: true,
        defaultMachineType: null,
        inHouseMachineTypes: [MachineType.WINDMILL, MachineType.HAND_PRESS],
      },
    });
    arrangeMutationTask(task);

    await expect(
      releaseTaskToClaimPool('task-1', ADMIN),
    ).resolves.toMatchObject({ taskId: 'task-1', orderId: 'order-1' });

    expect(dbMock.productionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          workerId: null,
          machineType: null,
          isSelfClaimable: true,
          selfClaimOpenedAt: DB_NOW,
          selfClaimedAt: null,
          claimMachineTypes: [MachineType.WINDMILL, MachineType.HAND_PRESS],
        }),
      }),
    );
    expect(dbMock.orderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'TASK_RELEASE_TO_POOL' }),
      }),
    );
  });

  it('仅纯外协工艺不能释放到内部抢单池', async () => {
    const task = taskFixture({
      craft: {
        ...(taskFixture().craft as object),
        isOutsource: true,
        defaultWorkerType: WorkerType.MACHINE,
        defaultMachineType: MachineType.WINDMILL,
        inHouseMachineTypes: [],
      },
    });
    arrangeMutationTask(task);
    await expect(releaseTaskToClaimPool('task-1', ADMIN)).rejects.toThrow(
      '未配置可抢单的内部生产岗位',
    );
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });

  it('固定先拿 Setting shared lock，再拿 order advisory lock', async () => {
    arrangeMutationTask(taskFixture());
    await releaseTaskToClaimPool('task-1', ADMIN);
    const sql = executedSql();
    expect(sql[0]).toContain('pg_advisory_xact_lock_shared');
    expect(sql[1]).toContain('pg_advisory_xact_lock');
    expect(sql[1]).not.toContain('lock_shared');
  });

  it('开关关闭时不释放任务', async () => {
    dbMock.setting.findUnique.mockResolvedValue({ value: { enabled: false } });
    arrangeMutationTask(taskFixture());
    await expect(releaseTaskToClaimPool('task-1', ADMIN)).rejects.toThrow(
      '自由抢单已关闭',
    );
    expect(dbMock.productionTask.update).not.toHaveBeenCalled();
  });
});

describe('claimTask', () => {
  function openTask(overrides: Record<string, unknown> = {}) {
    return taskFixture({
      workerId: null,
      machineType: null,
      isSelfClaimable: true,
      selfClaimOpenedAt: new Date('2026-08-26T02:00:00.000Z'),
      claimMachineTypes: [MachineType.WINDMILL, MachineType.HAND_PRESS],
      worker: null,
      ...overrides,
    });
  }

  it('严格验证能力后用 CAS 占位，但不自动开工', async () => {
    arrangeMutationTask(openTask());
    await expect(claimTask('task-1', WORKER)).resolves.toEqual({
      taskId: 'task-1',
      orderId: 'order-1',
      workerId: WORKER.id,
      machineType: MachineType.WINDMILL,
    });

    expect(dbMock.productionTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        status: TaskStatus.PENDING,
        workerId: null,
        isSelfClaimable: true,
      },
      data: {
        workerId: WORKER.id,
        machineType: MachineType.WINDMILL,
        isSelfClaimable: false,
        selfClaimedAt: DB_NOW,
      },
    });
    const data = dbMock.productionTask.updateMany.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
    expect(data.startedAt).toBeUndefined();
    expect(dbMock.orderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'TASK_SELF_CLAIM' }),
      }),
    );
  });

  it('非开机师傅按岗位和工艺能力抢单，不写入机型', async () => {
    arrangeMutationTask(
      openTask({
        workerType: WorkerType.PACKER,
        claimMachineTypes: [],
        craft: {
          ...(taskFixture().craft as object),
          id: 'craft-pack',
          name: '打包',
          defaultWorkerType: WorkerType.PACKER,
          defaultMachineType: null,
          inHouseMachineTypes: [],
        },
      }),
    );
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({
        workerType: WorkerType.PACKER,
        machineType: null,
        machineCapabilities: [],
        craftCapabilities: [{ craftId: 'craft-pack' }],
      }),
    );

    await expect(claimTask('task-1', WORKER)).resolves.toMatchObject({
      workerId: WORKER.id,
      machineType: null,
    });
    expect(dbMock.productionTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workerId: WORKER.id,
          machineType: null,
          isSelfClaimable: false,
        }),
      }),
    );
  });

  it('师傅未登记工艺能力时不允许像管理员一样越权', async () => {
    arrangeMutationTask(openTask());
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ craftCapabilities: [] }),
    );
    await expect(claimTask('task-1', WORKER)).rejects.toThrow(
      '未登记该工艺能力',
    );
    expect(dbMock.productionTask.updateMany).not.toHaveBeenCalled();
  });

  it('机型能力与释放快照无交集时拒绝', async () => {
    arrangeMutationTask(openTask());
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({
        machineType: MachineType.GLUE,
        machineCapabilities: [MachineType.GLUE],
      }),
    );
    await expect(claimTask('task-1', WORKER)).rejects.toThrow('机型能力');
    expect(dbMock.productionTask.updateMany).not.toHaveBeenCalled();
  });

  it('历史 workerId=NULL 但未显式释放的任务不可抢', async () => {
    arrangeMutationTask(
      openTask({ isSelfClaimable: false, selfClaimOpenedAt: null }),
    );
    await expect(claimTask('task-1', WORKER)).rejects.toThrow('不在抢单池');
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('CAS count=0 返回已被抢走，不写虚假成功日志', async () => {
    arrangeMutationTask(openTask());
    dbMock.productionTask.updateMany.mockResolvedValue({ count: 0 });
    await expect(claimTask('task-1', WORKER)).rejects.toThrow('已被其他师傅抢走');
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('同一师傅在关闭后重放已成功抢单，仍幂等返回', async () => {
    dbMock.setting.findUnique.mockResolvedValue({ value: { enabled: false } });
    arrangeMutationTask(
      openTask({
        workerId: WORKER.id,
        machineType: MachineType.WINDMILL,
        isSelfClaimable: false,
        selfClaimedAt: DB_NOW,
      }),
    );
    await expect(claimTask('task-1', WORKER)).resolves.toMatchObject({
      taskId: 'task-1',
      workerId: WORKER.id,
    });
    expect(dbMock.productionTask.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['任务已取消', TaskStatus.CANCELLED, OrderStatus.SCHEDULING],
    ['工单已取消', TaskStatus.PENDING, OrderStatus.CANCELLED],
  ])(
    '%s 时即使保留 selfClaimedAt，陈旧重试也不得假返回成功',
    async (_label, taskStatus, orderStatus) => {
      const task = openTask({
        status: taskStatus,
        workerId: WORKER.id,
        machineType: MachineType.WINDMILL,
        isSelfClaimable: false,
        selfClaimedAt: DB_NOW,
      });
      task.orderItem = {
        ...(task.orderItem as object),
        order: {
          ...((task.orderItem as { order: object }).order as object),
          status: orderStatus,
        },
      };
      arrangeMutationTask(task);

      await expect(claimTask('task-1', WORKER)).rejects.toThrow(
        '已随工单取消',
      );
      expect(dbMock.productionTask.updateMany).not.toHaveBeenCalled();
      expect(dbMock.orderLog.create).not.toHaveBeenCalled();
    },
  );
});

describe('listClaimableTasks', () => {
  it('只查显式池任务与当前工艺/机型能力，返回最小卡片 DTO', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
    dbMock.productionTask.findMany.mockResolvedValue([
      {
        id: 'task-1',
        workerType: WorkerType.MACHINE,
        plannedQty: 2000,
        claimMachineTypes: [MachineType.WINDMILL],
        orderItem: {
          name: '大号信封',
          sequence: 1,
          order: {
            orderNo: 'GD-001',
            customName: null,
            isUrgent: false,
            promisedDate: null,
            submitter: { displayName: '外部销售' },
          },
        },
        craft: { name: '专版单色平烫' },
      },
    ]);

    const result = await listClaimableTasks(WORKER);
    expect(dbMock.productionTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isSelfClaimable: true,
          workerId: null,
          status: TaskStatus.PENDING,
          craftId: { in: ['craft-foil'] },
          claimMachineTypes: { hasSome: [MachineType.WINDMILL] },
        }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('order.customerRef');
    expect(result[0]).not.toHaveProperty('order.id');
  });

  it('开关关闭时不读取池任务', async () => {
    dbMock.setting.findUnique.mockResolvedValue({ value: { enabled: false } });
    await expect(listClaimableTasks(WORKER)).resolves.toEqual([]);
    expect(dbMock.productionTask.findMany).not.toHaveBeenCalled();
  });
});

it('非师傅调用领域抢单仍被第二道权限拒绝', async () => {
  await expect(
    claimTask('task-1', { id: 'admin-1', role: Role.ADMIN }),
  ).rejects.toBeInstanceOf(TaskClaimError);
  expect(dbMock.$transaction).not.toHaveBeenCalled();
});
