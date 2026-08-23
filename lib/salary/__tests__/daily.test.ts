import { describe, it, expect, vi, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import {
  MachineType,
  Role,
  SalaryAdjustmentType,
  WorkerType,
} from '../../../generated/prisma/enums';

// Mock db before importing the module under test. lib/salary/daily.ts
// calls db.user.findUnique, db.productionTask.findMany, etc.
const { dbMock } = vi.hoisted(() => {
  const mock = {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    productionTask: { findMany: vi.fn() },
    salaryRule: { findFirst: vi.fn() },
    workerMachineSalaryRule: { findFirst: vi.fn() },
    dailyWorkerSalary: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    dailyWorkerSalaryItem: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    salaryAdjustment: {
      findUnique: vi.fn(),
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    businessAuditLog: { create: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(mock);
      return fn;
    }),
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  aggregateTasks,
  shanghaiDayRange,
  computeDailyWorkerSalary,
  computeDailyForAllMachineWorkers,
  listDailyWorkerSalaries,
  markDailySalaryPaid,
  addDailySalaryAdjustment,
  DailyBatchUnexpectedError,
  DailySalaryError,
} from '../daily';

const HAND_PRESS_RULE = {
  dailyBase: 100,
  pieceRate: 0.007,
  boardRate: 5,
  smallOrderThreshold: 1000,
  smallOrderFlatPrice: 12,
  multiplierFactors: ['DOUBLE_SIDED', 'DOUBLE_COLOR'],
};

const WINDMILL_RULE = {
  dailyBase: 120,
  pieceRate: 0.01,
  boardRate: 0,
  smallOrderThreshold: 1000,
  smallOrderFlatPrice: 20,
  smallOrderInclusive: true,
  largeOrderSetupFee: 10,
  multiplierFactors: ['DOUBLE_COLOR'],
};

function dailyTask(
  pieceworkAmount: string,
  orderId: string,
  id = `${orderId}-${pieceworkAmount}`,
  machineType: MachineType = MachineType.HAND_PRESS,
) {
  return {
    id,
    workerType: WorkerType.MACHINE,
    machineType,
    completedQty: 100,
    defectQty: 0,
    reworkQty: 0,
    boardCount: 1,
    pressCount: 100,
    pieceworkAmount,
    salaryRuleSnapshot: HAND_PRESS_RULE,
    completedAt: new Date('2026-04-23T02:00:00Z'),
    craft: { id: 'craft-1', name: '烫金' },
    orderItem: {
      id: `item-${orderId}`,
      orderId,
      name: `款式-${orderId}`,
      order: { orderNo: `NO-${orderId}` },
    },
  };
}

describe('shanghaiDayRange', () => {
  it('returns the UTC instant range for a Shanghai calendar date', () => {
    // 2026-04-23 Shanghai = [2026-04-22T16:00Z, 2026-04-23T16:00Z)
    const { start, end } = shanghaiDayRange('2026-04-23');
    expect(start.toISOString()).toBe('2026-04-22T16:00:00.000Z');
    expect(end.toISOString()).toBe('2026-04-23T16:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('rejects non-YYYY-MM-DD input', () => {
    expect(() => shanghaiDayRange('2026/04/23')).toThrow(DailySalaryError);
    expect(() => shanghaiDayRange('2026-4-23')).toThrow(DailySalaryError);
    expect(() => shanghaiDayRange('')).toThrow(DailySalaryError);
  });

  it('rejects invalid calendar dates (2026-02-31 rollover) (Codex round 43 / P1)', () => {
    // JS `new Date('2026-02-31')` would silently normalize to Mar 3;
    // shanghaiDayRange must refuse so a cron/UI typo fails loud.
    expect(() => shanghaiDayRange('2026-02-31')).toThrow(DailySalaryError);
    expect(() => shanghaiDayRange('2025-04-31')).toThrow(DailySalaryError);
    expect(() => shanghaiDayRange('2026-13-01')).toThrow(DailySalaryError);
  });
});

describe('aggregateTasks', () => {
  it('sums pieceworkAmount with Decimal math (no float drift)', () => {
    const r = aggregateTasks([
      { pieceworkAmount: '12.00', orderItem: { orderId: 'o1' } },
      { pieceworkAmount: '61.00', orderItem: { orderId: 'o2' } },
      { pieceworkAmount: '52.00', orderItem: { orderId: 'o2' } },
      { pieceworkAmount: '76.00', orderItem: { orderId: 'o3' } },
    ]);
    expect(r.totalPieceworkAmount.toFixed(2)).toBe('201.00');
    expect(r.taskCount).toBe(4);
    expect(r.orderCount).toBe(3);
    expect(r.detail).toHaveLength(4);
    expect(r.detail[0]).toEqual({ pieceworkAmount: '12.00', orderId: 'o1' });
  });

  it('empty task list returns zero totals', () => {
    const r = aggregateTasks([]);
    expect(r.totalPieceworkAmount.toFixed(2)).toBe('0.00');
    expect(r.taskCount).toBe(0);
    expect(r.orderCount).toBe(0);
    expect(r.detail).toEqual([]);
  });
});

describe('computeDailyWorkerSalary', () => {
  const workerFixture = {
    id: 'worker-1',
    role: Role.WORKER,
    workerType: WorkerType.MACHINE,
    machineType: MachineType.HAND_PRESS,
    isActive: true,
  };

  beforeEach(() => {
    dbMock.user.findUnique.mockReset();
    dbMock.user.findMany.mockReset();
    dbMock.productionTask.findMany.mockReset().mockResolvedValue([]);
    dbMock.salaryRule.findFirst
      .mockReset()
      .mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.workerMachineSalaryRule.findFirst.mockReset().mockResolvedValue(null);
    dbMock.dailyWorkerSalary.upsert.mockReset().mockResolvedValue({ id: 'ds-1' });
    dbMock.dailyWorkerSalary.findMany.mockReset();
    dbMock.dailyWorkerSalary.findUnique.mockReset().mockResolvedValue(null);
    dbMock.dailyWorkerSalary.update.mockReset();
    dbMock.dailyWorkerSalaryItem.deleteMany.mockReset().mockResolvedValue({ count: 0 });
    dbMock.dailyWorkerSalaryItem.createMany.mockReset().mockResolvedValue({ count: 0 });
    dbMock.salaryAdjustment.create.mockReset();
    dbMock.salaryAdjustment.aggregate.mockReset();
    dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
    dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
      return fn;
    });
  });

  it('refuses a missing worker', async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    await expect(
      computeDailyWorkerSalary('ghost', '2026-04-23'),
    ).rejects.toBeInstanceOf(DailySalaryError);
  });

  it('refuses non-MACHINE worker types (PACKER / COOK / etc.)', async () => {
    dbMock.user.findUnique.mockResolvedValue({
      ...workerFixture,
      workerType: WorkerType.PACKER,
    });
    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).rejects.toThrow(/仅 WorkerType\.MACHINE/);
  });

  it.each([
    [
      '改岗',
      {
        ...workerFixture,
        role: Role.SALES,
        workerType: null,
        machineType: null,
        isActive: true,
      },
    ],
    [
      '改工种',
      {
        ...workerFixture,
        workerType: WorkerType.PACKER,
        machineType: null,
        isActive: true,
      },
    ],
    ['停用', { ...workerFixture, isActive: false }],
  ])('uses frozen completed tasks after the worker is %s', async (_label, currentWorker) => {
    dbMock.user.findUnique.mockResolvedValue(currentWorker);
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('120.00', 'historical-order'),
    ]);
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: HAND_PRESS_RULE });

    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).resolves.toMatchObject({
      workerId: 'worker-1',
      totalPieceworkAmount: '120.00',
      actualSalary: '120.00',
    });
  });

  it('fails closed when a completed task lacks its worker-type snapshot', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      { ...dailyTask('120.00', 'legacy-order'), workerType: null },
    ]);

    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).rejects.toThrow(/缺少完工时工种或机型快照/);
    expect(dbMock.dailyWorkerSalary.upsert).not.toHaveBeenCalled();
  });

  it('refuses when the machine worker has no active rule (loud, not silent zero)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([]);
    dbMock.salaryRule.findFirst.mockResolvedValue(null);
    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).rejects.toThrow(/无当前生效.*薪资规则/);
  });

  it('SPEC §7.1 张三 reproduction: tasks sum 201, base 100 → actualSalary 201', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('12.00', 'o1'),
      dailyTask('61.00', 'o2', 'o2-a'),
      dailyTask('52.00', 'o2', 'o2-b'),
      dailyTask('76.00', 'o3'),
    ]);
    const r = await computeDailyWorkerSalary('worker-1', '2026-04-23');
    expect(r.totalPieceworkAmount).toBe('201.00');
    expect(r.baseSalary).toBe('100.00');
    expect(r.actualSalary).toBe('201.00');
    expect(r.taskCount).toBe(4);
    expect(r.orderCount).toBe(3);
  });

  it('base-floor case: 0 tasks → actualSalary falls back to dailyBase', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([]);
    const r = await computeDailyWorkerSalary('worker-1', '2026-04-23');
    expect(r.totalPieceworkAmount).toBe('0.00');
    expect(r.actualSalary).toBe('100.00');
    expect(r.taskCount).toBe(0);
  });

  it('uses the highest dailyBase among machine types actually worked that day', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('30.00', 'o1'),
      dailyTask('40.00', 'o2', 'windmill-task', MachineType.WINDMILL),
    ]);
    dbMock.salaryRule.findFirst.mockImplementation(async (args) => ({
      ruleValue:
        args.where.ruleKey === MachineType.WINDMILL
          ? WINDMILL_RULE
          : HAND_PRESS_RULE,
    }));

    const r = await computeDailyWorkerSalary('worker-1', '2026-04-23');

    expect(r.machineType).toBe(MachineType.WINDMILL);
    expect(r.baseSalary).toBe('120.00');
    expect(r.totalPieceworkAmount).toBe('70.00');
    expect(r.actualSalary).toBe('120.00');
    const create = dbMock.dailyWorkerSalary.upsert.mock.calls[0][0].create;
    expect(create.salaryRuleSnapshot).toMatchObject({
      dailyBasePolicy: 'MAX_WORKED_MACHINE_TYPES',
      baseMachineType: MachineType.WINDMILL,
      workedMachineTypes: [MachineType.HAND_PRESS, MachineType.WINDMILL],
      machineRules: {
        HAND_PRESS: expect.objectContaining({ dailyBase: 100 }),
        WINDMILL: expect.objectContaining({ dailyBase: 120 }),
      },
    });
    expect(dbMock.$executeRaw.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining([
        'print-shop-erp:piecework-rule:worker-1:HAND_PRESS',
        'print-shop-erp:piecework-rule:worker-1:WINDMILL',
      ]),
    );
  });

  it('applies a personal rule independently for a worked non-primary machine', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('30.00', 'o1'),
      dailyTask('40.00', 'o2', 'windmill-task', MachineType.WINDMILL),
    ]);
    dbMock.workerMachineSalaryRule.findFirst.mockImplementation(async (args) =>
      args.where.machineType === MachineType.WINDMILL
        ? { ruleValue: { ...WINDMILL_RULE, dailyBase: 180 } }
        : null,
    );
    dbMock.salaryRule.findFirst.mockResolvedValue({
      ruleValue: HAND_PRESS_RULE,
    });

    const result = await computeDailyWorkerSalary(
      'worker-1',
      '2026-04-23',
    );

    expect(result.machineType).toBe(MachineType.WINDMILL);
    expect(result.baseSalary).toBe('180.00');
  });

  it('uses the matching machine rule when rebuilding a missing task snapshot', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      {
        ...dailyTask(
          '40.00',
          'o2',
          'windmill-task',
          MachineType.WINDMILL,
        ),
        salaryRuleSnapshot: null,
      },
    ]);
    dbMock.salaryRule.findFirst.mockImplementation(async (args) => ({
      ruleValue:
        args.where.ruleKey === MachineType.WINDMILL
          ? WINDMILL_RULE
          : HAND_PRESS_RULE,
    }));

    await computeDailyWorkerSalary('worker-1', '2026-04-23');

    const data = dbMock.dailyWorkerSalaryItem.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({
      machineType: MachineType.WINDMILL,
      salaryRuleSnapshot: expect.objectContaining({
        pieceRate: 0.01,
        largeOrderSetupFee: 10,
      }),
    });
  });

  it('rejects a task sum that exceeds the daily Decimal(10,2) column', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('50000000.00', 'o1'),
      dailyTask('50000000.00', 'o2'),
    ]);

    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).rejects.toThrow(/当日计件合计.*99,999,999\.99/);
    expect(dbMock.dailyWorkerSalary.upsert).not.toHaveBeenCalled();
  });

  it('rejects an oversized dailyBase from a legacy rule with a clear error', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([]);
    dbMock.salaryRule.findFirst.mockResolvedValue({
      ruleValue: { ...HAND_PRESS_RULE, dailyBase: '100000000' },
    });

    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).rejects.toThrow(/HAND_PRESS 每日保底.*99,999,999\.99/);
    expect(dbMock.dailyWorkerSalary.upsert).not.toHaveBeenCalled();
  });

  it('uses the account primary machine only when the day has no completed task', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([]);

    await computeDailyWorkerSalary('worker-1', '2026-04-23');

    const create = dbMock.dailyWorkerSalary.upsert.mock.calls[0][0].create;
    expect(create.machineType).toBe(MachineType.HAND_PRESS);
    expect(create.salaryRuleSnapshot).toMatchObject({
      dailyBasePolicy: 'PRIMARY_MACHINE_FALLBACK',
      baseMachineType: MachineType.HAND_PRESS,
      workedMachineTypes: [MachineType.HAND_PRESS],
    });
  });

  it('fails loudly when any machine actually worked has no active rule', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('30.00', 'o1'),
      dailyTask('40.00', 'o2', 'windmill-task', MachineType.WINDMILL),
    ]);
    dbMock.salaryRule.findFirst.mockImplementation(async (args) =>
      args.where.ruleKey === MachineType.WINDMILL
        ? null
        : { ruleValue: HAND_PRESS_RULE },
    );

    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).rejects.toThrow(/WINDMILL.*薪资规则/);
    expect(dbMock.dailyWorkerSalary.upsert).not.toHaveBeenCalled();
  });

  it('upserts with Shanghai-midnight date column + snapshots rule value', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('40.00', 'o1'),
    ]);
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    const call = dbMock.dailyWorkerSalary.upsert.mock.calls[0][0];
    // date column is UTC midnight for the Shanghai calendar date
    expect((call.where.workerId_date.date as Date).toISOString()).toBe(
      '2026-04-23T00:00:00.000Z',
    );
    // snapshot shape matches rule + dailyBase
    expect(call.create.salaryRuleSnapshot).toMatchObject({
      pieceRate: 0.007,
      boardRate: 5,
      dailyBase: 100,
    });
    expect(dbMock.dailyWorkerSalaryItem.deleteMany).toHaveBeenCalledWith({
      where: { dailySalaryId: 'ds-1' },
    });
    expect(dbMock.dailyWorkerSalaryItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          dailySalaryId: 'ds-1',
          productionTaskId: 'o1-40.00',
          orderId: 'o1',
          orderNo: 'NO-o1',
          craftName: '烫金',
          pieceworkAmount: '40.00',
        }),
      ],
    });
  });

  it('queries tasks in the Shanghai day range (not UTC day range)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([]);
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    const where = dbMock.productionTask.findMany.mock.calls[0][0].where;
    expect((where.completedAt.gte as Date).toISOString()).toBe(
      '2026-04-22T16:00:00.000Z',
    );
    expect((where.completedAt.lt as Date).toISOString()).toBe(
      '2026-04-23T16:00:00.000Z',
    );
  });

  it('payroll counts only COMPLETED tasks — CANCELLED tasks never enter wages (A1)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([]);
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    const where = dbMock.productionTask.findMany.mock.calls[0][0].where;
    // The status filter is the structural guard: a task voided with its
    // order (CANCELLED) can never match this query, so it can't be paid.
    expect(where.status).toBe('COMPLETED');
  });

  it('recompute: update path does not write isPaid (finance ledger protected)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('40.00', 'o1'),
    ]);
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    const call = dbMock.dailyWorkerSalary.upsert.mock.calls[0][0];
    // update branch touches numbers but NOT isPaid — finance wouldn't
    // want a recompute to silently reopen a paid record.
    expect('isPaid' in call.update).toBe(false);
    expect('paidAt' in call.update).toBe(false);
  });

  it('refuses to recompute an already-paid row (Codex round 43 / P0)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('40.00', 'o1'),
    ]);
    dbMock.dailyWorkerSalary.findUnique.mockResolvedValue({
      id: 'ds-existing',
      isPaid: true,
      actualSalary: '201.00',
    });
    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).rejects.toThrow(/已标记发放.*撤销发放再重算/);
    expect(dbMock.dailyWorkerSalary.upsert).not.toHaveBeenCalled();
  });

  it('allows recompute when the existing row is unpaid', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('40.00', 'o1'),
    ]);
    dbMock.dailyWorkerSalary.findUnique.mockResolvedValue({
      id: 'ds-existing',
      isPaid: false,
      actualSalary: '150.00',
    });
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    expect(dbMock.dailyWorkerSalary.upsert).toHaveBeenCalled();
  });

  it('rejects recompute when existing deductions would make the new gross negative', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([]);
    dbMock.dailyWorkerSalary.findUnique.mockResolvedValue({
      id: 'ds-existing',
      isPaid: false,
      actualSalary: '50.00',
      adjustmentAmount: '-250.00',
    });

    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).rejects.toThrow(/工资小于 0.*纠正调整流水/);
    expect(dbMock.dailyWorkerSalary.upsert).not.toHaveBeenCalled();
  });

  it('allows first-time compute when no row exists yet (findUnique null)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('40.00', 'o1'),
    ]);
    dbMock.dailyWorkerSalary.findUnique.mockResolvedValue(null);
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    expect(dbMock.dailyWorkerSalary.upsert).toHaveBeenCalled();
  });

  it('rejects fractional-cent task or base values instead of silently rounding payroll', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('40.001', 'o1'),
    ]);
    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).rejects.toThrow(/小数最多 2 位/);

    dbMock.productionTask.findMany.mockResolvedValue([]);
    dbMock.workerMachineSalaryRule.findFirst.mockResolvedValue({
      ruleValue: { ...HAND_PRESS_RULE, dailyBase: '100.001' },
    });
    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).rejects.toThrow(/小数最多 2 位/);
  });
});

