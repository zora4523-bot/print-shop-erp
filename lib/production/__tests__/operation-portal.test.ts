import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PieceworkOperationType,
  PieceworkRateUnit,
  ProductionOperationStatus,
  Role,
  WorkerType,
} from '../../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    user: { findUnique: vi.fn() },
    productionOperation: { findMany: vi.fn(), findFirst: vi.fn() },
    productionProgressStep: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  getProductionOperationForReporter,
  getProductionProgressForReporter,
  listProductionOperationsForReporter,
  listProductionProgressForReporter,
} from '../operation-portal';

beforeEach(() => {
  dbMock.user.findUnique.mockReset().mockResolvedValue({
    id: 'packer-1',
    role: Role.WORKER,
    isActive: true,
    workerType: WorkerType.PACKER,
    machineType: null,
  });
  dbMock.productionOperation.findMany.mockReset().mockResolvedValue([
    {
      id: 'packing-1',
      orderId: 'order-1',
      workOrderVersion: 1,
      operationType: PieceworkOperationType.PACKING,
      unit: PieceworkRateUnit.PER_BAG,
      status: ProductionOperationStatus.IN_PROGRESS,
      plannedQty: new Decimal(12),
      createdAt: new Date('2026-08-28T00:00:00.000Z'),
      order: {
        orderNo: 'GD-1',
        customName: null,
        isUrgent: true,
        promisedDate: null,
        workOrderVersion: 1,
      },
      sources: [{ orderItem: null }],
      reports: [
        {
          reportedCompletedQty: new Decimal(5),
          defectQty: new Decimal(1),
          reworkQty: new Decimal(2),
        },
      ],
    },
  ]);
  dbMock.productionOperation.findFirst.mockReset().mockResolvedValue(null);
  dbMock.productionProgressStep.findMany.mockReset().mockResolvedValue([]);
  dbMock.productionProgressStep.findFirst.mockReset().mockResolvedValue(null);
});

describe('no-pay production progress portal', () => {
  it('活跃 WORKER 可见所有待处理进度，不加人员/岗位/机型匹配', async () => {
    dbMock.user.findUnique.mockResolvedValue({
      id: 'cleaner-1',
      role: Role.WORKER,
      isActive: true,
    });
    dbMock.productionProgressStep.findMany.mockResolvedValue([
      {
        id: 'progress-1',
        orderId: 'order-1',
        workOrderVersion: 1,
        craftCode: 'CLEANING',
        craftName: '清废',
        status: ProductionOperationStatus.IN_PROGRESS,
        plannedQty: new Decimal(100),
        createdAt: new Date('2026-08-28T00:00:00.000Z'),
        order: {
          orderNo: 'GD-1',
          customName: null,
          isUrgent: false,
          promisedDate: null,
          workOrderVersion: 1,
        },
        orderItem: { sequence: 1, name: '款式一' },
        reports: [
          {
            completedQty: new Decimal(40),
            defectQty: new Decimal(2),
            reworkQty: new Decimal(1),
          },
        ],
      },
    ]);

    await expect(
      listProductionProgressForReporter({
        id: 'cleaner-1',
        role: Role.WORKER,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'progress-1',
        craftCode: 'CLEANING',
        completedQty: '40',
        defectQty: '2',
        reworkQty: '1',
      }),
    ]);
    const where = dbMock.productionProgressStep.findMany.mock.calls[0]![0]
      .where;
    expect(JSON.stringify(where)).not.toMatch(/worker|machine|capabilit/iu);
  });

  it('无计件进度详情只按步骤 id 取数，保留款式生产信息', async () => {
    dbMock.productionProgressStep.findFirst.mockResolvedValue({
      id: 'progress-1',
      orderId: 'order-1',
      workOrderVersion: 1,
      craftCode: 'GLUING',
      craftName: '粘封',
      status: ProductionOperationStatus.PENDING,
      plannedQty: new Decimal(100),
      order: {
        orderNo: 'GD-1',
        customName: null,
        isUrgent: false,
        promisedDate: null,
        workOrderVersion: 1,
        packageRequirement: null,
        remark: null,
      },
      orderItem: {
        id: 'item-1',
        sequence: 1,
        name: '款式一',
        specification: '80x115',
        paperType: '艳闪',
        quantity: 100,
        remark: null,
        designs: [],
      },
      reports: [],
    });

    await expect(
      getProductionProgressForReporter('progress-1', {
        id: 'packer-1',
        role: Role.WORKER,
      }),
    ).resolves.toMatchObject({
      id: 'progress-1',
      craftName: '粘封',
      plannedQty: '100',
      item: { id: 'item-1', sequence: 1 },
    });
    expect(dbMock.productionProgressStep.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'progress-1' } }),
    );
    expect(
      JSON.stringify(dbMock.productionProgressStep.findFirst.mock.calls[0]),
    ).not.toMatch(/worker|machine|capabilit/iu);
  });
});

