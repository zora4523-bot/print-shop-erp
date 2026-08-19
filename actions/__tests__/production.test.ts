import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, Role } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  productionMock,
  productionBatchMock,
  revalidatePathMock,
  MockSchedulingError,
  MockReportError,
  MockOrderInvariantError,
  MockInvalidOrderTransitionError,
  MockInvalidTaskTransitionError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  productionMock: {
    scheduleOrder: vi.fn(),
    beginTask: vi.fn(),
    reportTask: vi.fn(),
    reassignProductionTask: vi.fn(),
  },
  productionBatchMock: {
    scheduleOrdersToWorker: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  MockSchedulingError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'SchedulingError';
    }
  },
  MockReportError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'ReportError';
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
  MockInvalidTaskTransitionError: class extends Error {
    constructor(from: string, to: string) {
      super(`生产任务状态不能从 ${from} 直接切到 ${to}`);
      this.name = 'InvalidTaskTransitionError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/production', () => ({
  scheduleOrder: productionMock.scheduleOrder,
  beginTask: productionMock.beginTask,
  reportTask: productionMock.reportTask,
  reassignProductionTask: productionMock.reassignProductionTask,
  SchedulingError: MockSchedulingError,
  ReportError: MockReportError,
  InvalidTaskTransitionError: MockInvalidTaskTransitionError,
}));
vi.mock('@/lib/production/batch-scheduling', () => ({
  scheduleOrdersToWorker: productionBatchMock.scheduleOrdersToWorker,
}));
vi.mock('@/lib/order', () => ({
  OrderInvariantError: MockOrderInvariantError,
  InvalidOrderTransitionError: MockInvalidOrderTransitionError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import {
  scheduleOrderAction,
  batchScheduleOrdersAction,
  beginTaskAction,
  reportTaskAction,
  reassignProductionTaskAction,
} from '../production';

const workerActor = {
  id: 'worker-1',
  username: 'w1',
  displayName: '张师傅',
  role: Role.WORKER,
  workerType: null,
  machineType: null,
};

const fd = (data: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

const foremanActor = {
  id: 'foreman-1',
  username: 'fm',
  displayName: '管理员',
  role: Role.ADMIN,
  workerType: null,
  machineType: null,
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  productionMock.scheduleOrder.mockReset();
  productionMock.beginTask.mockReset();
  productionMock.reportTask.mockReset();
  productionMock.reassignProductionTask.mockReset();
  productionBatchMock.scheduleOrdersToWorker.mockReset();
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
    expect(args[1]).toMatchObject({ id: 'foreman-1', role: Role.ADMIN });
  });
});

describe('batchScheduleOrdersAction', () => {
  const payload = {
    orderIds: ['order-1', 'order-2'],
    workerId: 'worker-1',
  };

  it("first-line requirePermission('order:schedule') and maps a stale session", async () => {
    permissionsMock.requirePermission.mockRejectedValue(
      new UnauthorizedError('未登录或登录状态已失效，请重新登录'),
    );
    await expect(batchScheduleOrdersAction(payload)).resolves.toEqual({
      status: 'unauthorized',
      message: '未登录或登录状态已失效，请重新登录',
    });
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'order:schedule',
    );
    expect(productionBatchMock.scheduleOrdersToWorker).not.toHaveBeenCalled();
  });

  it('rejects duplicate ids before the domain command', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    const result = await batchScheduleOrdersAction({
      orderIds: ['order-1', 'order-1'],
      workerId: 'worker-1',
    });
    expect(result.status).toBe('invalid');
    expect(productionBatchMock.scheduleOrdersToWorker).not.toHaveBeenCalled();
  });

  it('returns partial results and revalidates only successful orders', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    productionBatchMock.scheduleOrdersToWorker.mockResolvedValue({
      assigned: [
        {
          orderId: 'order-1',
          orderNo: 'GD-001',
          tasksCreated: 2,
          remainingTaskCount: 1,
          fullyScheduled: false,
        },
      ],
      failed: [
        {
          orderId: 'order-2',
          orderNo: 'GD-002',
          message: '状态已变化',
        },
      ],
    });

    const result = await batchScheduleOrdersAction(payload);
    expect(result.status).toBe('partial');
    expect(revalidatePathMock).toHaveBeenCalledWith('/foreman/scheduling');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/order-1');
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/orders/order-2');
    expect(productionBatchMock.scheduleOrdersToWorker).toHaveBeenCalledWith(
      payload,
      foremanActor,
    );
  });

  it('maps a batch with no successful order to a readable error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    productionBatchMock.scheduleOrdersToWorker.mockResolvedValue({
      assigned: [],
      failed: [
        {
          orderId: 'order-1',
          orderNo: 'GD-001',
          message: '师傅岗位不匹配',
        },
      ],
    });
    await expect(batchScheduleOrdersAction(payload)).resolves.toEqual({
      status: 'error',
      message: '师傅岗位不匹配',
    });
  });

  it('maps a worker validation SchedulingError to error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    productionBatchMock.scheduleOrdersToWorker.mockRejectedValue(
      new MockSchedulingError('师傅已停用'),
    );
    await expect(batchScheduleOrdersAction(payload)).resolves.toEqual({
      status: 'error',
      message: '师傅已停用',
    });
  });
});