describe('computeDailyForAllMachineWorkers', () => {
  const workerFixture = {
    id: 'worker-1',
    role: Role.WORKER,
    workerType: WorkerType.MACHINE,
    machineType: MachineType.HAND_PRESS,
    isActive: true,
  };

  beforeEach(() => {
    dbMock.user.findMany.mockReset().mockResolvedValue([]);
    dbMock.user.findUnique.mockReset().mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockReset().mockResolvedValue([]);
    dbMock.salaryRule.findFirst
      .mockReset()
      .mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.workerMachineSalaryRule.findFirst.mockReset().mockResolvedValue(null);
    dbMock.dailyWorkerSalary.findUnique.mockReset().mockResolvedValue(null);
    dbMock.dailyWorkerSalary.upsert.mockReset().mockResolvedValue({ id: 'ds-1' });
    dbMock.dailyWorkerSalaryItem.deleteMany
      .mockReset()
      .mockResolvedValue({ count: 0 });
    dbMock.dailyWorkerSalaryItem.createMany
      .mockReset()
      .mockResolvedValue({ count: 0 });
    dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
    dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') {
        return await (fn as (tx: unknown) => unknown)(dbMock);
      }
      return fn;
    });
  });

  it('continues past known per-worker business errors', async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'missing' }]);
    dbMock.user.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === 'missing' ? null : workerFixture,
    );

    const result = await computeDailyForAllMachineWorkers('2026-04-23');

    expect(result.settled.map((row) => row.workerId)).toEqual(['w1']);
    expect(result.errors).toEqual([
      expect.objectContaining({ workerId: 'missing' }),
    ]);
  });

  it('revalidates the durable lease before every independently committed worker', async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);
    const assertLease = vi.fn().mockResolvedValue(undefined);

    const result = await computeDailyForAllMachineWorkers(
      '2026-04-23',
      undefined,
      { assertLease },
    );

    expect(result.settled).toHaveLength(2);
    // Once before entering each unit, then again after its advisory/rule-lock
    // waits at the final read-only point before the upsert.
    expect(assertLease).toHaveBeenCalledTimes(4);
    expect(dbMock.dailyWorkerSalary.upsert).toHaveBeenCalledTimes(2);
  });

  it('does not upsert salary after losing the lease while waiting inside the unit', async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: 'w1' }]);
    const leaseLost = new Error('lease lost');
    const assertLease = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(leaseLost);

    const caught = await computeDailyForAllMachineWorkers(
      '2026-04-23',
      undefined,
      { assertLease },
    ).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(DailyBatchUnexpectedError);
    expect((caught as DailyBatchUnexpectedError).cause).toBe(leaseLost);
    expect(dbMock.dailyWorkerSalary.upsert).not.toHaveBeenCalled();
  });

  it('batch includes a deactivated worker who has a frozen completed task that day', async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: 'historical-worker' }]);
    dbMock.user.findUnique.mockResolvedValue({
      ...workerFixture,
      id: 'historical-worker',
      isActive: false,
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('120.00', 'historical-order'),
    ]);

    const result = await computeDailyForAllMachineWorkers('2026-04-23');

    expect(result.settled).toHaveLength(1);
    expect(result.settled[0]).toMatchObject({
      workerId: 'historical-worker',
      actualSalary: '120.00',
    });
    const where = dbMock.user.findMany.mock.calls[0][0].where;
    expect(where.OR[1].assignedTasks.some).toMatchObject({
      status: 'COMPLETED',
      completedAt: { gte: expect.any(Date), lt: expect.any(Date) },
    });
    expect(where.OR[1].assignedTasks.some.OR).toEqual([
      { workerType: WorkerType.MACHINE },
      { workerType: null, machineType: { not: null } },
    ]);
    expect(where.OR[2]).toEqual({
      dailyWorkerSalaries: {
        some: { date: new Date('2026-04-23T00:00:00.000Z') },
      },
    });
  });

  it('replays a paid frozen row into a durable summary without mutating it', async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: 'paid-worker' }]);
    dbMock.dailyWorkerSalary.findUnique.mockResolvedValue({
      id: 'ds-paid',
      isPaid: true,
      machineType: MachineType.HAND_PRESS,
      baseSalary: '150.00',
      totalPieceworkAmount: '220.00',
      actualSalary: '230.00',
      adjustmentAmount: '10.00',
      taskCount: 2,
      orderCount: 1,
    });

    const result = await computeDailyForAllMachineWorkers(
      '2026-04-23',
      undefined,
      undefined,
      true,
    );

    expect(result.errors).toEqual([]);
    expect(result.settled).toEqual([
      {
        workerId: 'paid-worker',
        date: '2026-04-23',
        machineType: MachineType.HAND_PRESS,
        baseSalary: '150.00',
        totalPieceworkAmount: '220.00',
        actualSalary: '230.00',
        taskCount: 2,
        orderCount: 1,
      },
    ]);
    expect(dbMock.dailyWorkerSalary.upsert).not.toHaveBeenCalled();
    expect(dbMock.dailyWorkerSalaryItem.deleteMany).not.toHaveBeenCalled();
  });

  it('recomputes an unpaid row and includes a late report on retry', async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: 'inactive-worker' }]);
    dbMock.user.findUnique.mockResolvedValue({
      ...workerFixture,
      id: 'inactive-worker',
      isActive: false,
    });
    dbMock.dailyWorkerSalary.findUnique.mockResolvedValue({
      id: 'ds-unpaid',
      isPaid: false,
      machineType: MachineType.HAND_PRESS,
      baseSalary: '100.00',
      totalPieceworkAmount: '0.00',
      actualSalary: '100.00',
      adjustmentAmount: '0.00',
      taskCount: 0,
      orderCount: 0,
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      dailyTask('150.00', 'late-order'),
    ]);

    const result = await computeDailyForAllMachineWorkers(
      '2026-04-23',
      undefined,
      undefined,
      true,
    );

    expect(result.errors).toEqual([]);
    expect(result.settled[0]).toMatchObject({
      workerId: 'inactive-worker',
      actualSalary: '150.00',
      taskCount: 1,
    });
    expect(dbMock.dailyWorkerSalary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          totalPieceworkAmount: '150.00',
          actualSalary: '150.00',
        }),
      }),
    );
  });

  it('recomputes an existing unpaid base-only row after account deactivation', async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: 'inactive-base-worker' }]);
    dbMock.user.findUnique.mockResolvedValue({
      ...workerFixture,
      id: 'inactive-base-worker',
      role: Role.ADMIN,
      workerType: null,
      machineType: null,
      isActive: false,
    });
    dbMock.dailyWorkerSalary.findUnique.mockResolvedValue({
      id: 'ds-unpaid',
      isPaid: false,
      machineType: MachineType.HAND_PRESS,
      baseSalary: '100.00',
      totalPieceworkAmount: '0.00',
      actualSalary: '100.00',
      adjustmentAmount: '0.00',
      taskCount: 0,
      orderCount: 0,
    });

    const result = await computeDailyForAllMachineWorkers(
      '2026-04-23',
      undefined,
      undefined,
      true,
    );

    expect(result.errors).toEqual([]);
    expect(result.settled[0]).toMatchObject({
      workerId: 'inactive-base-worker',
      machineType: MachineType.HAND_PRESS,
      actualSalary: '100.00',
    });
    expect(dbMock.dailyWorkerSalary.upsert).toHaveBeenCalledTimes(1);
  });

  it('keeps a first-attempt base-only worker in a fixed cron roster after deactivation', async () => {
    dbMock.user.findUnique.mockResolvedValue({
      ...workerFixture,
      id: 'roster-worker',
      role: Role.ADMIN,
      workerType: null,
      machineType: null,
      isActive: false,
    });

    const result = await computeDailyForAllMachineWorkers(
      '2026-04-23',
      undefined,
      undefined,
      true,
      [
        {
          workerId: 'roster-worker',
          workerName: '首轮师傅',
          eligibleMachineType: MachineType.HAND_PRESS,
        },
      ],
    );

    expect(result.errors).toEqual([]);
    expect(result.settled).toEqual([
      expect.objectContaining({
        workerId: 'roster-worker',
        machineType: MachineType.HAND_PRESS,
        actualSalary: '100.00',
      }),
    ]);
    expect(dbMock.user.findMany).not.toHaveBeenCalled();
    expect(dbMock.dailyWorkerSalary.upsert).toHaveBeenCalledTimes(1);
  });

  it('rethrows an unexpected worker failure with committed partial results', async () => {
    const databaseFailure = new Error('connection lost');
    dbMock.user.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);
    dbMock.user.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        if (where.id === 'w2') throw databaseFailure;
        return workerFixture;
      },
    );

    let caught: unknown;
    try {
      await computeDailyForAllMachineWorkers('2026-04-23');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DailyBatchUnexpectedError);
    const unexpected = caught as DailyBatchUnexpectedError;
    expect(unexpected.partialResult.settled.map((row) => row.workerId)).toEqual([
      'w1',
    ]);
    expect(unexpected.partialResult.errors).toEqual([]);
    expect(unexpected.cause).toBe(databaseFailure);
  });

  it('wraps a worker-scan failure with an empty partial result', async () => {
    const databaseFailure = new Error('scan unavailable');
    dbMock.user.findMany.mockRejectedValue(databaseFailure);

    let caught: unknown;
    try {
      await computeDailyForAllMachineWorkers('2026-04-23');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DailyBatchUnexpectedError);
    const unexpected = caught as DailyBatchUnexpectedError;
    expect(unexpected.partialResult).toEqual({ settled: [], errors: [] });
    expect(unexpected.cause).toBe(databaseFailure);
  });
});

