import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderStatus,
  ProductionTaskDisputeStatus,
  Role,
} from '@/generated/prisma/enums';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    productionTask: { findFirst: vi.fn() },
    productionTaskDispute: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    orderLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation(
    async (fn: (tx: typeof mock) => unknown) => fn(mock),
  );
  return { dbMock: mock };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  createTaskDispute,
  listOrderTaskDisputes,
  listWorkerTaskDisputes,
  reviewTaskDispute,
  TaskDisputeError,
} from '../task-dispute';

const worker = { id: 'worker-1', role: Role.WORKER };
const admin = { id: 'admin-1', role: Role.ADMIN };

beforeEach(() => {
  dbMock.productionTask.findFirst.mockReset();
  dbMock.productionTaskDispute.findFirst.mockReset().mockResolvedValue(null);
  dbMock.productionTaskDispute.findUnique.mockReset();
  dbMock.productionTaskDispute.findMany.mockReset().mockResolvedValue([]);
  dbMock.productionTaskDispute.create.mockReset().mockResolvedValue({
    id: 'dispute-1',
    status: ProductionTaskDisputeStatus.PENDING,
    createdAt: new Date('2026-08-26T06:00:00.000Z'),
  });
  dbMock.productionTaskDispute.update.mockReset();
  dbMock.orderLog.create.mockReset().mockResolvedValue({ id: 'log-1' });
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation(
    async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock),
  );
});

function ownedTask() {
  return {
    id: 'task-1',
    orderItem: {
      orderId: 'order-1',
      name: '款式 A',
      sequence: 1,
    },
    craft: { name: '局部烫金' },
  };
}

describe('createTaskDispute', () => {
  it('creates one pending audit record only for the assigned worker', async () => {
    dbMock.productionTask.findFirst.mockResolvedValue(ownedTask());

    const result = await createTaskDispute(
      { taskId: 'task-1', reason: '  计件数量与实际合格数不一致  ' },
      worker,
    );

    expect(dbMock.productionTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'task-1',
          workerId: 'worker-1',
          orderItem: {
            order: { status: { not: OrderStatus.SUBMITTED } },
          },
        }),
      }),
    );
    expect(dbMock.productionTaskDispute.create).toHaveBeenCalledWith({
      data: {
        productionTaskId: 'task-1',
        workerId: 'worker-1',
        reason: '计件数量与实际合格数不一致',
      },
      select: { id: true, status: true, createdAt: true },
    });
    expect(dbMock.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        operatorId: 'worker-1',
        action: 'TASK_DISPUTE_CREATED',
      }),
    });
    expect(result).toEqual({
      disputeId: 'dispute-1',
      taskId: 'task-1',
      orderId: 'order-1',
    });
  });

  it('does not reveal or mutate another worker task', async () => {
    dbMock.productionTask.findFirst.mockResolvedValue(null);
    await expect(
      createTaskDispute(
        { taskId: 'task-other', reason: '这不是当前师傅的任务' },
        worker,
      ),
    ).rejects.toThrow(/不属于当前师傅/);
    expect(dbMock.productionTaskDispute.create).not.toHaveBeenCalled();
  });

  it('rejects a second pending dispute for the same task', async () => {
    dbMock.productionTask.findFirst.mockResolvedValue(ownedTask());
    dbMock.productionTaskDispute.findFirst.mockResolvedValue({ id: 'pending-1' });
    await expect(
      createTaskDispute(
        { taskId: 'task-1', reason: '这是另一条待处理异议' },
        worker,
      ),
    ).rejects.toThrow(/已有待处理异议/);
  });

  it('rejects non-worker actors', async () => {
    await expect(
      createTaskDispute(
        { taskId: 'task-1', reason: '管理员不能代替师傅提交' },
        admin,
      ),
    ).rejects.toBeInstanceOf(TaskDisputeError);
  });
});

describe('reviewTaskDispute', () => {
  it('resolves a pending record once with handler and timestamp', async () => {
    dbMock.productionTaskDispute.findUnique.mockResolvedValue({
      id: 'dispute-1',
      status: ProductionTaskDisputeStatus.PENDING,
      workerId: 'worker-1',
      productionTaskId: 'task-1',
      productionTask: {
        orderItem: { orderId: 'order-1', name: '款式 A', sequence: 1 },
        craft: { name: '局部烫金' },
      },
    });
    dbMock.productionTaskDispute.update.mockResolvedValue({
      id: 'dispute-1',
      status: ProductionTaskDisputeStatus.RESOLVED,
    });
    const now = new Date('2026-08-26T07:00:00.000Z');

    const result = await reviewTaskDispute(
      {
        disputeId: 'dispute-1',
        decision: 'RESOLVED',
        resolution: '已核对，后续按工资调整流程补差额',
      },
      admin,
      now,
    );

    expect(dbMock.productionTaskDispute.update).toHaveBeenCalledWith({
      where: { id: 'dispute-1' },
      data: {
        status: ProductionTaskDisputeStatus.RESOLVED,
        resolution: '已核对，后续按工资调整流程补差额',
        resolvedById: 'admin-1',
        resolvedAt: now,
      },
      select: { id: true, status: true },
    });
    expect(dbMock.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'TASK_DISPUTE_RESOLVED',
        orderId: 'order-1',
      }),
    });
    expect(result.status).toBe(ProductionTaskDisputeStatus.RESOLVED);
  });

  it('rejects repeated review of a terminal record', async () => {
    dbMock.productionTaskDispute.findUnique.mockResolvedValue({
      id: 'dispute-1',
      status: ProductionTaskDisputeStatus.REJECTED,
      productionTaskId: 'task-1',
      productionTask: {
        orderItem: { orderId: 'order-1', name: '款式 A', sequence: 1 },
        craft: { name: '局部烫金' },
      },
    });
    await expect(
      reviewTaskDispute(
        {
          disputeId: 'dispute-1',
          decision: 'REJECTED',
          resolution: '不能重复驳回',
        },
        admin,
      ),
    ).rejects.toThrow(/已处理/);
    expect(dbMock.productionTaskDispute.update).not.toHaveBeenCalled();
  });
});

describe('task dispute reads', () => {
  it('scopes worker history by both task and worker', async () => {
    dbMock.productionTask.findFirst.mockResolvedValue({ id: 'task-1' });
    await listWorkerTaskDisputes('task-1', worker);
    expect(dbMock.productionTaskDispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productionTaskId: 'task-1', workerId: 'worker-1' },
      }),
    );
  });

  it('lets only administrators query an order dispute queue', async () => {
    await expect(
      listOrderTaskDisputes('order-1', worker),
    ).rejects.toThrow(/只有管理员/);
    await listOrderTaskDisputes('order-1', admin);
    expect(dbMock.productionTaskDispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productionTask: { orderItem: { orderId: 'order-1' } } },
      }),
    );
  });
});
