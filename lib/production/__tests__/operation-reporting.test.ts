import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MachineType,
  OrderStatus,
  PieceworkOperationType,
  PieceworkRateUnit,
  ProductionOperationStatus,
  ProductionReportEntryType,
  Role,
  WorkerType,
} from '../../../generated/prisma/enums';

const { dbMock, databaseNowMock, completionMock } = vi.hoisted(() => ({
  databaseNowMock: vi.fn(),
  completionMock: vi.fn(),
  dbMock: {
    productionOperation: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    productionReport: {
      findUnique: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    pieceworkSettlement: { findUnique: vi.fn() },
    pieceworkPriceBook: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    order: { update: vi.fn() },
    orderLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseClockNow: databaseNowMock,
}));
vi.mock('@/lib/production-completion', () => ({
  maybeCompleteProductionOrder: completionMock,
}));

import {
  reportProductionOperation,
} from '../operation-reporting';

const NOW = new Date('2026-08-28T08:00:00.000Z');
const ACTOR = { id: 'worker-1', role: Role.WORKER };

function operationFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'operation-1',
    orderId: 'order-1',
    operationType: PieceworkOperationType.PARTIAL,
    unit: PieceworkRateUnit.PER_PASS,
    status: ProductionOperationStatus.PENDING,
    plannedQty: new Decimal(400),
    order: {
      id: 'order-1',
      orderNo: 'GD-1',
      status: OrderStatus.SCHEDULING,
    },
    sources: [
      {
        sourceType: 'ORDER_ITEM',
        sourceQty: new Decimal(400),
        orderItemId: 'item-1',
        packagingGroupId: null,
        orderItem: {
          id: 'item-1',
          sequence: 1,
          quantity: 200,
          frontFoilColors: ['gold'],
          backFoilColors: ['red'],
        },
        packagingGroup: null,
      },
    ],
    ...overrides,
  };
}

function accountFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTOR.id,
    role: Role.WORKER,
    isActive: true,
    workerType: WorkerType.MACHINE,
    machineType: MachineType.HAND_PRESS,
    employmentStartDate: null,
    employmentEndDate: null,
    ...overrides,
  };
}

function publishedBook(
  operationType = PieceworkOperationType.PARTIAL,
  unit = PieceworkRateUnit.PER_PASS,
) {
  return {
    id: 'book-1',
    version: 1,
    ruleSetSha256: 'a'.repeat(64),
    rules: [
      {
        operationType,
        unit,
        amount: new Decimal('0.0075'),
      },
    ],
  };
}

function arrangeOperation(operation = operationFixture()) {
  dbMock.productionOperation.findUnique.mockImplementation(
    async (args: { select?: Record<string, unknown> }) =>
      args.select && Object.keys(args.select).length === 2
        ? { id: 'operation-1', orderId: 'order-1' }
        : operation,
  );
}