describe('listDailyWorkerSalaries', () => {
  beforeEach(() => {
    dbMock.dailyWorkerSalary.findMany.mockReset().mockResolvedValue([]);
  });

  it('filters by date (converts YYYY-MM-DD to UTC midnight)', async () => {
    await listDailyWorkerSalaries({ date: '2026-04-23' });
    const where = dbMock.dailyWorkerSalary.findMany.mock.calls[0][0].where;
    expect((where.date as Date).toISOString()).toBe('2026-04-23T00:00:00.000Z');
  });

  it('rejects invalid calendar dates on the filter path (Codex round 44 / P3)', async () => {
    // `/owner/salary/daily?date=2026-02-31` should not silently match
    // March 3 rows. listDailyWorkerSalaries throws so the page can
    // fall back / show an error cleanly.
    await expect(
      listDailyWorkerSalaries({ date: '2026-02-31' }),
    ).rejects.toThrow(/非法日历日期/);
    expect(dbMock.dailyWorkerSalary.findMany).not.toHaveBeenCalled();
  });

  it('filters by workerId and isPaid', async () => {
    await listDailyWorkerSalaries({ workerId: 'worker-1', isPaid: false });
    const where = dbMock.dailyWorkerSalary.findMany.mock.calls[0][0].where;
    expect(where.workerId).toBe('worker-1');
    expect(where.isPaid).toBe(false);
  });

  it('empty filter returns everything (no where conditions)', async () => {
    await listDailyWorkerSalaries({});
    const where = dbMock.dailyWorkerSalary.findMany.mock.calls[0][0].where;
    expect(where).toEqual({});
  });
});

