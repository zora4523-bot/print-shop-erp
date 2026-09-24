import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderStatus,
  PieceworkOperationType,
  ProductionOperationStatus,
  Role,
  WorkerType,
} from '../../generated/prisma/enums';

const {
  dbMock,
  operationTypeMock,
  progressCraftIdsMock,
  listSettlementMock,
  getSettlementMock,
} = vi.hoisted(() => ({
  dbMock: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    order: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    dailyWorkerSalary: { count: vi.fn(), aggregate: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    hourlyWorkerPayroll: { findMany: vi.fn(), findFirst: vi.fn() },
  },
  operationTypeMock: vi.fn(),
  progressCraftIdsMock: vi.fn(),
  listSettlementMock: vi.fn(),
  getSettlementMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/production/operation-portal', () => ({
  getReporterOperationTypeOrNull: operationTypeMock,
  getProgressCraftIdsForReporter: progressCraftIdsMock,
}));
vi.mock('@/lib/salary/piecework-settlement', () => ({
  listWorkerPieceworkSettlements: listSettlementMock,
  getPieceworkSettlementDetail: getSettlementMock,
}));

import {
  getWorkerOrderDetail,
  getWorkerHourlyPayrollDetail,
  getWorkerPieceworkSettlementDetail,
  getWorkerSalaryDetail,
  listWorkerHourlyPayrolls,
  listWorkerOrders,
  listWorkerPieceworkSettlementsForPortal,
  listWorkerSalaries,
  WORKER_ORDER_PAGE_SIZE,
  WorkerPortalError,
} from '../worker-portal';

const worker = {
  id: 'worker-a',
  role: Role.WORKER,
  workerType: WorkerType.MACHINE,
};
const packer = {
  id: 'packer-a',
  role: Role.WORKER,
  workerType: WorkerType.PACKER,
};

beforeEach(() => {
  dbMock.$queryRaw
    .mockReset()
    .mockResolvedValueOnce([{ total: BigInt(0) }])
    .mockResolvedValueOnce([]);
  dbMock.$transaction
    .mockReset()
    .mockImplementation(async (callback: (tx: typeof dbMock) => unknown) =>
      callback(dbMock),
    );
  dbMock.order.findMany.mockReset().mockResolvedValue([]);
  dbMock.order.findFirst.mockReset().mockResolvedValue(null);
  dbMock.order.count.mockReset().mockResolvedValue(0);
  dbMock.dailyWorkerSalary.count.mockReset().mockResolvedValue(0);
  dbMock.dailyWorkerSalary.aggregate.mockReset().mockResolvedValue({ _sum: { actualSalary: null } });
  dbMock.dailyWorkerSalary.findMany.mockReset().mockResolvedValue([]);
  dbMock.dailyWorkerSalary.findFirst.mockReset().mockResolvedValue(null);
  dbMock.hourlyWorkerPayroll.findMany.mockReset().mockResolvedValue([]);
  dbMock.hourlyWorkerPayroll.findFirst.mockReset().mockResolvedValue(null);
  operationTypeMock
    .mockReset()
    .mockResolvedValue(PieceworkOperationType.PARTIAL);
  progressCraftIdsMock.mockReset().mockResolvedValue(['craft-emboss']);
  listSettlementMock.mockReset().mockResolvedValue([]);
  getSettlementMock.mockReset().mockResolvedValue(null);
});

