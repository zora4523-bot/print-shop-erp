import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PieceworkOperationType,
  ProductionOperationStatus,
  Role,
} from '../../../generated/prisma/enums';

const { dbMock, operationTypeMock, progressCraftIdsMock } = vi.hoisted(() => ({
  dbMock: { order: { findUnique: vi.fn() } },
  operationTypeMock: vi.fn(),
  progressCraftIdsMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('../operation-portal', () => ({
  getReporterOperationTypeOrNull: operationTypeMock,
  getProgressCraftIdsForReporter: progressCraftIdsMock,
}));

import { resolveWorkerWorkOrderScan } from '../work-order-scan';

const actor = { id: 'worker-1', role: Role.WORKER };

beforeEach(() => {
  dbMock.order.findUnique.mockReset().mockResolvedValue(null);
  operationTypeMock
    .mockReset()
    .mockResolvedValue(PieceworkOperationType.PARTIAL);
  progressCraftIdsMock.mockReset().mockResolvedValue(['craft-emboss']);
});

describe('resolveWorkerWorkOrderScan', () => {
  it('只把当前代次且匹配师傅固定 lane 的新工序作为扫码目标', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      workOrderVersion: 3,
      productionOperations: [
        { id: 'operation-v2', workOrderVersion: 2 },
        { id: 'operation-v3', workOrderVersion: 3, status: ProductionOperationStatus.PENDING },
      ],
      productionProgressSteps: [],
    });

    await expect(
      resolveWorkerWorkOrderScan('GD-001', actor, 'operation-v3'),
    ).resolves.toEqual({
      orderId: 'order-1',
      workOrderVersion: 3,
      defaultTaskId: 'operation-v3',
      requestedTaskAllowed: true,
    });

    expect(dbMock.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderNo: 'GD-001' },
        select: expect.objectContaining({
          productionOperations: expect.objectContaining({
            where: {
              operationType: PieceworkOperationType.PARTIAL,
              status: { not: ProductionOperationStatus.CANCELLED },
            },
          }),
        }),
      }),
    );
  });

  it('旧代次 task id 不能在当前版本下打开，但保留当前目标供版本作废页判定', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      workOrderVersion: 3,
      productionOperations: [
        { id: 'operation-v2', workOrderVersion: 2 },
        { id: 'operation-v3', workOrderVersion: 3, status: ProductionOperationStatus.PENDING },
      ],
      productionProgressSteps: [],
    });

    await expect(
      resolveWorkerWorkOrderScan('GD-001', actor, 'operation-v2'),
    ).resolves.toMatchObject({
      defaultTaskId: 'operation-v3',
      requestedTaskAllowed: false,
    });
  });

  it('无计件 lane 的在职师傅仍可达当前版本本车道进度', async () => {
    operationTypeMock.mockResolvedValue(null);
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-2',
      workOrderVersion: 5,
      productionOperations: [],
      productionProgressSteps: [
        { id: 'progress-v4', workOrderVersion: 4, craftId: 'craft-emboss' },
        { id: 'progress-v5', workOrderVersion: 5, craftId: 'craft-emboss', status: ProductionOperationStatus.PENDING },
      ],
    });

    await expect(
      resolveWorkerWorkOrderScan('GD-002', actor),
    ).resolves.toMatchObject({
      defaultTaskId: 'progress-v5',
      requestedTaskAllowed: true,
    });
    expect(
      dbMock.order.findUnique.mock.calls[0][0].select.productionOperations.where
        .operationType,
    ).toEqual({ in: [] });
  });

  it('打包账号按固定岗位查询，多组打包不再默选首组', async () => {
    operationTypeMock.mockResolvedValue(PieceworkOperationType.PACKING);
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1', workOrderVersion: 3,
      productionOperations: [
        { id: 'pack-1', workOrderVersion: 3, status: ProductionOperationStatus.IN_PROGRESS },
        { id: 'pack-2', workOrderVersion: 3, status: ProductionOperationStatus.PENDING },
      ], productionProgressSteps: [],
    });
    await expect(resolveWorkerWorkOrderScan('GD-001', actor)).resolves.toMatchObject({ defaultTaskId: null, requestedTaskAllowed: true });
    expect(dbMock.order.findUnique.mock.calls[0][0].select.productionOperations.where.operationType).toBe(PieceworkOperationType.PACKING);
    await expect(resolveWorkerWorkOrderScan('GD-001', actor, 'foil-other-lane')).resolves.toMatchObject({ requestedTaskAllowed: false });
  });

  it('已完成任务保留旧码查看能力，但不抢占唯一未完成任务直达', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1', workOrderVersion: 3,
      productionOperations: [
        { id: 'pack-done', workOrderVersion: 3, status: ProductionOperationStatus.COMPLETED },
        { id: 'pack-open', workOrderVersion: 3, status: ProductionOperationStatus.PENDING },
      ], productionProgressSteps: [],
    });
    await expect(resolveWorkerWorkOrderScan('GD-001', actor, 'pack-done')).resolves.toMatchObject({ defaultTaskId: 'pack-open', requestedTaskAllowed: true });
  });

  it('全部任务完成时返回选择页目标，仍可展示完成进度', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1', workOrderVersion: 3,
      productionOperations: [{ id: 'pack-done', workOrderVersion: 3, status: ProductionOperationStatus.COMPLETED }],
      productionProgressSteps: [],
    });
    await expect(resolveWorkerWorkOrderScan('GD-001', actor)).resolves.toMatchObject({ orderId: 'order-1', defaultTaskId: null });
  });

  it('付费工序和本车道进度同时待报工时进入选择页', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1', workOrderVersion: 3,
      productionOperations: [{ id: 'foil', workOrderVersion: 3, status: ProductionOperationStatus.PENDING }],
      productionProgressSteps: [{ id: 'emboss', workOrderVersion: 3, craftId: 'craft-emboss', status: ProductionOperationStatus.PENDING }],
    });
    await expect(resolveWorkerWorkOrderScan('GD-001', actor)).resolves.toMatchObject({ defaultTaskId: null });
  });

  it('只有历史代次记录时拒绝访问', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      workOrderVersion: 3,
      productionOperations: [{ id: 'operation-v2', workOrderVersion: 2 }],
      productionProgressSteps: [],
    });

    await expect(
      resolveWorkerWorkOrderScan('GD-001', actor),
    ).resolves.toBeNull();
  });

  // 审计 L-8：扫码直达与 ?task= 只认本人车道（计件工序 + 进度工艺车道），不能跳到打不开的
  // 他车道步骤；工单页本身的可见范围不变。
  it('他车道进度不作为直达目标，也不接受 task 参数，但工单仍可进入选择页', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-3', workOrderVersion: 2,
      productionOperations: [{ id: 'foil-done', workOrderVersion: 2, status: ProductionOperationStatus.COMPLETED }],
      productionProgressSteps: [
        { id: 'glue-open', workOrderVersion: 2, craftId: 'craft-glue', status: ProductionOperationStatus.PENDING },
      ],
    });
    await expect(resolveWorkerWorkOrderScan('GD-003', actor)).resolves.toEqual({
      orderId: 'order-3', workOrderVersion: 2, defaultTaskId: null, requestedTaskAllowed: true,
    });
    await expect(resolveWorkerWorkOrderScan('GD-003', actor, 'glue-open')).resolves.toMatchObject({ requestedTaskAllowed: false });
    expect(progressCraftIdsMock).toHaveBeenCalledWith(actor);
    expect(dbMock.order.findUnique.mock.calls[0][0].select.productionProgressSteps.select).toMatchObject({ craftId: true });
  });

  it('本车道进度与他车道进度并存时，只按本车道未完成项决定直达', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-4', workOrderVersion: 1,
      productionOperations: [],
      productionProgressSteps: [
        { id: 'emboss-open', workOrderVersion: 1, craftId: 'craft-emboss', status: ProductionOperationStatus.IN_PROGRESS },
        { id: 'glue-open', workOrderVersion: 1, craftId: 'craft-glue', status: ProductionOperationStatus.PENDING },
      ],
    });
    await expect(resolveWorkerWorkOrderScan('GD-004', actor)).resolves.toMatchObject({ defaultTaskId: 'emboss-open' });
    await expect(resolveWorkerWorkOrderScan('GD-004', actor, 'emboss-open')).resolves.toMatchObject({ requestedTaskAllowed: true });
  });
});