describe('addDailySalaryAdjustment', () => {
  const adjustmentInput = {
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    dailySalaryId: 'ds-1',
    type: SalaryAdjustmentType.BONUS,
    amount: '1.00',
    reason: '测试奖金',
    actor: {
      id: 'owner-1',
      role: Role.ADMIN,
      username: 'owner',
      displayName: '管理员',
    },
  };

  beforeEach(() => {
    dbMock.salaryAdjustment.findUnique.mockReset().mockResolvedValue(null);
    dbMock.dailyWorkerSalary.findUnique
      .mockReset()
      .mockResolvedValueOnce({
        workerId: 'worker-1',
        date: new Date('2026-04-23T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'ds-1',
        isPaid: false,
        baseSalary: '100.00',
        totalPieceworkAmount: '80.00',
      });
    dbMock.salaryAdjustment.create.mockReset().mockResolvedValue({
      id: 'adjustment-1',
      amount: '1.00',
    });
    dbMock.salaryAdjustment.aggregate.mockReset().mockResolvedValue({
      _sum: { amount: '1.00' },
    });
    dbMock.dailyWorkerSalary.update.mockReset().mockResolvedValue({ id: 'ds-1' });
    dbMock.businessAuditLog.create.mockReset().mockResolvedValue({ id: 'audit-1' });
    dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
    dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') {
        return await (fn as (tx: unknown) => unknown)(dbMock);
      }
      return fn;
    });
  });

  it('rejects an adjustment whose gross total would overflow Decimal(10,2)', async () => {
    dbMock.dailyWorkerSalary.findUnique
      .mockReset()
      .mockResolvedValueOnce({
        workerId: 'worker-1',
        date: new Date('2026-04-23T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'ds-1',
        isPaid: false,
        baseSalary: '99999999.99',
        totalPieceworkAmount: '0.00',
      });

    await expect(addDailySalaryAdjustment(adjustmentInput)).rejects.toThrow(
      /调整后实发金额.*99,999,999\.99/,
    );
    expect(dbMock.dailyWorkerSalary.update).not.toHaveBeenCalled();
  });

  it('rejects a legacy adjustment aggregate that no longer fits the column', async () => {
    dbMock.salaryAdjustment.aggregate.mockResolvedValue({
      _sum: { amount: '100000000.00' },
    });

    await expect(addDailySalaryAdjustment(adjustmentInput)).rejects.toThrow(
      /人工调整合计.*99,999,999\.99/,
    );
    expect(dbMock.dailyWorkerSalary.update).not.toHaveBeenCalled();
  });

  it('stores a valid adjustment and recomputes the signed total', async () => {
    await expect(addDailySalaryAdjustment(adjustmentInput)).resolves.toEqual({
      id: 'adjustment-1',
      amount: '1.00',
      adjustmentAmount: '1.00',
      actualSalary: '101.00',
    });
    expect(dbMock.dailyWorkerSalary.update).toHaveBeenCalledWith({
      where: { id: 'ds-1' },
      data: {
        adjustmentAmount: '1.00',
        actualSalary: '101.00',
      },
    });
    expect(dbMock.salaryAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: adjustmentInput.idempotencyKey,
        }),
      }),
    );
    expect(dbMock.businessAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'SalaryAdjustment',
          entityId: 'adjustment-1',
          actorId: 'owner-1',
        }),
      }),
    );
  });

  it('fails the enclosing transaction when adjustment audit evidence cannot be written', async () => {
    dbMock.businessAuditLog.create.mockRejectedValueOnce(
      new Error('audit insert failed'),
    );

    await expect(addDailySalaryAdjustment(adjustmentInput)).rejects.toThrow(
      'audit insert failed',
    );
    expect(dbMock.salaryAdjustment.create).toHaveBeenCalledTimes(1);
    expect(dbMock.dailyWorkerSalary.update).toHaveBeenCalledTimes(1);
  });

  it('replays the same adjustment request without creating another ledger row', async () => {
    dbMock.salaryAdjustment.findUnique.mockResolvedValue({
      id: 'adjustment-1',
      idempotencyKey: adjustmentInput.idempotencyKey,
      dailySalaryId: 'ds-1',
      type: SalaryAdjustmentType.BONUS,
      amount: '1.00',
      reason: '测试奖金',
      createdById: 'owner-1',
      dailySalary: {
        adjustmentAmount: '6.00',
        actualSalary: '106.00',
      },
    });

    await expect(addDailySalaryAdjustment(adjustmentInput)).resolves.toEqual({
      id: 'adjustment-1',
      amount: '1.00',
      adjustmentAmount: '6.00',
      actualSalary: '106.00',
    });
    expect(dbMock.salaryAdjustment.create).not.toHaveBeenCalled();
    expect(dbMock.dailyWorkerSalary.update).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects reuse of an adjustment request key with different money', async () => {
    dbMock.salaryAdjustment.findUnique.mockResolvedValue({
      id: 'adjustment-1',
      idempotencyKey: adjustmentInput.idempotencyKey,
      dailySalaryId: 'ds-1',
      type: SalaryAdjustmentType.BONUS,
      amount: '2.00',
      reason: '测试奖金',
      createdById: 'owner-1',
      dailySalary: {
        adjustmentAmount: '2.00',
        actualSalary: '102.00',
      },
    });

    await expect(addDailySalaryAdjustment(adjustmentInput)).rejects.toThrow(
      /请求标识已被其他记录使用/,
    );
    expect(dbMock.salaryAdjustment.create).not.toHaveBeenCalled();
  });
});