describe('worker order visibility', () => {
  // 审计 L-8：工单页可见范围不变，但他车道进度只能看、不能点进报工（详情页按车道 404）。
  it('marks which current progress steps belong to the reporter\'s craft lane', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-1', workOrderVersion: 2, productionOperations: [],
      productionProgressSteps: [
        { id: 'emboss', workOrderVersion: 2, craftId: 'craft-emboss', status: ProductionOperationStatus.PENDING },
        { id: 'glue', workOrderVersion: 2, craftId: 'craft-glue', status: ProductionOperationStatus.PENDING },
      ],
    });
    await expect(getWorkerOrderDetail('order-1', worker)).resolves.toMatchObject({
      productionProgressSteps: [{ id: 'emboss', reportable: true }, { id: 'glue', reportable: false }],
    });
    expect(progressCraftIdsMock).toHaveBeenCalledWith(worker);
    expect(dbMock.order.findFirst.mock.calls[0][0].select.productionProgressSteps.select).toMatchObject({ craftId: true });
  });

  it('shows the account lane plus shared no-pay progress without personnel matching', async () => {
    dbMock.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ total: BigInt(1) }])
      .mockResolvedValueOnce([{ id: 'order-1' }]);
    dbMock.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        orderNo: '20260719-0001',
        customName: null,
        status: OrderStatus.IN_PRODUCTION,
        isUrgent: false,
        customerRef: null,
        promisedDate: null,
        createdAt: new Date(),
        workOrderVersion: 3,
        submitter: { displayName: '销售 A' },
        productionOperations: [
          {
            id: 'operation-v2',
            workOrderVersion: 2,
            status: ProductionOperationStatus.COMPLETED,
            reports: [{ amount: '999' }],
          },
          {
            id: 'operation-1',
            workOrderVersion: 3,
            status: ProductionOperationStatus.COMPLETED,
            reports: [{ amount: '12' }],
          },
        ],
        productionProgressSteps: [
          {
            id: 'progress-v2',
            workOrderVersion: 2,
            status: ProductionOperationStatus.COMPLETED,
          },
          {
            id: 'progress-1',
            workOrderVersion: 3,
            status: ProductionOperationStatus.PENDING,
          },
        ],
      },
    ]);
    const result = await listWorkerOrders(worker);
    const query = dbMock.order.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ id: { in: ['order-1'] } });
    expect(query.select.productionOperations.where).toEqual({
      operationType: PieceworkOperationType.PARTIAL,
    });
    expect(query.select.productionOperations.select.reports.where).toEqual({
      reporterId: 'worker-a',
    });
    expect(query.select.productionProgressSteps.where).toBeUndefined();
    expect(result.rows[0]).toMatchObject({
      operationCount: 2,
      completedOperationCount: 1,
      pieceworkAmount: '12.00',
    });
    const visibilitySql = dbMock.$queryRaw.mock.calls[0][0];
    expect(visibilitySql.strings.join('')).toContain(
      'operation."workOrderVersion" = current_order."workOrderVersion"',
    );
    expect(visibilitySql.strings.join('')).toContain(
      'progress."workOrderVersion" = current_order."workOrderVersion"',
    );
  });

  it('uses id plus lane-or-shared-progress in the detail query', async () => {
    await expect(getWorkerOrderDetail('order-other', worker)).resolves.toBeNull();
    expect(dbMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'order-other',
          status: { not: OrderStatus.SUBMITTED },
          OR: [
            {
              productionOperations: {
                some: { operationType: PieceworkOperationType.PARTIAL },
              },
            },
            { productionProgressSteps: { some: {} } },
          ],
        },
      }),
    );
    const detailQuery = dbMock.order.findFirst.mock.calls[0][0];
    expect(detailQuery.select.productionOperations.where).toEqual({
      operationType: PieceworkOperationType.PARTIAL,
    });
    expect(detailQuery.select.items.select.designs.where).toEqual({
      fileType: 'IMAGE',
    });
    expect(detailQuery.select.productionProgressSteps.where).toBeUndefined();
    expect(detailQuery.select.productionOperations.select.sources.select).toMatchObject({
      orderItem: { select: { sequence: true, name: true, frontFoilColors: true, backFoilColors: true } },
      packagingGroup: { select: {
        sequence: true,
        name: true,
        lines: { select: { unitsPerBag: true, orderItem: { select: { sequence: true, name: true } } } },
      } },
    });
  });

  it('详情只返回当前工单代次，仅有历史代次时拒绝可见', async () => {
    dbMock.order.findFirst
      .mockResolvedValueOnce({
        id: 'order-1',
        workOrderVersion: 3,
        productionOperations: [
          { id: 'operation-v2', workOrderVersion: 2 },
          { id: 'operation-v3', workOrderVersion: 3 },
        ],
        productionProgressSteps: [
          { id: 'progress-v2', workOrderVersion: 2 },
        ],
      })
      .mockResolvedValueOnce({
        id: 'order-2',
        workOrderVersion: 4,
        productionOperations: [
          { id: 'operation-v3', workOrderVersion: 3 },
        ],
        productionProgressSteps: [],
      });

    await expect(getWorkerOrderDetail('order-1', worker)).resolves.toMatchObject({
      productionOperations: [{ id: 'operation-v3', workOrderVersion: 3 }],
      productionProgressSteps: [],
    });
    await expect(getWorkerOrderDetail('order-2', worker)).resolves.toBeNull();
  });

  it('lets an active worker without a paid lane see only shared progress orders', async () => {
    operationTypeMock.mockResolvedValue(null);

    await listWorkerOrders({
      id: 'cleaner-a',
      role: Role.WORKER,
    });

    const visibilitySql = dbMock.$queryRaw.mock.calls[0][0];
    expect(visibilitySql.strings.join('')).toContain('FALSE');
    expect(visibilitySql.strings.join('')).toContain(
      'FROM "ProductionProgressStep" AS progress',
    );
  });

  it('当前版已取消任务不再成为扫码选择项', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-1', workOrderVersion: 3,
      productionOperations: [
        { id: 'pack-cancelled', workOrderVersion: 3, status: ProductionOperationStatus.CANCELLED },
        { id: 'pack-current', workOrderVersion: 3, status: ProductionOperationStatus.PENDING },
      ],
      productionProgressSteps: [
        { id: 'progress-cancelled', workOrderVersion: 3, status: ProductionOperationStatus.CANCELLED },
      ],
    });
    await expect(getWorkerOrderDetail('order-1', packer)).resolves.toMatchObject({
      productionOperations: [{ id: 'pack-current' }], productionProgressSteps: [],
    });
  });
});

