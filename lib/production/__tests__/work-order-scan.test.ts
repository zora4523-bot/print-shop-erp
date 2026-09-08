import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PieceworkOperationType,
  ProductionOperationStatus,
  Role,
} from '../../../generated/prisma/enums';

const { dbMock, operationTypeMock } = vi.hoisted(() => ({
  dbMock: { order: { findUnique: vi.fn() } },
  operationTypeMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('../operation-portal', () => ({
  getReporterOperationTypeOrNull: operationTypeMock,
}));

import { resolveWorkerWorkOrderScan } from '../work-order-scan';

const actor = { id: 'worker-1', role: Role.WORKER };

beforeEach(() => {
  dbMock.order.findUnique.mockReset().mockResolvedValue(null);
  operationTypeMock
    .mockReset()
    .mockResolvedValue(PieceworkOperationType.PARTIAL);
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

  it('无计件 lane 的在职师傅仍可达当前版本共享进度', async () => {
    operationTypeMock.mockResolvedValue(null);
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-2',
      workOrderVersion: 5,
      productionOperations: [],
      productionProgressSteps: [
        { id: 'progress-v4', workOrderVersion: 4 },
        { id: 'progress-v5', workOrderVersion: 5, status: ProductionOperationStatus.PENDING },
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

  it('付费工序和共享进度同时待报工时进入选择页', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1', workOrderVersion: 3,
      productionOperations: [{ id: 'foil', workOrderVersion: 3, status: ProductionOperationStatus.PENDING }],
      productionProgressSteps: [{ id: 'clean', workOrderVersion: 3, status: ProductionOperationStatus.PENDING }],
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
});