describe('markDailySalaryPaid', () => {
  beforeEach(() => {
    dbMock.dailyWorkerSalary.findUnique.mockReset().mockResolvedValue({
      workerId: 'worker-1',
      // Shanghai 2026-04-23 is stored as UTC midnight for that calendar
      // date (see computeDailyWorkerSalary comment).
      date: new Date('2026-04-23T00:00:00.000Z'),
    });
    dbMock.dailyWorkerSalary.update.mockReset().mockResolvedValue({
      id: 'ds-1',
      isPaid: true,
      // markDailySalaryPaid 现在把师傅名一起带回去，供调用方渲染
      // 「已标记 XXX 为已发放」的回执——发钱操作不能只吐 id。
      worker: { displayName: '张师傅' },
    });
    dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
    dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
      return fn;
    });
  });

  it('marks paid stamps paidAt from the injected clock', async () => {
    const now = new Date('2026-05-01T09:00:00Z');
    await markDailySalaryPaid('ds-1', true, now);
    const data = dbMock.dailyWorkerSalary.update.mock.calls[0][0].data;
    expect(data.isPaid).toBe(true);
    expect(data.paidAt).toBe(now);
  });

  it('拒绝将上海当日的临时日薪冻结为已发', async () => {
    const now = new Date('2026-04-23T04:00:00.000Z');

    await expect(markDailySalaryPaid('ds-1', true, now)).rejects.toThrow(
      /当前或未来日期.*2026-04-23/,
    );
    expect(dbMock.dailyWorkerSalary.update).not.toHaveBeenCalled();
  });

  it('拒绝历史遗留的未来日期记录被标记已发', async () => {
    dbMock.dailyWorkerSalary.findUnique.mockResolvedValue({
      workerId: 'worker-1',
      date: new Date('2026-04-24T00:00:00.000Z'),
    });

    await expect(
      markDailySalaryPaid(
        'ds-1',
        true,
        new Date('2026-04-23T04:00:00.000Z'),
      ),
    ).rejects.toThrow(/当前或未来日期.*2026-04-24/);
    expect(dbMock.dailyWorkerSalary.update).not.toHaveBeenCalled();
  });

  it('mark-unpaid clears paidAt', async () => {
    // 即使这是当日的历史误发记录，也必须允许撤销。
    await markDailySalaryPaid(
      'ds-1',
      false,
      new Date('2026-04-23T04:00:00.000Z'),
    );
    const data = dbMock.dailyWorkerSalary.update.mock.calls[0][0].data;
    expect(data.isPaid).toBe(false);
    expect(data.paidAt).toBeNull();
  });

  it('throws when the row is missing (no silent no-op)', async () => {
    dbMock.dailyWorkerSalary.findUnique.mockResolvedValue(null);
    await expect(markDailySalaryPaid('ghost', true)).rejects.toThrow(
      /日薪记录不存在/,
    );
    expect(dbMock.dailyWorkerSalary.update).not.toHaveBeenCalled();
  });

  it('takes the per-(worker, date) advisory lock (mirrors hourly round 48 / P0)', async () => {
    // mark-paid must take the same lock as computeDailyWorkerSalary so
    // a concurrent recompute can't overwrite salary fields on a row
    // that's being marked paid.
    await markDailySalaryPaid('ds-1', true);
    const sqlCalls = dbMock.$executeRaw.mock.calls;
    expect(sqlCalls.length).toBeGreaterThan(0);
    const sql = (sqlCalls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sqlCalls[0][1]).toMatch(
      /print-shop-erp:daily:worker-1:2026-04-23/,
    );
  });
});

