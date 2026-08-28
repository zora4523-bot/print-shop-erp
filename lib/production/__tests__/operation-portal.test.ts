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
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  getProductionOperationForReporter,
  listProductionOperationsForReporter,
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
});

describe('getProductionOperationForReporter', () => {
  it('scopes detail to the fixed operation lane without worker assignment', async () => {
    dbMock.productionOperation.findFirst.mockResolvedValue({
      id: 'packing-1',
      orderId: 'order-1',
      operationType: PieceworkOperationType.PACKING,
      unit: PieceworkRateUnit.PER_BAG,
      status: ProductionOperationStatus.IN_PROGRESS,
      plannedQty: new Decimal(12),
      order: {
        orderNo: 'GD-1',
        customName: null,
        isUrgent: false,
        promisedDate: null,
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
});