beforeEach(() => {
  for (const delegate of [
    dbMock.productionOperation,
    dbMock.productionReport,
    dbMock.pieceworkSettlement,
    dbMock.pieceworkPriceBook,
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
  arrangeOperation();
  dbMock.user.findUnique.mockResolvedValue(accountFixture());
  dbMock.productionReport.findUnique.mockResolvedValue(null);
  dbMock.productionReport.aggregate.mockResolvedValue({
    _sum: {
      reportedCompletedQty: null,
      defectQty: null,
      reworkQty: null,
    },
  });
  dbMock.pieceworkSettlement.findUnique.mockResolvedValue(null);
  dbMock.pieceworkPriceBook.findMany.mockResolvedValue([publishedBook()]);
  dbMock.productionReport.create.mockResolvedValue({ id: 'report-1' });
  dbMock.productionOperation.update.mockResolvedValue({ id: 'operation-1' });
  dbMock.productionOperation.count.mockResolvedValue(1);
  dbMock.order.update.mockResolvedValue({ id: 'order-1' });
  dbMock.orderLog.create.mockResolvedValue({ id: 'log-1' });
});

function reportInput(overrides: Record<string, unknown> = {}) {
  return {
    operationId: 'operation-1',
    completedQty: 100,
    defectQty: 7,
    reworkQty: 3,
    idempotencyKey: 'scan-request-0001',
    ...overrides,
  };
}

describe('reportProductionOperation', () => {
  it('records completed pieces and excludes defect/rework from PARTIAL pay', async () => {
    await expect(
      reportProductionOperation(reportInput(), ACTOR),
    ).resolves.toMatchObject({
      reportId: 'report-1',
      amount: '1.50',
      completedAggregate: '100',
      operationStatus: ProductionOperationStatus.IN_PROGRESS,
    });

    expect(dbMock.productionReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reporterId: ACTOR.id,
        reportedCompletedQty: '100',
        defectQty: '7',
        reworkQty: '3',
        chargeableQty: '200',
        unit: PieceworkRateUnit.PER_PASS,
        rate: '0.0075',
        amount: '1.50',
        snapshot: expect.objectContaining({
          operation: expect.objectContaining({
            plannedCompletedPieces: '200',
            passCount: 2,
          }),
          payroll: expect.objectContaining({
            defectAndReworkExcluded: true,
          }),
        }),
      }),
      select: { id: true },
    });
    expect(dbMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: OrderStatus.IN_PRODUCTION },
      }),
    );
  });

  it.each([
    [
      PieceworkOperationType.PARTIAL,
      PieceworkRateUnit.PER_PASS,
      accountFixture({ machineType: MachineType.WINDMILL }),
    ],
    [
      PieceworkOperationType.FULL,
      PieceworkRateUnit.PER_PIECE,
      accountFixture({ machineType: MachineType.HAND_PRESS }),
    ],
    [
      PieceworkOperationType.PACKING,
      PieceworkRateUnit.PER_BAG,
      accountFixture({ workerType: WorkerType.MACHINE }),
    ],
  ])('rejects a fixed account that does not own %s', async (
    operationType,
    unit,
    account,
  ) => {
    arrangeOperation(
      operationFixture({ operationType, unit }),
    );
    dbMock.user.findUnique.mockResolvedValue(account);
    await expect(
      reportProductionOperation(reportInput(), ACTOR),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_AUTHORIZED',
    });
    expect(dbMock.productionReport.create).not.toHaveBeenCalled();
  });

  it('fails closed when no unique effective published rate exists', async () => {
    dbMock.pieceworkPriceBook.findMany.mockResolvedValue([]);
    await expect(
      reportProductionOperation(reportInput(), ACTOR),
    ).rejects.toMatchObject({
      code: 'PIECEWORK_RATE_UNAVAILABLE',
    });
    expect(dbMock.productionReport.create).not.toHaveBeenCalled();
  });

  it.each(['LOCKED', 'PAID'] as const)(
    'rejects a %s reporter/day settlement after taking the shared day lock',
    async (status) => {
      dbMock.pieceworkSettlement.findUnique.mockResolvedValue({ status });

      await expect(
        reportProductionOperation(reportInput(), ACTOR),
      ).rejects.toMatchObject({
        code: 'REPORTING_DAY_SETTLED',
        detail: {
          workDate: '2026-08-28',
          settlementStatus: status,
        },
      });

      expect(dbMock.$executeRaw).toHaveBeenCalledTimes(6);
      expect(dbMock.$executeRaw.mock.calls[3]?.[1]).toBe(
        'print-shop-erp:salary-identity:worker-1',
      );
      expect(dbMock.$executeRaw.mock.calls[4]?.[1]).toBe(
        'print-shop-erp:piecework-reporting-day:2026-08-28',
      );
      expect(dbMock.$executeRaw.mock.calls[5]?.[1]).toBe(
        'print-shop-erp:piecework-settlement:worker-1:2026-08-28',
      );
      expect(dbMock.$executeRaw.mock.invocationCallOrder[5]).toBeLessThan(
        dbMock.pieceworkSettlement.findUnique.mock.invocationCallOrder[0],
      );
      expect(dbMock.pieceworkPriceBook.findMany).not.toHaveBeenCalled();
      expect(dbMock.productionReport.create).not.toHaveBeenCalled();
    },
  );

  it('rejects aggregate completed pieces above plan under the operation lock', async () => {
    dbMock.productionReport.aggregate.mockResolvedValue({
      _sum: {
        reportedCompletedQty: new Decimal(195),
        defectQty: new Decimal(0),
        reworkQty: new Decimal(0),
      },
    });
    await expect(
      reportProductionOperation(
        reportInput({ completedQty: 6, defectQty: 0, reworkQty: 0 }),
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'OVER_REPORT',
    });
    expect(dbMock.productionReport.create).not.toHaveBeenCalled();
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(4);
  });

  it('rejects a piecework report outside the locked employment dates', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      accountFixture({
        employmentStartDate: new Date('2026-08-29T00:00:00.000Z'),
        employmentEndDate: new Date('2026-09-30T00:00:00.000Z'),
      }),
    );

    await expect(
      reportProductionOperation(reportInput(), ACTOR),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_AUTHORIZED',
      detail: { workDate: '2026-08-28' },
    });
    expect(dbMock.productionReport.create).not.toHaveBeenCalled();
  });

  it('moves a delayed pre-midnight transaction to the post-midnight open day', async () => {
    const beforeMidnight = new Date('2026-08-28T15:59:59.999Z');
    const afterMidnight = new Date('2026-08-28T16:00:00.000Z');
    databaseNowMock
      .mockReset()
      .mockResolvedValueOnce(beforeMidnight)
      .mockResolvedValue(afterMidnight);

    await reportProductionOperation(reportInput(), ACTOR);

    const lockKeys = dbMock.$executeRaw.mock.calls.map((call) => call[1]);
    expect(lockKeys).toContain(
      'print-shop-erp:piecework-reporting-day:2026-08-28',
    );
    expect(lockKeys).toContain(
      'print-shop-erp:piecework-reporting-day:2026-08-29',
    );
    expect(lockKeys.at(-1)).toBe(
      'print-shop-erp:piecework-settlement:worker-1:2026-08-29',
    );
    expect(dbMock.productionReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reportedAt: afterMidnight }),
      }),
    );
  });

  it('completes the operation and then the order when the last planned quantity lands', async () => {
    dbMock.productionReport.aggregate.mockResolvedValue({
      _sum: {
        reportedCompletedQty: new Decimal(100),
        defectQty: new Decimal(0),
        reworkQty: new Decimal(0),
      },
    });
    dbMock.productionOperation.count.mockResolvedValue(0);
    completionMock.mockResolvedValue({
      completed: true,
      blockedBy: null,
      uncoveredItems: [],
    });

    const result = await reportProductionOperation(
      reportInput({ completedQty: 100, defectQty: 0, reworkQty: 0 }),
      ACTOR,
    );
    expect(result.operationStatus).toBe(ProductionOperationStatus.COMPLETED);
    expect(result.orderStatus).toBe(OrderStatus.COMPLETED);
    expect(dbMock.order.update).toHaveBeenCalledOnce();
    expect(dbMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: OrderStatus.IN_PRODUCTION } }),
    );
    expect(completionMock).toHaveBeenCalledWith(
      dbMock,
      'order-1',
      ACTOR.id,
      NOW,
    );
  });

  it('serializes concurrent identical requests and inserts only once', async () => {
    let stored: null | Record<string, unknown> = null;
    let transactionTail = Promise.resolve();
    dbMock.$transaction.mockImplementation((callback) => {
      const run = transactionTail.then(() => callback(dbMock));
      transactionTail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    });
    dbMock.productionReport.findUnique.mockImplementation(async () => stored);
    dbMock.productionReport.create.mockImplementation(async ({ data }) => {
      stored = {
        id: 'report-concurrent',
        operationId: data.operationId,
        reporterId: data.reporterId,
        entryType: ProductionReportEntryType.REPORT,
        reportedCompletedQty: new Decimal(data.reportedCompletedQty),
        defectQty: new Decimal(data.defectQty),
        reworkQty: new Decimal(data.reworkQty),
        amount: new Decimal(data.amount),
        operation: {
          status: ProductionOperationStatus.IN_PROGRESS,
          orderId: 'order-1',
          order: { status: OrderStatus.IN_PRODUCTION },
        },
      };
      return { id: 'report-concurrent' };
    });

    const [first, second] = await Promise.all([
      reportProductionOperation(reportInput(), ACTOR),
      reportProductionOperation(reportInput(), ACTOR),
    ]);
    expect([first.idempotentReplay, second.idempotentReplay].sort()).toEqual([
      false,
      true,
    ]);
    expect(dbMock.productionReport.create).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of an idempotency key with changed quantities', async () => {
    dbMock.productionReport.findUnique.mockResolvedValue({
      id: 'existing',
      operationId: 'operation-1',
      reporterId: ACTOR.id,
      entryType: ProductionReportEntryType.REPORT,
      reportedCompletedQty: new Decimal(99),
      defectQty: new Decimal(7),
      reworkQty: new Decimal(3),
      amount: new Decimal('1.49'),
      operation: {
        status: ProductionOperationStatus.IN_PROGRESS,
        orderId: 'order-1',
        order: { status: OrderStatus.IN_PRODUCTION },
      },
    });
    await expect(
      reportProductionOperation(reportInput(), ACTOR),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
});