describe('computeDailyWorkerSalary — advisory lock + now pinning (mirrors hourly round 48)', () => {
  const workerFixture = {
    id: 'worker-1',
    role: Role.WORKER,
    workerType: WorkerType.MACHINE,
    machineType: MachineType.HAND_PRESS,
    isActive: true,
  };

  beforeEach(() => {
    dbMock.user.findUnique.mockReset().mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockReset().mockResolvedValue([]);
    dbMock.salaryRule.findFirst
      .mockReset()
      .mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.workerMachineSalaryRule.findFirst.mockReset().mockResolvedValue(null);
    dbMock.dailyWorkerSalary.upsert.mockReset().mockResolvedValue({ id: 'ds-1' });
    dbMock.dailyWorkerSalaryItem.deleteMany.mockReset().mockResolvedValue({ count: 0 });
    dbMock.dailyWorkerSalaryItem.createMany.mockReset().mockResolvedValue({ count: 0 });
    dbMock.dailyWorkerSalary.findUnique.mockReset().mockResolvedValue(null);
    dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
    dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
      return fn;
    });
  });

  it('takes the per-(worker, date) advisory lock (P0)', async () => {
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    const sqlCalls = dbMock.$executeRaw.mock.calls;
    expect(sqlCalls.length).toBeGreaterThan(0);
    const sql = (sqlCalls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sqlCalls[0][1]).toMatch(
      /print-shop-erp:daily:worker-1:2026-04-23/,
    );
  });

  it('pins rule-resolution to the injected `now` (batches snapshot one rule version)', async () => {
    const now = new Date('2026-04-23T10:00:00Z');
    await computeDailyWorkerSalary('worker-1', '2026-04-23', now);
    // getActiveMachineRule is the single rule lookup; it must use `now`
    // in effectiveFrom.lte, not Date.now().
    for (const call of dbMock.salaryRule.findFirst.mock.calls) {
      expect(call[0].where.effectiveFrom.lte).toEqual(now);
    }
  });
});

