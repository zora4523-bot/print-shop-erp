import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderStatus,
  ProductionOperationStatus,
  Role,
} from '../../../generated/prisma/enums';

const {
  dbMock,
  databaseNowMock,
  completionMock,
  completionDispatchMock,
} = vi.hoisted(() => ({
  databaseNowMock: vi.fn(),
  completionMock: vi.fn(),
  completionDispatchMock: vi.fn(),
  dbMock: {
    productionProgressStep: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    productionProgressReport: {
      findUnique: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    productionScanClaim: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    craft: { findMany: vi.fn() },
    order: { update: vi.fn() },
    orderLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseNow: databaseNowMock,
  databaseClockNow: databaseNowMock,
}));
vi.mock('@/lib/production-completion', () => ({
  maybeCompleteProductionOrder: completionMock,
  dispatchProductionCompletionNotification: completionDispatchMock,
}));

import {
  reportProductionProgress,
} from '../progress-reporting';

const NOW = new Date('2026-08-28T08:00:00.000Z');
const ACTOR = { id: 'worker-1', role: Role.WORKER };

function stepFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'progress-1',
    orderId: 'order-1',
    workOrderVersion: 1,
    status: ProductionOperationStatus.PENDING,
    plannedQty: new Decimal(100),
    craftId: 'craft-gluing',
    craftCode: 'GLUING',
    craftName: '粘封',
    orderItem: { id: 'item-1', sequence: 1 },
    order: {
      id: 'order-1',
      orderNo: 'GD-1',
      status: OrderStatus.SCHEDULING,
      scheduledAt: null,
      workOrderVersion: 1,
    },
    ...overrides,
  };
}

function arrangeStep(step = stepFixture()) {
  dbMock.productionProgressStep.findUnique.mockImplementation(
    async (args: { select?: Record<string, unknown> }) =>
      args.select && Object.keys(args.select).length === 2
        ? { id: 'progress-1', orderId: 'order-1' }
        : step,
  );
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    progressStepId: 'progress-1',
    completedQty: 50,
    defectQty: 3,
    reworkQty: 2,
    idempotencyKey: 'progress-scan-0001',
    ...overrides,
  };
}

beforeEach(() => {
  for (const delegate of [
    dbMock.productionProgressStep,
    dbMock.productionProgressReport,
    dbMock.productionScanClaim,
    dbMock.user,
    dbMock.order,
    dbMock.orderLog,
  ]) {
    for (const mock of Object.values(delegate)) mock.mockReset();
  }
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$transaction.mockReset().mockImplementation(async (fn) => fn(dbMock));
  databaseNowMock.mockReset().mockResolvedValue(NOW);
  completionMock.mockReset().mockResolvedValue({
    completed: false,
    blockedBy: 'INTERNAL_TASKS',
    uncoveredItems: [],
  });
  completionDispatchMock.mockReset().mockResolvedValue(undefined);
  dbMock.craft.findMany.mockReset().mockImplementation(async ({ where }) => where.defaultWorkerType === 'MACHINE' ? [{ id: 'craft-gluing' }] : []);
  arrangeStep();
  dbMock.user.findUnique.mockResolvedValue({
    id: ACTOR.id,
    workerType: 'MACHINE',
    machineType: 'GLUE',
    role: Role.WORKER,
    isActive: true,
  });
  dbMock.productionProgressReport.findUnique.mockResolvedValue(null);
  dbMock.productionProgressReport.aggregate.mockResolvedValue({
    _sum: { completedQty: null },
  });
  dbMock.productionProgressReport.create.mockResolvedValue({ id: 'report-1' });
  dbMock.productionScanClaim.findUnique.mockResolvedValue(null);
  dbMock.productionScanClaim.create.mockResolvedValue({
    id: 'claim-1',
    claimedAt: NOW,
  });
  dbMock.productionProgressStep.update.mockResolvedValue({ id: 'progress-1' });
  dbMock.order.update.mockResolvedValue({ id: 'order-1' });
  dbMock.orderLog.create.mockResolvedValue({ id: 'log-1' });
});