describe('getProductionOperationForReporter', () => {
  it('scopes detail to the fixed operation lane without worker assignment', async () => {
    dbMock.productionOperation.findFirst.mockResolvedValue({
      id: 'packing-1',
      orderId: 'order-1',
      workOrderVersion: 1,
      operationType: PieceworkOperationType.PACKING,
      unit: PieceworkRateUnit.PER_BAG,
      status: ProductionOperationStatus.IN_PROGRESS,
      plannedQty: new Decimal(12),
      order: {
        orderNo: 'GD-1',
        customName: null,
        isUrgent: false,
        promisedDate: null,
        workOrderVersion: 1,
        packageRequirement: null,
        remark: null,
      },
      sources: [],
      reports: [],
    });

    await expect(
      getProductionOperationForReporter('packing-1', {
        id: 'packer-1',
        role: Role.WORKER,
      }),
    ).resolves.toMatchObject({
      id: 'packing-1',
      operationType: PieceworkOperationType.PACKING,
      plannedCompletedQty: '12',
    });
    const where = dbMock.productionOperation.findFirst.mock.calls[0]![0].where;
    expect(where).toEqual({
      id: 'packing-1',
      operationType: PieceworkOperationType.PACKING,
    });
    expect(JSON.stringify(where)).not.toContain('workerId');
  });

  it('returns null for an operation from an obsolete work-order version', async () => {
    dbMock.productionOperation.findFirst.mockResolvedValue({
      id: 'packing-v1',
      orderId: 'order-1',
      workOrderVersion: 1,
      operationType: PieceworkOperationType.PACKING,
      unit: PieceworkRateUnit.PER_BAG,
      status: ProductionOperationStatus.PENDING,
      plannedQty: new Decimal(12),
      order: {
        orderNo: 'GD-1',
        customName: null,
        isUrgent: false,
        promisedDate: null,
        workOrderVersion: 2,
        packageRequirement: null,
        remark: null,
      },
      sources: [],
      reports: [],
    });

    await expect(
      getProductionOperationForReporter('packing-v1', {
        id: 'packer-1',
        role: Role.WORKER,
      }),
    ).resolves.toBeNull();
  });
});

describe('listProductionOperationsForReporter', () => {
  it('lists the fixed account lane without a worker/order assignment filter', async () => {
    await expect(
      listProductionOperationsForReporter({ id: 'packer-1', role: Role.WORKER }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'packing-1',
        operationType: PieceworkOperationType.PACKING,
        plannedCompletedQty: '12',
        completedQty: '5',
        defectQty: '1',
        reworkQty: '2',
        passCount: 1,
      }),
    ]);
    expect(dbMock.productionOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          operationType: PieceworkOperationType.PACKING,
        }),
      }),
    );
    const where = dbMock.productionOperation.findMany.mock.calls[0]![0].where;
    expect(JSON.stringify(where)).not.toContain('workerId');
    expect(JSON.stringify(where)).not.toContain('machineType');
  });

  it('rejects an inactive account before querying operations', async () => {
    dbMock.user.findUnique.mockResolvedValue({
      id: 'packer-1',
      role: Role.WORKER,
      isActive: false,
      workerType: WorkerType.PACKER,
      machineType: null,
    });
    await expect(
      listProductionOperationsForReporter({ id: 'packer-1', role: Role.WORKER }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_AUTHORIZED' });
    expect(dbMock.productionOperation.findMany).not.toHaveBeenCalled();
  });

  it('omits obsolete generations from the worker queue', async () => {
    dbMock.productionOperation.findMany.mockResolvedValue([
      {
        id: 'packing-v1',
        orderId: 'order-1',
        workOrderVersion: 1,
        operationType: PieceworkOperationType.PACKING,
        unit: PieceworkRateUnit.PER_BAG,
        status: ProductionOperationStatus.PENDING,
        plannedQty: new Decimal(12),
        createdAt: new Date('2026-08-28T00:00:00.000Z'),
        order: {
          orderNo: 'GD-1',
          customName: null,
          isUrgent: false,
          promisedDate: null,
          workOrderVersion: 2,
        },
        sources: [],
        reports: [],
      },
    ]);

    await expect(
      listProductionOperationsForReporter({
        id: 'packer-1',
        role: Role.WORKER,
      }),
    ).resolves.toEqual([]);
  });
});