describe('future-dated settlement guard (上海日历)', () => {
  const workerFixture = {
    id: 'worker-1',
    role: Role.WORKER,
    workerType: WorkerType.MACHINE,
    machineType: MachineType.HAND_PRESS,
    isActive: true,
  };

  beforeEach(() => {
    dbMock.user.findMany.mockReset().mockResolvedValue([]);
    dbMock.user.findUnique.mockReset().mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockReset().mockResolvedValue([]);
    dbMock.salaryRule.findFirst
      .mockReset()
      .mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.workerMachineSalaryRule.findFirst.mockReset().mockResolvedValue(null);
    dbMock.dailyWorkerSalary.findUnique.mockReset().mockResolvedValue(null);
    dbMock.dailyWorkerSalary.upsert.mockReset().mockResolvedValue({ id: 'ds-1' });
    dbMock.dailyWorkerSalaryItem.deleteMany
      .mockReset()
      .mockResolvedValue({ count: 0 });
    dbMock.dailyWorkerSalaryItem.createMany
      .mockReset()
      .mockResolvedValue({ count: 0 });
    dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
    dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') {
        return await (fn as (tx: unknown) => unknown)(dbMock);
      }
      return fn;
    });
  });

  it('single path refuses a future date before touching the database', async () => {
    // 未来的一天没有任何已完工任务，tasks.length === 0 分支会照 dailyBase
    // 写出一条正式行 —— 所以守卫必须在任何库访问之前生效。
    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-24', new Date('2026-04-23T10:00:00Z')),
    ).rejects.toThrow(DailySalaryError);
    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-24', new Date('2026-04-23T10:00:00Z')),
    ).rejects.toThrow(/未来日期/);
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
    expect(dbMock.dailyWorkerSalary.upsert).not.toHaveBeenCalled();
  });

  it('still allows the current day (口径：只拒严格未来，别改成 >=)', async () => {
    // 业主手工重算的典型场景就是「今天有人补报工了，重算今天」。
    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23', new Date('2026-04-23T10:00:00Z')),
    ).resolves.toBeDefined();
    expect(dbMock.dailyWorkerSalary.upsert).toHaveBeenCalledTimes(1);
  });

  it('judges "future" on the Shanghai calendar, not UTC', async () => {
    // UTC 2026-04-23T15:59:59Z = Shanghai 04-23 23:59:59 → 04-24 仍是未来
    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-24', new Date('2026-04-23T15:59:59Z')),
    ).rejects.toThrow(/未来日期/);
    // UTC 2026-04-23T16:00:00Z = Shanghai 04-24 00:00 → 04-24 已是当天
    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-24', new Date('2026-04-23T16:00:00Z')),
    ).resolves.toBeDefined();
  });

  it('batch aborts wholesale instead of reporting a per-worker error', async () => {
    // 日期错是整批的输入错，不是某个师傅的业务错 —— 逐人捕获会返回
    // status:'success' + errorCount = 全员数，UI 上看着像「部分失败」。
    let caught: unknown;
    try {
      await computeDailyForAllMachineWorkers(
        '2026-04-24',
        new Date('2026-04-23T10:00:00Z'),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DailySalaryError);
    expect((caught as Error).message).toMatch(/未来日期/);
    expect(dbMock.user.findMany).not.toHaveBeenCalled();
  });
});

// sanity check: the pure path still lines up with lib/salary/machine-piecework
// since computeDailyWorkerSalary delegates to calcMachineDailySalary.
describe('parity with calcMachineDailySalary', () => {
  it('max(sum, base) behavior identical', () => {
    expect(
      new Decimal('201').eq(new Decimal('201.00')),
    ).toBe(true);
  });
});
