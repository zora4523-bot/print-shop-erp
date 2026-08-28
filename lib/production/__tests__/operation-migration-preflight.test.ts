import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
  OrderCraft,
  OrderPricingStatus,
  OrderSettlementType,
  OrderStatus,
  TaskStatus,
} from '../../../generated/prisma/enums';

vi.mock('@/lib/db', () => ({ db: { order: { findMany: vi.fn() } } }));

import { preflightLegacyOperationConversion } from '../operation-migration-preflight';

const AT = new Date('2026-08-28T08:00:00.000Z');

function legacyOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNo: 'GD-1',
    status: OrderStatus.SCHEDULING,
    pricingStatus: OrderPricingStatus.LEGACY_CONFIRMED,
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    items: [
      {
        id: 'item-1',
        sequence: 1,
        craft: OrderCraft.FULL,
        quantity: 100,
        frontFoilColors: ['gold'],
        backFoilColors: [],
        hasLocalFoil: false,
        tasks: [
          {
            id: 'legacy-task-1',
            status: TaskStatus.PENDING,
            workerId: 'worker-legacy',
            workerType: 'MACHINE',
            machineType: 'WINDMILL',
            completedQty: 0,
            pieceworkAmount: new Decimal(0),
            dailySalaryItem: null,
          },
        ],
      },
    ],
    packagingGroups: [
      {
        id: 'group-1',
        sequence: 1,
        actualBagCount: 10,
        lines: [{ orderItemId: 'item-1', unitsPerBag: 10 }],
      },
    ],
    productionOperations: [],
    ...overrides,
  };
}

describe('preflightLegacyOperationConversion', () => {
  it('returns a read-only deterministic plan and assignment statistics', async () => {
    const client = {
      order: { findMany: vi.fn().mockResolvedValue([legacyOrder()]) },
    };
    const result = await preflightLegacyOperationConversion(
      client as never,
      AT,
    );
    expect(result).toMatchObject({
      generatedAt: AT,
      scannedOrderCount: 1,
      activeTaskCount: 1,
      assignedActiveTaskCount: 1,
      convertibleOrderCount: 1,
      blockedOrderCount: 0,
    });
    expect(result.orders[0]).toMatchObject({
      convertible: true,
      activeTaskIds: ['legacy-task-1'],
      proposedOperations: [
        expect.objectContaining({ operationType: 'FULL', plannedQty: '100' }),
        expect.objectContaining({ operationType: 'PACKING', plannedQty: '10' }),
      ],
    });
    expect(client.order.findMany).toHaveBeenCalledOnce();
    expect(Object.keys(client.order)).toEqual(['findMany']);
  });

  it('blocks mixed completed/in-flight legacy pay and incomplete packaging', async () => {
    const order = legacyOrder();
    const tasks = order.items[0]!.tasks as Array<{
      id: string;
      status: TaskStatus;
      workerId: string | null;
      workerType: string | null;
      machineType: string | null;
      completedQty: number;
      pieceworkAmount: Decimal;
      dailySalaryItem: null | {
        id: string;
        dailySalary: { id: string; isPaid: boolean };
      };
    }>;
    tasks.push({
      id: 'legacy-completed',
      status: TaskStatus.COMPLETED,
      workerId: 'worker-legacy',
      workerType: 'MACHINE',
      machineType: 'WINDMILL',
      completedQty: 100,
      pieceworkAmount: new Decimal(10),
      dailySalaryItem: {
        id: 'salary-item-1',
        dailySalary: { id: 'salary-1', isPaid: true },
      },
    });
    order.packagingGroups = [];
    const client = {
      order: { findMany: vi.fn().mockResolvedValue([order]) },
    };
    const result = await preflightLegacyOperationConversion(
      client as never,
      AT,
    );
    expect(result.blockedOrderCount).toBe(1);
    expect(result.orders[0]!.convertible).toBe(false);
    expect(result.orders[0]!.proposedOperations).toEqual([]);
    expect(result.orders[0]!.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'NO_PACKAGING_GROUPS',
        'PACKAGING_QUANTITY_MISMATCH',
        'MIXED_LEGACY_TERMINAL_STATE',
        'LEGACY_SALARY_ALREADY_CAPTURED',
      ]),
    );
  });

  it('blocks a second ledger when operations already exist', async () => {
    const client = {
      order: {
        findMany: vi.fn().mockResolvedValue([
          legacyOrder({ productionOperations: [{ id: 'operation-existing' }] }),
        ]),
      },
    };
    const result = await preflightLegacyOperationConversion(
      client as never,
      AT,
    );
    expect(result.orders[0]!.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ALREADY_HAS_OPERATIONS' }),
      ]),
    );
  });
});
