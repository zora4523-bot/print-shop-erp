import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, Role } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  productionMock,
  productionBatchMock,
  taskClaimMock,
  revalidatePathMock,
  MockSchedulingError,
  MockReportError,
  MockOrderInvariantError,
  MockInvalidOrderTransitionError,
  MockInvalidTaskTransitionError,
  MockOverReportError,
  MockTaskClaimError,
} = vi.hoisted(() => {
  class ReportErrorStub extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'ReportError';
    }
  }

  // 数量守卫的错误。**必须**出现在下面的 vi.mock('@/lib/production') 工厂里：
  // actions/production.ts 对它做 `err instanceof OverReportError`，工厂里缺了
  // 它就是 `instanceof undefined` → TypeError，整组报工用例当场变红。
  //
  // 而且**必须继承 ReportErrorStub**，跟着 lib/production.ts 的真类走：
  // mapTaskError 靠 `err instanceof ReportError` 兜住「不可确认」那条硬拒，
  // 这里挂到裸 Error 上，硬拒就会穿过 action 一路抛出去 —— 那正是本文件
  // 「不可确认的 OverReportError → error」用例要挡的回归。
  // 用 class 声明（不是对象字面量里的 class 表达式）就是为了能引用它。
  class OverReportErrorStub extends ReportErrorStub {
    readonly confirmable: boolean;
    readonly plannedQty: number;
    readonly totalReported: number;
    readonly limitQty: number;
    constructor(args: {
      message: string;
      confirmable: boolean;
      plannedQty: number;
      totalReported: number;
      limitQty: number;
    }) {
      super(args.message);
      this.name = 'OverReportError';
      this.confirmable = args.confirmable;
      this.plannedQty = args.plannedQty;
      this.totalReported = args.totalReported;
      this.limitQty = args.limitQty;
    }
  }

  return {
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
    taskClaimMock: {
      claimTask: vi.fn(),
      releaseTaskToClaimPool: vi.fn(),
    },
    revalidatePathMock: vi.fn(),
    MockSchedulingError: class extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = 'SchedulingError';
      }
    },
    MockReportError: ReportErrorStub,
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
    MockOverReportError: OverReportErrorStub,
    MockTaskClaimError: class extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = 'TaskClaimError';
      }
    },
  };
});

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
  OverReportError: MockOverReportError,
  InvalidTaskTransitionError: MockInvalidTaskTransitionError,
}));
vi.mock('@/lib/production/batch-scheduling', () => ({
  scheduleOrdersToWorker: productionBatchMock.scheduleOrdersToWorker,
}));
vi.mock('@/lib/production/task-claim', () => ({
  claimTask: taskClaimMock.claimTask,
  releaseTaskToClaimPool: taskClaimMock.releaseTaskToClaimPool,
  TaskClaimError: MockTaskClaimError,
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
  claimTaskFormAction,
  releaseTaskToClaimPoolAction,
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
  taskClaimMock.claimTask.mockReset();
  taskClaimMock.releaseTaskToClaimPool.mockReset();
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

describe('claim task actions', () => {
  it("claimTaskFormAction first-line requirePermission('task:claim')", async () => {
    permissionsMock.requirePermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );
    await expect(
      claimTaskFormAction(null, fd({ taskId: 'task-1' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('task:claim');
    expect(taskClaimMock.claimTask).not.toHaveBeenCalled();
  });

  it('抢单成功后失效师傅任务/工单与管理端工单视图', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    taskClaimMock.claimTask.mockResolvedValue({
      taskId: 'task-1',
      orderId: 'order-1',
      workerId: 'worker-1',
      machineType: 'WINDMILL',
    });
    await expect(
      claimTaskFormAction(null, fd({ taskId: 'task-1' })),
    ).resolves.toEqual({ status: 'success', taskId: 'task-1' });
    expect(taskClaimMock.claimTask).toHaveBeenCalledWith('task-1', workerActor);
    for (const path of [
      '/worker/tasks',
      '/worker/orders',
      '/worker/tasks/task-1',
      '/orders/order-1',
    ]) {
      expect(revalidatePathMock).toHaveBeenCalledWith(path);
    }
  });

  it('零 JS form wrapper 先验权再校验 hidden taskId', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    await expect(claimTaskFormAction(null, new FormData())).resolves.toEqual({
      status: 'error',
      message: expect.stringContaining('参数缺失'),
    });
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('task:claim');
    expect(taskClaimMock.claimTask).not.toHaveBeenCalled();
  });

  it('并发抢走等领域错误映射为可读 error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    taskClaimMock.claimTask.mockRejectedValue(
      new MockTaskClaimError('该任务已被其他师傅抢走'),
    );
    await expect(
      claimTaskFormAction(null, fd({ taskId: 'task-1' })),
    ).resolves.toEqual({
      status: 'error',
      message: '该任务已被其他师傅抢走',
    });
  });
});

describe('releaseTaskToClaimPoolAction', () => {
  it("first-line requirePermission('task:assign')", async () => {
    permissionsMock.requirePermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );
    await expect(
      releaseTaskToClaimPoolAction(null, fd({ taskId: 'task-1' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('task:assign');
    expect(taskClaimMock.releaseTaskToClaimPool).not.toHaveBeenCalled();
  });

  it('管理员释放成功后失效管理端和师傅端视图', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    taskClaimMock.releaseTaskToClaimPool.mockResolvedValue({
      taskId: 'task-1',
      orderId: 'order-1',
      previousWorkerId: 'worker-1',
    });
    await expect(
      releaseTaskToClaimPoolAction(null, fd({ taskId: 'task-1' })),
    ).resolves.toEqual({ status: 'success', taskId: 'task-1' });
    expect(taskClaimMock.releaseTaskToClaimPool).toHaveBeenCalledWith(
      'task-1',
      foremanActor,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/order-1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/worker/tasks');
    expect(revalidatePathMock).toHaveBeenCalledWith('/worker/orders');
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

  it('勾了确认框时把 overReportConfirmed=true 透传给 lib', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    productionMock.reportTask.mockResolvedValue({
      taskId: 'task-1',
      status: 'COMPLETED',
      pieceworkAmount: '48.40',
      boardCount: 1,
      pressCount: 6200,
      orderCompleted: false,
    });
    await reportTaskAction(
      'task-1',
      null,
      fd({
        completedQty: '6200',
        defectQty: '0',
        reworkQty: '0',
        overReportConfirmed: 'true',
      }),
    );
    expect(productionMock.reportTask.mock.calls[0][1]).toEqual({
      completedQty: 6200,
      defectQty: 0,
      reworkQty: 0,
      overReportConfirmed: true,
    });
  });

  it('可确认的 OverReportError → invalid + 挂在复选框上的字段错误 + 回填', async () => {
    // 这条钉住 actions/production.ts 里两个 catch 分支的**顺序**：
    // OverReportError 继承 ReportError，先走 mapTaskError 会把「勾一下就能过」
    // 吞成通用 error，复选框永远不出现、师傅被永久拦在报工外。顺序反了这条红。
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    productionMock.reportTask.mockRejectedValueOnce(
      new MockOverReportError({
        message: '合计报工 6200 超过计划数 5000，请勾选「确认超出计划数」后再提交。',
        confirmable: true,
        plannedQty: 5000,
        totalReported: 6200,
        limitQty: 15000,
      }),
    );
    const r = await reportTaskAction(
      'task-1',
      null,
      fd({ completedQty: '6200', defectQty: '0', reworkQty: '0' }),
    );
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') {
      expect(r.fieldErrors.overReportConfirmed?.[0]).toMatch(/请勾选/);
      expect(r.overReport).toEqual({ plannedQty: 5000, totalReported: 6200 });
      // 回填：零 JS 下不回填，输入框会被重置回计划数，师傅勾确认再提交就
      // 静默按计划数入库 —— 正好把守卫要防的事做实。
      expect(r.values.completedQty).toBe('6200');
      expect(r.values.overReportConfirmed).toBe(false);
    }
  });

  it('不可确认的 OverReportError → error + 仍然回填数量', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    productionMock.reportTask.mockRejectedValueOnce(
      new MockOverReportError({
        message:
          '合计报工 50000 已达到计划数 5000 的 3 倍上限（15000），请核对数量后重新填写。',
        confirmable: false,
        plannedQty: 5000,
        totalReported: 50000,
        limitQty: 15000,
      }),
    );
    const r = await reportTaskAction(
      'task-1',
      null,
      fd({
        completedQty: '50000',
        defectQty: '0',
        reworkQty: '0',
        overReportConfirmed: 'true',
      }),
    );
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      expect(r.message).toMatch(/3 倍上限（15000）/);
      expect(r.values.completedQty).toBe('50000');
      expect(r.values.overReportConfirmed).toBe(true);
    }
  });

  it('字段校验失败时也回填，不把数字重置回计划数', async () => {
    permissionsMock.requirePermission.mockResolvedValue(workerActor);
    const r = await reportTaskAction(
      'task-1',
      null,
      fd({ completedQty: 'abc', defectQty: '7', reworkQty: '0' }),
    );
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') {
      expect(r.values.completedQty).toBe('abc');
      expect(r.values.defectQty).toBe('7');
      expect(r.overReport).toBeUndefined();
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