describe('beginTaskAction', () => {
  it("first-line requirePermission('task:report')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(beginTaskAction('task-1')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('task:report');
    expect(productionMock.beginTask).not.toHaveBeenCalled();
  });

  it('maps ReportError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    productionMock.beginTask.mockRejectedValueOnce(
      new MockReportError('只能开始分配给自己的任务'),
    );
    const r = await beginTaskAction('task-1');
    expect(r.status).toBe('error');
  });

  it('maps InvalidTaskTransitionError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    productionMock.beginTask.mockRejectedValueOnce(
      new MockInvalidTaskTransitionError('COMPLETED', 'IN_PROGRESS'),
    );
    const r = await beginTaskAction('task-1');
    expect(r.status).toBe('error');
  });

  it('revalidates + returns success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    productionMock.beginTask.mockResolvedValue({
      taskId: 'task-1',
      status: 'IN_PROGRESS',
      orderStatusChanged: true,
    });
    const r = await beginTaskAction('task-1');
    expect(r.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith('/worker/tasks');
    expect(revalidatePathMock).toHaveBeenCalledWith('/worker/tasks/task-1');
  });
});

describe('reassignProductionTaskAction', () => {
  it('requires task:assign and revalidates the order + worker task views', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    productionMock.reassignProductionTask.mockResolvedValue({
      taskId: 'task-1',
      workerId: 'worker-2',
      status: 'PENDING',
    });
    const result = await reassignProductionTaskAction(
      'task-1',
      'order-1',
      null,
      fd({ workerId: 'worker-2' }),
    );
    expect(result).toEqual({ status: 'success', taskId: 'task-1' });
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('task:assign');
    expect(productionMock.reassignProductionTask).toHaveBeenCalledWith(
      'task-1',
      'worker-2',
      foremanActor,
      '',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/order-1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/worker/tasks');
  });
});

describe('reportTaskAction', () => {
  it("first-line requirePermission('task:report')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      reportTaskAction('task-1', null, fd({ completedQty: '1' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(productionMock.reportTask).not.toHaveBeenCalled();
  });

  it('coerces FormData strings to ints and forwards', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    productionMock.reportTask.mockResolvedValue({
      taskId: 'task-1',
      status: 'COMPLETED',
      pieceworkAmount: '40.00',
      boardCount: 1,
      pressCount: 5000,
      orderCompleted: false,
    });
    const r = await reportTaskAction(
      'task-1',
      null,
      fd({ completedQty: '4900', defectQty: '50', reworkQty: '50' }),
    );
    expect(r.status).toBe('success');
    expect(productionMock.reportTask).toHaveBeenCalledWith(
      'task-1',
      { completedQty: 4900, defectQty: 50, reworkQty: 50 },
      expect.objectContaining({ id: 'worker-1', role: Role.WORKER }),
    );
  });

  it('treats empty defectQty / reworkQty as 0', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    productionMock.reportTask.mockResolvedValue({
      taskId: 'task-1',
      status: 'COMPLETED',
      pieceworkAmount: '40.00',
      boardCount: 1,
      pressCount: 5000,
      orderCompleted: false,
    });
    await reportTaskAction(
      'task-1',
      null,
      fd({ completedQty: '5000', defectQty: '', reworkQty: '' }),
    );
    expect(productionMock.reportTask.mock.calls[0][1]).toEqual({
      completedQty: 5000,
      defectQty: 0,
      reworkQty: 0,
    });
  });

  it('rejects non-numeric completedQty as invalid', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    const r = await reportTaskAction(
      'task-1',
      null,
      fd({ completedQty: 'abc', defectQty: '0', reworkQty: '0' }),
    );
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') {
      expect(r.fieldErrors.completedQty).toBeDefined();
    }
    expect(productionMock.reportTask).not.toHaveBeenCalled();
  });

  it('rejects negative counts as invalid', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    const r = await reportTaskAction(
      'task-1',
      null,
      fd({ completedQty: '-5', defectQty: '0', reworkQty: '0' }),
    );
    expect(r.status).toBe('invalid');
  });

  it('rejects all-zero submission (must have produced at least 1)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    const r = await reportTaskAction(
      'task-1',
      null,
      fd({ completedQty: '0', defectQty: '0', reworkQty: '0' }),
    );
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') {
      // The superRefine message attaches to completedQty path.
      expect(r.fieldErrors.completedQty).toContain(
        '至少报一件（合格 / 不良 / 返工 三者之和 > 0）',
      );
    }
  });

  it('rejects decimal completedQty (pieces are integer)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    const r = await reportTaskAction(
      'task-1',
      null,
      fd({ completedQty: '4.5', defectQty: '0', reworkQty: '0' }),
    );
    expect(r.status).toBe('invalid');
  });

  it('maps ReportError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    productionMock.reportTask.mockRejectedValueOnce(
      new MockReportError('无当前生效的 HAND_PRESS 薪资规则'),
    );
    const r = await reportTaskAction(
      'task-1',
      null,
      fd({ completedQty: '5000', defectQty: '0', reworkQty: '0' }),
    );
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      expect(r.message).toMatch(/薪资规则/);
    }
  });

  it('revalidates both routes on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    productionMock.reportTask.mockResolvedValue({
      taskId: 'task-1',
      status: 'COMPLETED',
      pieceworkAmount: '40.00',
      boardCount: 1,
      pressCount: 5000,
      orderCompleted: true,
    });
    await reportTaskAction(
      'task-1',
      null,
      fd({ completedQty: '5000', defectQty: '0', reworkQty: '0' }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/worker/tasks');
    expect(revalidatePathMock).toHaveBeenCalledWith('/worker/tasks/task-1');
  });
});
