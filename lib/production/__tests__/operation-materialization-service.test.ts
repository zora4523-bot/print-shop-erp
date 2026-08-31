import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
  OrderCraft,
  OrderKind,
  OrderPricingStatus,
  OrderSettlementType,
  OrderStatus,
  ProductionOperationStatus,
} from '../../../generated/prisma/enums';

vi.mock('@/lib/db', () => ({ db: { $transaction: vi.fn() } }));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseNow: vi.fn(),
}));

import {
  activateProductionOperationsInTx,
} from '../operation-materialization-service';

const AT = new Date('2026-08-28T08:00:00.000Z');

function orderFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNo: 'GD-1',
    kind: OrderKind.NORMAL,
    status: OrderStatus.PENDING_FACTORY,
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    pricingStatus: OrderPricingStatus.AUTO_CONFIRMED,
    scheduledAt: null,
    requiresOutsource: false,
    items: [
      {
        id: 'item-1',
        sequence: 1,
        craft: OrderCraft.FULL,
        quantity: 100,
        frontFoilColors: ['gold'],
        backFoilColors: [],
        hasLocalFoil: false,
        crafts: [],
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
    productionProgressSteps: [],
    ...overrides,
  };
}

function transactionMock(
  order = orderFixture(),
  crafts: Array<Record<string, unknown>> = [],
) {
  let operationCounter = 0;
  let progressCounter = 0;
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      update: vi.fn().mockResolvedValue({ id: 'order-1' }),
    },
    productionOperation: {
      create: vi.fn().mockImplementation(async () => ({
        id: `operation-${++operationCounter}`,
      })),
    },
    productionProgressStep: {
      create: vi.fn().mockImplementation(async () => ({
        id: `progress-${++progressCounter}`,
      })),
    },
    craft: { findMany: vi.fn().mockResolvedValue(crafts) },
    orderLog: { create: vi.fn().mockResolvedValue({ id: 'log-1' }) },
  };
}