describe('worker order list pagination', () => {
  it('bounds the first page instead of streaming the whole history', async () => {
    dbMock.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ total: BigInt(500) }])
      .mockResolvedValueOnce([]);

    const result = await listWorkerOrders(worker);
    const pageSql = dbMock.$queryRaw.mock.calls[1][0];

    expect(pageSql.values.slice(-2)).toEqual([0, WORKER_ORDER_PAGE_SIZE]);
    expect(result.total).toBe(500);
    expect(result.page).toBe(1);
    expect(result.pageCount).toBe(500 / WORKER_ORDER_PAGE_SIZE);
  });

  it('puts the newest orders first with a stable id tiebreaker', async () => {
    await listWorkerOrders(worker);

    const pageSql = dbMock.$queryRaw.mock.calls[1][0];
    expect(pageSql.strings.join('')).toContain(
      'ORDER BY current_order."createdAt" DESC, current_order."id" DESC',
    );
  });

  it('counts with exactly the same ownership predicate as the row query', async () => {
    await listWorkerOrders(worker);

    const countSql = dbMock.$queryRaw.mock.calls[0][0];
    const pageSql = dbMock.$queryRaw.mock.calls[1][0];
    for (const query of [countSql, pageSql]) {
      expect(query.strings.join('')).toContain(
        'operation."workOrderVersion" = current_order."workOrderVersion"',
      );
      expect(query.strings.join('')).toContain(
        'progress."workOrderVersion" = current_order."workOrderVersion"',
      );
      expect(query.values).toContain(PieceworkOperationType.PARTIAL);
    }
  });

  it('skips to the requested page', async () => {
    dbMock.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ total: BigInt(500) }])
      .mockResolvedValueOnce([]);

    const result = await listWorkerOrders(worker, { page: 3 });

    const pageSql = dbMock.$queryRaw.mock.calls[1][0];
    expect(pageSql.values.slice(-2)).toEqual([
      WORKER_ORDER_PAGE_SIZE * 2,
      WORKER_ORDER_PAGE_SIZE,
    ]);
    expect(result.page).toBe(3);
  });

  it('clamps a hand-typed out-of-range page to the last page', async () => {
    dbMock.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([
        { total: BigInt(WORKER_ORDER_PAGE_SIZE + 5) },
      ])
      .mockResolvedValueOnce([]);

    const result = await listWorkerOrders(worker, { page: 999 });

    expect(result.page).toBe(2);
    expect(result.pageCount).toBe(2);
    const pageSql = dbMock.$queryRaw.mock.calls[1][0];
    expect(pageSql.values.slice(-2)).toEqual([
      WORKER_ORDER_PAGE_SIZE,
      WORKER_ORDER_PAGE_SIZE,
    ]);
  });

  it('rejects non-worker actors before counting or reading orders', async () => {
    await expect(
      listWorkerOrders({ id: 'owner-1', role: Role.ADMIN }),
    ).rejects.toBeInstanceOf(WorkerPortalError);
    expect(dbMock.$queryRaw).not.toHaveBeenCalled();
    expect(dbMock.order.findMany).not.toHaveBeenCalled();
  });
});