describe('reportProductionProgress', () => {
  it('无计件工资的工艺步骤也承接已完成量并阻止超报', async () => {
    arrangeStep(stepFixture({ carriedCompletedQty: new Decimal(60) }));
    await expect(reportProductionProgress(input({ completedQty: 41 }), ACTOR)).rejects.toThrow(/超过/);
    expect(dbMock.productionProgressReport.create).not.toHaveBeenCalled();
    await expect(reportProductionProgress(input({ completedQty: 40 }), ACTOR)).resolves.toMatchObject({ completedAggregate: '100', progressStatus: ProductionOperationStatus.COMPLETED });
  });

  it('已下发工单的无计件扫码也只写入真实首次认领', async () => {
    arrangeStep(
      stepFixture({
        workOrderVersion: 2,
        order: {
          id: 'order-1',
          orderNo: 'GD-1',
          status: OrderStatus.RELEASED,
          scheduledAt: new Date('2026-08-27T08:00:00.000Z'),
          workOrderVersion: 2,
        },
      }),
    );

    await expect(reportProductionProgress(input(), ACTOR)).resolves.toMatchObject({
      reportId: 'report-1',
      orderStatus: OrderStatus.RELEASED,
    });
    expect(dbMock.productionScanClaim.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        workOrderVersion: 2,
        operationId: null,
        progressStepId: 'progress-1',
        reporterId: ACTOR.id,
        idempotencyKey: 'progress-scan-0001',
        claimedAt: NOW,
      }),
      select: { id: true, claimedAt: true },
    });
  });

  it('记录合格/缺陷/返工进度，不产生任何工价或金额字段', async () => {
    await expect(
      reportProductionProgress(input(), ACTOR),
    ).resolves.toMatchObject({
      reportId: 'report-1',
      completedAggregate: '50',
      progressStatus: ProductionOperationStatus.IN_PROGRESS,
      orderStatus: OrderStatus.IN_PRODUCTION,
    });

    const createData = dbMock.productionProgressReport.create.mock.calls[0][0]
      .data;
    expect(createData).toEqual({
      progressStepId: 'progress-1',
      reporterId: ACTOR.id,
      completedQty: '50',
      defectQty: '3',
      reworkQty: '2',
      idempotencyKey: 'progress-scan-0001',
      reportedAt: NOW,
    });
    expect(createData).not.toHaveProperty('rate');
    expect(createData).not.toHaveProperty('amount');
    expect(createData).not.toHaveProperty('priceBookId');
    expect(dbMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: ACTOR.id },
      select: { id: true, role: true, isActive: true, workerType: true, machineType: true },
    });
  });

  it('最后一次进度报工完成步骤并调用统一完工闸口', async () => {
    const notification = {
      payload: {
        orderId: 'order-1',
        orderNo: 'GD-1',
        workOrderVersion: 1,
        customerRef: null,
      },
      dedupeKey: 'notification:ORDER_COMPLETED:order-1',
      queued: false,
    };
    completionMock.mockResolvedValue({
      completed: true,
      orderStatus: OrderStatus.COMPLETED,
      blockedBy: null,
      uncoveredItems: [],
      notification,
    });
    dbMock.$transaction.mockImplementationOnce(async (callback) => {
      const transactionResult = await callback(dbMock);
      expect(completionDispatchMock).not.toHaveBeenCalled();
      return transactionResult;
    });

    await expect(
      reportProductionProgress(input({ completedQty: 100 }), ACTOR),
    ).resolves.toMatchObject({
      progressStatus: ProductionOperationStatus.COMPLETED,
      orderStatus: OrderStatus.COMPLETED,
    });
    expect(dbMock.productionProgressStep.update).toHaveBeenCalledWith({
      where: { id: 'progress-1' },
      data: { status: ProductionOperationStatus.COMPLETED },
    });
    expect(completionMock).toHaveBeenCalledWith(
      dbMock,
      'order-1',
      ACTOR.id,
      NOW,
    );
    expect(completionDispatchMock).toHaveBeenCalledWith(notification);
  });

  it('canonical 最后一个非计件步骤完成后保持 PACKING 并在事务提交后发送当前代次通知', async () => {
    arrangeStep(
      stepFixture({
        workOrderVersion: 2,
        order: {
          id: 'order-1',
          orderNo: 'GD-1',
          status: OrderStatus.PACKING,
          scheduledAt: NOW,
          workOrderVersion: 2,
        },
      }),
    );
    const notification = {
      payload: {
        orderId: 'order-1',
        orderNo: 'GD-1',
        workOrderVersion: 2,
        customerRef: null,
      },
      dedupeKey: 'notification:ORDER_COMPLETED:order-1:v2',
      queued: false,
    };
    completionMock.mockResolvedValue({
      completed: true,
      orderStatus: OrderStatus.PACKING,
      blockedBy: null,
      uncoveredItems: [],
      notification,
    });

    await expect(
      reportProductionProgress(input({ completedQty: 100 }), ACTOR),
    ).resolves.toMatchObject({
      progressStatus: ProductionOperationStatus.COMPLETED,
      orderStatus: OrderStatus.PACKING,
    });
    expect(completionMock).toHaveBeenCalledWith(
      dbMock,
      'order-1',
      ACTOR.id,
      NOW,
    );
    expect(completionDispatchMock).toHaveBeenCalledWith(notification);
  });

  it('累计合格数超过计划时拒绝写入', async () => {
    dbMock.productionProgressReport.aggregate.mockResolvedValue({
      _sum: { completedQty: new Decimal(90) },
    });

    await expect(
      reportProductionProgress(input({ completedQty: 11 }), ACTOR),
    ).rejects.toMatchObject({ code: 'OVER_REPORT' });
    expect(dbMock.productionProgressReport.create).not.toHaveBeenCalled();
  });

  it('相同幂等键与请求只返回原报工，不重复写入', async () => {
    dbMock.productionProgressReport.findUnique.mockResolvedValue({
      id: 'report-existing',
      progressStepId: 'progress-1',
      reporterId: ACTOR.id,
      completedQty: new Decimal(50),
      defectQty: new Decimal(3),
      reworkQty: new Decimal(2),
      progressStep: {
        status: ProductionOperationStatus.IN_PROGRESS,
        orderId: 'order-1',
        order: { status: OrderStatus.IN_PRODUCTION },
      },
    });
    dbMock.productionProgressReport.aggregate.mockResolvedValue({
      _sum: { completedQty: new Decimal(50) },
    });

    await expect(
      reportProductionProgress(input(), ACTOR),
    ).resolves.toMatchObject({
      reportId: 'report-existing',
      idempotentReplay: true,
      completedAggregate: '50',
    });
    expect(dbMock.productionProgressReport.create).not.toHaveBeenCalled();
  });

  it('不同请求复用幂等键时拒绝', async () => {
    dbMock.productionProgressReport.findUnique.mockResolvedValue({
      id: 'report-existing',
      progressStepId: 'progress-1',
      reporterId: ACTOR.id,
      completedQty: new Decimal(49),
      defectQty: new Decimal(3),
      reworkQty: new Decimal(2),
      progressStep: {
        status: ProductionOperationStatus.IN_PROGRESS,
        orderId: 'order-1',
        order: { status: OrderStatus.IN_PRODUCTION },
      },
    });

    await expect(
      reportProductionProgress(input(), ACTOR),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('只允许会话中的活跃 WORKER 报工', async () => {
    dbMock.user.findUnique.mockResolvedValue({
      id: ACTOR.id,
      role: Role.WORKER,
      isActive: false,
    });

    await expect(
      reportProductionProgress(input(), ACTOR),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_AUTHORIZED' });
  });
});

 it('拒绝无对应工艺车道的账号写入进度', async () => {
  dbMock.user.findUnique.mockResolvedValue({ id: ACTOR.id, role: Role.WORKER, isActive: true, workerType: 'COOK', machineType: null });
  await expect(reportProductionProgress(input(), ACTOR)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_AUTHORIZED' });
  expect(dbMock.productionProgressReport.create).not.toHaveBeenCalled();
 });
