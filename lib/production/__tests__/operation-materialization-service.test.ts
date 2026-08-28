import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
  OrderCraft,
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
    status: OrderStatus.PENDING_FACTORY,
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    pricingStatus: OrderPricingStatus.AUTO_CONFIRMED,
    scheduledAt: null,
    items: [
      {
        id: 'item-1',
        sequence: 1,
        craft: OrderCraft.FULL,
        quantity: 100,
        frontFoilColors: ['gold'],
        backFoilColors: [],
        hasLocalFoil: false,
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

function transactionMock(order = orderFixture()) {
  let operationCounter = 0;
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
      data: { status: OrderStatus.SCHEDULING, scheduledAt: AT },
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
});