describe('worker salary visibility', () => {
  it.each([worker, packer])(
    'scopes new operation-settlement reads to $id',
    async (actor) => {
      await listWorkerPieceworkSettlementsForPortal(actor, {
        from: new Date('2026-08-01T00:00:00.000Z'),
      });
      await getWorkerPieceworkSettlementDetail('settlement-1', actor);

      expect(listSettlementMock).toHaveBeenCalledWith(
        expect.objectContaining({ reporterId: actor.id }),
      );
      expect(getSettlementMock).toHaveBeenCalledWith(
        'settlement-1',
        actor,
      );
    },
  );

  it('rejects workers without a worker type before querying the new ledger', async () => {
    await expect(
      listWorkerPieceworkSettlementsForPortal({
        id: 'untyped-1',
        role: Role.WORKER,
        workerType: null,
      }),
    ).rejects.toBeInstanceOf(WorkerPortalError);
    expect(listSettlementMock).not.toHaveBeenCalled();
  });

  it('lists daily salaries only for the current machine worker', async () => {
    await listWorkerSalaries(worker);
    expect(dbMock.dailyWorkerSalary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workerId: 'worker-a' } }),
    );
  });

  it('puts workerId in the salary detail database predicate', async () => {
    await expect(getWorkerSalaryDetail('salary-other', worker)).resolves.toBeNull();
    expect(dbMock.dailyWorkerSalary.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'salary-other', workerId: 'worker-a' },
      }),
    );
  });

  it('lists only the current packer archived monthly payrolls', async () => {
    await listWorkerHourlyPayrolls(
      { id: 'hourly-a', role: Role.WORKER, workerType: WorkerType.PACKER },
      { fromMonth: '2026-01', toMonth: '2026-06' },
    );

    expect(dbMock.hourlyWorkerPayroll.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workerId: 'hourly-a',
          month: { gte: '2026-01', lte: '2026-06' },
        },
      }),
    );
  });

  it('puts workerId in the hourly payroll detail database predicate', async () => {
    await expect(
      getWorkerHourlyPayrollDetail('payroll-other', packer),
    ).resolves.toBeNull();
    expect(dbMock.hourlyWorkerPayroll.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payroll-other', workerId: 'packer-a' },
      }),
    );
  });

  it('uses each owned payroll snapshot for historical worker-type display', async () => {
    dbMock.hourlyWorkerPayroll.findMany.mockResolvedValue([
      {
        id: 'payroll-1',
        salaryRuleSnapshot: { workerType: WorkerType.PACKER },
      },
    ]);
    dbMock.hourlyWorkerPayroll.findFirst.mockResolvedValue({
      id: 'payroll-1',
      salaryRuleSnapshot: { workerType: WorkerType.PACKER },
    });
    const list = await listWorkerHourlyPayrolls(packer);
    const detail = await getWorkerHourlyPayrollDetail('payroll-1', packer);

    expect(list[0].payrollWorkerType).toBe(WorkerType.PACKER);
    expect(detail?.payrollWorkerType).toBe(WorkerType.PACKER);
    expect(
      dbMock.hourlyWorkerPayroll.findMany.mock.calls[0][0].select
        .salaryRuleSnapshot,
    ).toBe(true);
    expect(
      dbMock.hourlyWorkerPayroll.findFirst.mock.calls[0][0].select
        .salaryRuleSnapshot,
    ).toBe(true);
  });

  it('keeps machine and hourly salary stores separated by worker type', async () => {
    await expect(listWorkerSalaries(packer)).rejects.toBeInstanceOf(
      WorkerPortalError,
    );
    await expect(listWorkerHourlyPayrolls(worker)).rejects.toBeInstanceOf(
      WorkerPortalError,
    );
    expect(dbMock.dailyWorkerSalary.findMany).not.toHaveBeenCalled();
    expect(dbMock.hourlyWorkerPayroll.findMany).not.toHaveBeenCalled();
  });

  it('rejects non-worker actors before querying any personal data', async () => {
    await expect(
      listWorkerSalaries({
        id: 'owner-1',
        role: Role.ADMIN,
        workerType: null,
      }),
    ).rejects.toBeInstanceOf(WorkerPortalError);
    await expect(
      listWorkerHourlyPayrolls({
        id: 'sales-1',
        role: Role.SALES,
        workerType: null,
      }),
    ).rejects.toBeInstanceOf(WorkerPortalError);
    expect(dbMock.dailyWorkerSalary.findMany).not.toHaveBeenCalled();
    expect(dbMock.hourlyWorkerPayroll.findMany).not.toHaveBeenCalled();
  });
});

it('keeps total/unpaid as filtered full aggregates after salary pagination, never the visible page', async () => {
  dbMock.dailyWorkerSalary.count.mockResolvedValue(45);
  dbMock.dailyWorkerSalary.findMany.mockResolvedValue([{ id: 'one-page-row', actualSalary: '1.23' }]);
  dbMock.dailyWorkerSalary.aggregate
    .mockResolvedValueOnce({ _sum: { actualSalary: '9876.54' } })
    .mockResolvedValueOnce({ _sum: { actualSalary: '1234.56' } });
  const from = new Date('2026-01-01');
  const result = await listWorkerSalaries(worker, { page: '2', from });
  expect(result).toMatchObject({ total: 45, page: 2, pageSize: 20, totalSalary: '9876.54', unpaidSalary: '1234.56' });
  expect(result.rows).toHaveLength(1);
  expect(dbMock.dailyWorkerSalary.findMany).toHaveBeenCalledWith(expect.objectContaining({
    take: 20, skip: 20, where: { workerId: worker.id, date: { gte: from, lte: undefined } },
  }));
  const where = { workerId: worker.id, date: { gte: from, lte: undefined } };
  expect(dbMock.dailyWorkerSalary.aggregate.mock.calls.map(([args]) => args)).toEqual([
    { where, _sum: { actualSalary: true } },
    { where: { AND: [where, { isPaid: false }] }, _sum: { actualSalary: true } },
  ]);
});