describe('activateProductionOperationsInTx', () => {
  it('atomically creates deterministic operations and activates the order', async () => {
    const tx = transactionMock();
    const result = await activateProductionOperationsInTx(
      tx as never,
      'order-1',
      { id: 'sales-1' },
      AT,
    );
    expect(result).toEqual({
      orderId: 'order-1',
      orderStatus: OrderStatus.SCHEDULING,
      operationIds: ['operation-1', 'operation-2'],
      operationsCreated: 2,
      progressStepIds: [],
      progressStepsCreated: 0,
      idempotentReplay: false,
    });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.productionOperation.create.mock.calls).toEqual([
      [
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: 'FULL',
            plannedQty: '100',
            sources: {
              create: [
                expect.objectContaining({
                  orderItemId: 'item-1',
                  sourceQty: '100',
                }),
              ],
            },
          }),
        }),
      ],
      [
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: 'PACKING',
            plannedQty: '10',
            sources: {
              create: [
                expect.objectContaining({
                  packagingGroupId: 'group-1',
                  sourceQty: '10',
                }),
              ],
            },
          }),
        }),
      ],
    ]);
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        status: OrderStatus.SCHEDULING,
        scheduledAt: AT,
        requiresOutsource: false,
      },
    });
  });

  it('is an exact no-op after a matching ledger already exists', async () => {
    const tx = transactionMock(
      orderFixture({
        status: OrderStatus.SCHEDULING,
        productionOperations: [
          {
            id: 'full-existing',
            operationType: 'FULL',
            unit: 'PER_PIECE',
            status: ProductionOperationStatus.PENDING,
            plannedQty: new Decimal(100),
            sources: [
              {
                sourceType: 'ORDER_ITEM',
                orderItemId: 'item-1',
                packagingGroupId: null,
                sourceQty: new Decimal(100),
              },
            ],
          },
          {
            id: 'packing-existing',
            operationType: 'PACKING',
            unit: 'PER_BAG',
            status: ProductionOperationStatus.PENDING,
            plannedQty: new Decimal(10),
            sources: [
              {
                sourceType: 'PACKAGING_GROUP',
                orderItemId: null,
                packagingGroupId: 'group-1',
                sourceQty: new Decimal(10),
              },
            ],
          },
        ],
        productionProgressSteps: [],
      }),
    );
    await expect(
      activateProductionOperationsInTx(
        tx as never,
        'order-1',
        { id: 'admin-1' },
        AT,
      ),
    ).resolves.toMatchObject({
      operationsCreated: 0,
      idempotentReplay: true,
      operationIds: ['full-existing', 'packing-existing'],
    });
    expect(tx.productionOperation.create).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('fails closed on a partial ledger instead of filling the missing rows', async () => {
    const tx = transactionMock(
      orderFixture({
        status: OrderStatus.SCHEDULING,
        productionOperations: [
          {
            id: 'only-full',
            operationType: 'FULL',
            unit: 'PER_PIECE',
            status: ProductionOperationStatus.PENDING,
            plannedQty: new Decimal(100),
            sources: [
              {
                sourceType: 'ORDER_ITEM',
                orderItemId: 'item-1',
                packagingGroupId: null,
                sourceQty: new Decimal(100),
              },
            ],
          },
        ],
        productionProgressSteps: [],
      }),
    );
    await expect(
      activateProductionOperationsInTx(
        tx as never,
        'order-1',
        { id: 'admin-1' },
        AT,
      ),
    ).rejects.toMatchObject({
      code: 'EXISTING_OPERATION_MISMATCH',
    });
    expect(tx.productionOperation.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      { pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION },
      'PRICING_NOT_CONFIRMED',
    ],
    [{ settlementType: OrderSettlementType.NO_CHARGE }, 'ORDER_NOT_CHARGEABLE'],
  ])('rejects an order outside the activation boundary', async (override, code) => {
    const tx = transactionMock(orderFixture(override));
    await expect(
      activateProductionOperationsInTx(
        tx as never,
        'order-1',
        { id: 'admin-1' },
        AT,
      ),
    ).rejects.toMatchObject({ code });
  });

  it('materializes a confirmed free rework without changing customer fees', async () => {
    const tx = transactionMock(
      orderFixture({
        kind: OrderKind.REWORK,
        settlementType: OrderSettlementType.NO_CHARGE,
      }),
    );

    await expect(
      activateProductionOperationsInTx(
        tx as never,
        'order-1',
        { id: 'admin-1' },
        AT,
      ),
    ).resolves.toMatchObject({
      orderStatus: OrderStatus.SCHEDULING,
      operationsCreated: 2,
      idempotentReplay: false,
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        status: OrderStatus.SCHEDULING,
        scheduledAt: AT,
        requiresOutsource: false,
      },
    });
  });

  it('物化活跃内制非计件工艺，跳过计件白名单与外协工艺', async () => {
    const tx = transactionMock(
      orderFixture({
        items: [
          {
            id: 'item-1',
            sequence: 1,
            craft: OrderCraft.FULL,
            quantity: 100,
            frontFoilColors: ['gold'],
            backFoilColors: [],
            hasLocalFoil: false,
            crafts: ['craft-full', 'craft-gluing', 'craft-uv'],
          },
        ],
      }),
      [
        {
          id: 'craft-full',
          code: 'FLAT_FOIL_SINGLE',
          name: '专版单色平烫',
          isActive: true,
          isOutsource: false,
        },
        {
          id: 'craft-gluing',
          code: 'GLUING',
          name: '粘封',
          isActive: true,
          isOutsource: false,
        },
        {
          id: 'craft-uv',
          code: 'UV',
          name: 'UV',
          isActive: true,
          isOutsource: true,
        },
      ],
    );

    await expect(
      activateProductionOperationsInTx(
        tx as never,
        'order-1',
        { id: 'admin-1' },
        AT,
      ),
    ).resolves.toMatchObject({
      progressStepIds: ['progress-1'],
      progressStepsCreated: 1,
    });
    expect(tx.productionProgressStep.create).toHaveBeenCalledWith({
      data: {
        orderId: 'order-1',
        orderItemId: 'item-1',
        craftId: 'craft-gluing',
        craftCode: 'GLUING',
        craftName: '粘封',
        status: ProductionOperationStatus.PENDING,
        plannedQty: '100',
      },
      select: { id: true },
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        status: OrderStatus.SCHEDULING,
        scheduledAt: AT,
        requiresOutsource: true,
      },
    });
  });

  it('历史已停用工艺拒绝自动物化', async () => {
    const tx = transactionMock(
      orderFixture({
        items: [
          {
            ...orderFixture().items[0],
            crafts: ['craft-retired'],
          },
        ],
      }),
      [
        {
          id: 'craft-retired',
          code: 'STOCK_FOIL',
          name: '现货加烫',
          isActive: false,
          isOutsource: false,
        },
      ],
    );

    await expect(
      activateProductionOperationsInTx(
        tx as never,
        'order-1',
        { id: 'admin-1' },
        AT,
      ),
    ).rejects.toMatchObject({ code: 'CRAFT_FACTS_INCOMPLETE' });
    expect(tx.productionOperation.create).not.toHaveBeenCalled();
    expect(tx.productionProgressStep.create).not.toHaveBeenCalled();
  });
});
