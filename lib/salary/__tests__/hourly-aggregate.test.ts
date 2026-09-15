import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Role,
  WorkerType,
  SalaryRuleType,
} from '../../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    salaryRule: { findFirst: vi.fn() },
    attendance: { findMany: vi.fn() },
    hourlyWorkerPayroll: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalSalary: null } }),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
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
  computeHourlyPayroll,
  computeHourlyForAllInMonth,
  HourlyAggregateError,
  HourlyBatchUnexpectedError,
  listHourlyPayrolls,
  getHourlyPayrollMonthContext,
  markHourlyPayrollPaid,
} from '../hourly-aggregate';

const ACTIVE_RULES: Record<string, unknown> = {
  CLEANER_HOURLY: { hourlyRate: 11 },
  COOK_MONTHLY: { monthlyBase: 3000 },
  COOK_SPARE_HOURLY: { hourlyRate: 11 },
  OT_MULTIPLIER: { multiplier: 1.0 },
  WORK_HOURS: {
    morning: { start: '08:00', end: '12:00' },
    afternoon: { start: '13:30', end: '17:30' },
    otStart: '18:00',
  },
};

function workerFixture(overrides: Partial<{
  workerType: WorkerType | null;
  isActive: boolean;
  role: Role;
  employmentStartDate: Date | null;
  employmentEndDate: Date | null;
}> = {}) {
  return {
    id: 'worker-1',
    role: Role.WORKER,
    workerType: WorkerType.CLEANER,
    isActive: true,
    displayName: '打包阿姨',
    employmentStartDate: null,
    employmentEndDate: null,
    ...overrides,
  };
}

function setupAllRules(byKey: Record<string, unknown> = ACTIVE_RULES): void {
  dbMock.salaryRule.findFirst.mockImplementation(async (args: {
    where: { ruleType: SalaryRuleType; ruleKey: string };
  }) => {
    const v = byKey[args.where.ruleKey];
    return v === undefined ? null : { ruleValue: v };
  });
}

beforeEach(() => {
  dbMock.hourlyWorkerPayroll.count.mockReset().mockResolvedValue(0);
  dbMock.hourlyWorkerPayroll.aggregate.mockReset().mockResolvedValue({ _sum: { totalSalary: null } });
  dbMock.user.findUnique.mockReset();
  dbMock.user.findMany.mockReset();
  dbMock.salaryRule.findFirst.mockReset();
  dbMock.attendance.findMany.mockReset().mockResolvedValue([]);
  dbMock.hourlyWorkerPayroll.findUnique.mockReset().mockResolvedValue(null);
  dbMock.hourlyWorkerPayroll.upsert
    .mockReset()
    .mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
      id: 'payroll-1',
      ...create,
    }));
  dbMock.hourlyWorkerPayroll.findMany.mockReset();
  dbMock.hourlyWorkerPayroll.update.mockReset();
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
    if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
    return fn;
  });
});

describe('computeHourlyPayroll — worker validation', () => {
  it('rejects missing worker', async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    await expect(
      computeHourlyPayroll('ghost', '2026-05'),
    ).rejects.toThrow(/不存在/);
  });

  it('rejects non-WORKER role', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ role: Role.SALES }),
    );
    await expect(
      computeHourlyPayroll('worker-1', '2026-05'),
    ).rejects.toThrow(/不是工人/);
  });

  it('rejects MACHINE workerType (routes to piecework path)', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ workerType: WorkerType.MACHINE }),
    );
    await expect(
      computeHourlyPayroll('worker-1', '2026-05'),
    ).rejects.toThrow(/只有清废和厨师继续走时薪月结/);
  });

  it('rejects bad month format', async () => {
    await expect(
      computeHourlyPayroll('worker-1', '2026/05'),
    ).rejects.toThrow(/月份格式非法/);
  });
});

describe('computeHourlyPayroll — immutable attendance identity', () => {
  it.each([
    [
      '改岗',
      workerFixture({ role: Role.SALES, workerType: null }),
    ],
    ['改工种', workerFixture({ workerType: WorkerType.COOK })],
    ['停用', workerFixture({ isActive: false })],
  ])('uses the historical CLEANER snapshot after the account is %s', async (_label, currentWorker) => {
    dbMock.user.findUnique.mockResolvedValue(currentWorker);
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue([
      {
        date: new Date('2026-05-01'),
        normalHours: '8',
        otHours: '2',
        spareHours: '0',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.CLEANER,
      },
    ]);

    await expect(
      computeHourlyPayroll('worker-1', '2026-05'),
    ).resolves.toMatchObject({
      workerType: WorkerType.CLEANER,
      baseSalary: '88.00',
      otSalary: '22.00',
      totalSalary: '110.00',
    });
  });

  it('fails closed when one month contains more than one historical hourly type', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
    dbMock.attendance.findMany.mockResolvedValue([
      {
        date: new Date('2026-05-01'),
        normalHours: '8',
        otHours: '0',
        spareHours: '0',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.COOK,
      },
      {
        date: new Date('2026-05-02'),
        normalHours: '8',
        otHours: '0',
        spareHours: '0',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.CLEANER,
      },
    ]);

    await expect(
      computeHourlyPayroll('worker-1', '2026-05'),
    ).rejects.toThrow(/多个历史时薪工种/);
    expect(dbMock.hourlyWorkerPayroll.upsert).not.toHaveBeenCalled();
  });

  it('does not regenerate a historical PACKER month after cutover', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ workerType: WorkerType.PACKER }),
    );
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue([
      {
        date: new Date('2026-05-01'),
        normalHours: '8',
        otHours: '0',
        spareHours: '0',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.PACKER,
      },
    ]);

    await expect(
      computeHourlyPayroll('worker-1', '2026-05'),
    ).rejects.toThrow(/打包报工已切换为工序计件结算/);
    expect(dbMock.hourlyWorkerPayroll.upsert).not.toHaveBeenCalled();
  });
});

describe('computeHourlyPayroll — CLEANER', () => {
  it('uses the active CLEANER_HOURLY rule', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ workerType: WorkerType.CLEANER }),
    );
    setupAllRules({
      CLEANER_HOURLY: { hourlyRate: 12 }, // owner raised cleaner rate
      OT_MULTIPLIER: { multiplier: 1.0 },
    });
    dbMock.attendance.findMany.mockResolvedValue([
      {
        date: new Date('2026-05-01'),
        normalHours: '8',
        otHours: '0',
        spareHours: '0',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.CLEANER,
      },
    ]);
    const r = await computeHourlyPayroll('worker-1', '2026-05');
    expect(r.hourlyRate).toBe('12.00');
    expect(r.baseSalary).toBe('96.00'); // 8 × 12
  });
});

describe('computeHourlyPayroll — Decimal storage closure', () => {
  const mayRows = (hours: {
    normalHours: string;
    otHours: string;
    spareHours: string;
  }) =>
    Array.from({ length: 31 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 4, index + 1)),
      ...hours,
      roleSnapshot: Role.WORKER,
      workerTypeSnapshot: WorkerType.CLEANER,
    }));

  it('persists the maximum bounded cleaner rate/OT combination in Decimal(11,2)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
    setupAllRules({
      ...ACTIVE_RULES,
      CLEANER_HOURLY: { hourlyRate: 9999.99 },
      OT_MULTIPLIER: { multiplier: 99.99 },
    });
    dbMock.attendance.findMany.mockResolvedValue(
      mayRows({ normalHours: '0.00', otHours: '24.00', spareHours: '0.00' }),
    );

    const result = await computeHourlyPayroll('worker-1', '2026-05');

    expect(result.totalOtHours).toBe('744.00');
    expect(Number(result.otSalary)).toBeLessThanOrEqual(999_999_999.99);
    expect(dbMock.hourlyWorkerPayroll.upsert).toHaveBeenCalledOnce();
  });

  it('persists maximum cook monthly + spare components in Decimal(11,2)', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ workerType: WorkerType.COOK }),
    );
    setupAllRules({
      ...ACTIVE_RULES,
      COOK_MONTHLY: { monthlyBase: 99_999_999.99 },
      COOK_SPARE_HOURLY: { hourlyRate: 9999.99 },
    });
    dbMock.attendance.findMany.mockResolvedValue(
      mayRows({ normalHours: '0.00', otHours: '0.00', spareHours: '24.00' }).map(
        (row) => ({ ...row, workerTypeSnapshot: WorkerType.COOK }),
      ),
    );

    const result = await computeHourlyPayroll('worker-1', '2026-05');

    expect(Number(result.totalSalary)).toBeLessThanOrEqual(999_999_999.99);
    expect(dbMock.hourlyWorkerPayroll.upsert).toHaveBeenCalledOnce();
  });

  it('fails before upsert when a legacy hourly rule exceeds Decimal(6,2)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
    setupAllRules({
      ...ACTIVE_RULES,
      CLEANER_HOURLY: { hourlyRate: 10000 },
    });

    await expect(
      computeHourlyPayroll('worker-1', '2026-05'),
    ).rejects.toThrow(/清废时薪规则.*可保存范围/);
    expect(dbMock.hourlyWorkerPayroll.upsert).not.toHaveBeenCalled();
  });
});

describe('computeHourlyPayroll — COOK (全职/混合/请假/请假代班)', () => {
  beforeEach(() => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ workerType: WorkerType.COOK }),
    );
    setupAllRules();
  });

  it('全职做饭（无 spare）→ 月薪 3000 flat', async () => {
    dbMock.attendance.findMany.mockResolvedValue(
      Array.from({ length: 22 }, (_, i) => ({
        date: new Date(Date.UTC(2026, 4, i + 1)),
        normalHours: '8.00',
        otHours: '0.00',
        spareHours: '0.00',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.COOK,
      })),
    );
    const r = await computeHourlyPayroll('worker-1', '2026-05');
    expect(r.baseSalary).toBe('3000.00'); // monthlyBase stored in baseSalary column for COOK
    expect(r.otSalary).toBe('0.00');
    expect(r.spareSalary).toBe('0.00');
    expect(r.totalSalary).toBe('3000.00');
  });

  it('混合打包（20h spare × 11 = 220）→ 3000 + 220 = 3220', async () => {
    dbMock.attendance.findMany.mockResolvedValue([
      {
        date: new Date('2026-05-10'),
        normalHours: '8',
        otHours: '0',
        spareHours: '10',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.COOK,
      },
      {
        date: new Date('2026-05-11'),
        normalHours: '8',
        otHours: '0',
        spareHours: '10',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.COOK,
      },
    ]);
    const r = await computeHourlyPayroll('worker-1', '2026-05');
    expect(r.totalSpareHours).toBe('20.00');
    expect(r.baseSalary).toBe('3000.00');
    expect(r.spareSalary).toBe('220.00');
    expect(r.totalSalary).toBe('3220.00');
  });

  it('请假整月（no Attendance rows）→ 月薪 3000 不折扣（DECISIONS 2026-04-24）', async () => {
    // 厨师请假 SPEC 未定义；MVP 按"不折扣月薪"处理，owner 可手动在
    // mark-paid 时调整。注释里留 TODO。
    dbMock.attendance.findMany.mockResolvedValue([]);
    const r = await computeHourlyPayroll('worker-1', '2026-05');
    expect(r.totalNormalHours).toBe('0.00');
    expect(r.totalSpareHours).toBe('0.00');
    expect(r.baseSalary).toBe('3000.00');
    expect(r.spareSalary).toBe('0.00');
    expect(r.totalSalary).toBe('3000.00'); // full monthly base, no proration
  });

  it('请假 + 代班打包（仅 spare 15h）→ 3000 + 165 = 3165', async () => {
    dbMock.attendance.findMany.mockResolvedValue([
      {
        date: new Date('2026-05-20'),
        normalHours: '0',
        otHours: '0',
        spareHours: '15',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.COOK,
      },
    ]);
    const r = await computeHourlyPayroll('worker-1', '2026-05');
    expect(r.totalNormalHours).toBe('0.00');
    expect(r.totalSpareHours).toBe('15.00');
    expect(r.baseSalary).toBe('3000.00'); // still full monthly
    expect(r.spareSalary).toBe('165.00');
    expect(r.totalSalary).toBe('3165.00');
  });

  it('refuses when COOK_MONTHLY rule is unset', async () => {
    setupAllRules({
      COOK_SPARE_HOURLY: { hourlyRate: 11 },
      OT_MULTIPLIER: { multiplier: 1.0 },
    });
    await expect(
      computeHourlyPayroll('worker-1', '2026-05'),
    ).rejects.toThrow(/COOK_MONTHLY/);
  });
});

describe('computeHourlyPayroll — paid-row refuse recompute (round 43 bedrock)', () => {
  it('refuses when HourlyWorkerPayroll.isPaid = true', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
    setupAllRules();
    dbMock.hourlyWorkerPayroll.findUnique.mockResolvedValue({
      id: 'existing',
      isPaid: true,
      totalSalary: '2068.00',
    });
    await expect(
      computeHourlyPayroll('worker-1', '2026-05'),
    ).rejects.toThrow(/已标记发放.*撤销发放再重算/);
    expect(dbMock.hourlyWorkerPayroll.upsert).not.toHaveBeenCalled();
  });

  it('allows recompute when existing row is unpaid', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
    setupAllRules();
    dbMock.hourlyWorkerPayroll.findUnique.mockResolvedValue({
      id: 'existing',
      isPaid: false,
      totalSalary: '100.00',
    });
    dbMock.attendance.findMany.mockResolvedValue([]);
    await computeHourlyPayroll('worker-1', '2026-05');
    expect(dbMock.hourlyWorkerPayroll.upsert).toHaveBeenCalled();
  });

  it('update branch does NOT touch isPaid/paidAt', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue([]);
    await computeHourlyPayroll('worker-1', '2026-05');
    const update = dbMock.hourlyWorkerPayroll.upsert.mock.calls[0][0].update;
    expect('isPaid' in update).toBe(false);
    expect('paidAt' in update).toBe(false);
  });
});

describe('computeHourlyPayroll — Shanghai month range query', () => {
  it('queries attendance in [month-first, next-month-first)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue([]);
    await computeHourlyPayroll('worker-1', '2026-05');
    const where = dbMock.attendance.findMany.mock.calls[0][0].where;
    expect((where.date.gte as Date).toISOString()).toBe(
      '2026-05-01T00:00:00.000Z',
    );
    expect((where.date.lt as Date).toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    );
  });

  it('includes employment boundary dates and excludes rows outside them from totals and dailyDetail', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({
        employmentStartDate: new Date('2026-05-10T00:00:00.000Z'),
        employmentEndDate: new Date('2026-05-20T00:00:00.000Z'),
      }),
    );
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue(
      ['2026-05-09', '2026-05-10', '2026-05-20', '2026-05-21'].map(
        (date) => ({
          date: new Date(`${date}T00:00:00.000Z`),
          normalHours: '8.00',
          otHours: '0.00',
          spareHours: '0.00',
          roleSnapshot: Role.WORKER,
          workerTypeSnapshot: WorkerType.CLEANER,
        }),
      ),
    );

    const result = await computeHourlyPayroll('worker-1', '2026-05');

    expect(result.totalNormalHours).toBe('16.00');
    const create = dbMock.hourlyWorkerPayroll.upsert.mock.calls[0][0].create;
    expect(create.dailyDetail).toEqual([
      expect.objectContaining({ date: '2026-05-10' }),
      expect.objectContaining({ date: '2026-05-20' }),
    ]);
  });

  it('rejects a month wholly outside the employment interval', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({
        employmentStartDate: new Date('2026-06-01T00:00:00.000Z'),
        employmentEndDate: new Date('2026-06-30T00:00:00.000Z'),
      }),
    );

    await expect(
      computeHourlyPayroll('worker-1', '2026-05'),
    ).rejects.toThrow(/禁止计薪/);
    expect(dbMock.attendance.findMany).not.toHaveBeenCalled();
  });
});

describe('computeHourlyForAllInMonth', () => {
  it('scans active hourly workers and settles each; continues past per-worker errors', async () => {
    dbMock.user.findMany.mockResolvedValue([
      { id: 'w1' },
      { id: 'w2' },
      { id: 'w3' },
    ]);
    // w1 OK, w2 missing, w3 OK
    dbMock.user.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        if (where.id === 'w2') return null;
        return workerFixture({ workerType: WorkerType.CLEANER });
      },
    );
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue([]);
    const r = await computeHourlyForAllInMonth('2026-05');
    expect(r.settled.map((s) => s.workerId)).toEqual(['w1', 'w3']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].workerId).toBe('w2');
  });

  it('rejects bad month format before fanout', async () => {
    await expect(
      computeHourlyForAllInMonth('2026/05'),
    ).rejects.toThrow(/月份格式非法/);
  });

  it('filter restricts future aggregation to CLEANER / COOK', async () => {
    dbMock.user.findMany.mockResolvedValue([]);
    await computeHourlyForAllInMonth('2026-05');
    const where = dbMock.user.findMany.mock.calls[0][0].where;
    expect(where.AND[0].OR[0].workerType.in).toEqual([
      WorkerType.CLEANER,
      WorkerType.COOK,
    ]);
    expect(where.AND[0].OR[1].attendanceRecords.some).toMatchObject({
      roleSnapshot: Role.WORKER,
      workerTypeSnapshot: {
        in: [WorkerType.CLEANER, WorkerType.COOK],
      },
    });
    expect(where.AND[1]).toEqual({
      OR: [
        { employmentStartDate: null },
        { employmentStartDate: { lt: new Date('2026-06-01T00:00:00.000Z') } },
      ],
    });
    expect(where.AND[2]).toEqual({
      OR: [
        { employmentEndDate: null },
        { employmentEndDate: { gte: new Date('2026-05-01T00:00:00.000Z') } },
      ],
    });
  });

  it('rethrows an unexpected worker failure with committed partial results', async () => {
    const databaseFailure = new Error('connection lost');
    dbMock.user.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);
    dbMock.user.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        if (where.id === 'w2') throw databaseFailure;
        return workerFixture({ workerType: WorkerType.CLEANER });
      },
    );
    setupAllRules();

    let caught: unknown;
    try {
      await computeHourlyForAllInMonth('2026-05');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HourlyBatchUnexpectedError);
    const unexpected = caught as HourlyBatchUnexpectedError;
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
      await computeHourlyForAllInMonth('2026-05');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HourlyBatchUnexpectedError);
    const unexpected = caught as HourlyBatchUnexpectedError;
    expect(unexpected.partialResult).toEqual({ settled: [], errors: [] });
    expect(unexpected.cause).toBe(databaseFailure);
  });

  it('pins one coherent rule bundle for every worker in the batch', async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);
    dbMock.user.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        ...workerFixture(),
        id: where.id,
      }),
    );
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue([
      {
        date: new Date('2026-05-01'),
        normalHours: '8',
        otHours: '0',
        spareHours: '0',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.CLEANER,
      },
    ]);

    const result = await computeHourlyForAllInMonth(
      '2026-05',
      new Date('2026-06-01T00:00:00Z'),
    );

    expect(result.settled.map((row) => row.totalSalary)).toEqual([
      '88.00',
      '88.00',
    ]);
    // Five active rule keys are resolved once for the whole batch, not once per
    // worker. This is what prevents an admin edit between w1 and w2 from
    // changing only half of one settlement run.
    expect(dbMock.salaryRule.findFirst).toHaveBeenCalledTimes(5);
    const snapshots = dbMock.hourlyWorkerPayroll.upsert.mock.calls.map(
      (call) => call[0].create.salaryRuleSnapshot,
    );
    expect(snapshots[0]).toEqual(snapshots[1]);
  });

  it('batch includes a changed-role worker with historical hourly attendance', async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: 'former-worker' }]);
    dbMock.user.findUnique.mockResolvedValue({
      ...workerFixture(),
      id: 'former-worker',
      role: Role.SALES,
      workerType: null,
      isActive: false,
    });
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue([
      {
        date: new Date('2026-05-01'),
        normalHours: '8',
        otHours: '0',
        spareHours: '0',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.CLEANER,
      },
    ]);

    const result = await computeHourlyForAllInMonth('2026-05');

    expect(result.settled).toEqual([
      expect.objectContaining({
        workerId: 'former-worker',
        workerType: WorkerType.CLEANER,
        totalSalary: '88.00',
      }),
    ]);
  });

  it('wraps a rule-bundle read failure before settling any worker', async () => {
    const databaseFailure = new Error('salary rules unavailable');
    dbMock.user.findMany.mockResolvedValue([{ id: 'w1' }]);
    dbMock.salaryRule.findFirst.mockRejectedValue(databaseFailure);

    let caught: unknown;
    try {
      await computeHourlyForAllInMonth('2026-05');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HourlyBatchUnexpectedError);
    const unexpected = caught as HourlyBatchUnexpectedError;
    expect(unexpected.message).toBe('时薪规则快照读取失败');
    expect(unexpected.partialResult).toEqual({ settled: [], errors: [] });
    expect(unexpected.cause).toBe(databaseFailure);
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
    expect(dbMock.hourlyWorkerPayroll.upsert).not.toHaveBeenCalled();
  });
});

describe('listHourlyPayrolls', () => {
  it('validates month format early (Codex round 44 pattern)', async () => {
    await expect(
      listHourlyPayrolls({ month: '2026/05' }),
    ).rejects.toThrow(/月份格式非法/);
  });

  it('passes through filters when all valid', async () => {
    dbMock.hourlyWorkerPayroll.findMany.mockResolvedValue([]);
    await listHourlyPayrolls({
      month: '2026-05',
      workerId: 'worker-1',
      isPaid: false,
    });
    const where = dbMock.hourlyWorkerPayroll.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      month: '2026-05',
      workerId: 'worker-1',
      isPaid: false,
    });
  });

  it('derives the historical display type from the payroll snapshot, not current User.workerType', async () => {
    dbMock.hourlyWorkerPayroll.findMany.mockResolvedValue([
      {
        id: 'payroll-1',
        salaryRuleSnapshot: { workerType: WorkerType.PACKER },
        worker: { displayName: '已改岗员工' },
      },
    ]);

    const rows = await listHourlyPayrolls({});

    expect(rows.rows[0].payrollWorkerType).toBe(WorkerType.PACKER);
    expect(dbMock.hourlyWorkerPayroll.findMany.mock.calls[0][0].select.worker)
      .toEqual({ select: { displayName: true } });
  });
});

describe('markHourlyPayrollPaid', () => {
  beforeEach(() => {
    dbMock.hourlyWorkerPayroll.findUnique.mockResolvedValue({
      workerId: 'worker-1',
      month: '2026-05',
      salaryRuleSnapshot: { workerType: WorkerType.CLEANER },
      worker: { displayName: '李师傅' },
    });
    dbMock.hourlyWorkerPayroll.update.mockResolvedValue({
      id: 'p-1',
      isPaid: true,
    });
  });

  it('sets paidAt from injected clock on mark-paid', async () => {
    const now = new Date('2026-06-01T09:00:00Z');
    await markHourlyPayrollPaid('p-1', true, now);
    const data = dbMock.hourlyWorkerPayroll.update.mock.calls[0][0].data;
    expect(data.isPaid).toBe(true);
    expect(data.paidAt).toBe(now);
  });

  it.each([true, false])('replaying isPaid=%s preserves the first transition and history', async (isPaid) => {
    const firstTime = new Date('2026-06-01T09:00:00Z');
    const replayTime = new Date('2026-06-02T10:00:00Z');
    let stored = {
      workerId: 'worker-1', month: '2026-05',
      salaryRuleSnapshot: { workerType: WorkerType.CLEANER },
      worker: { displayName: '李师傅' },
      totalSalary: '110.00', isPaid: !isPaid,
      paidAt: isPaid ? null : new Date('2026-06-01T08:00:00Z'),
    };
    dbMock.hourlyWorkerPayroll.findUnique.mockImplementation(async () => stored);
    dbMock.hourlyWorkerPayroll.update.mockImplementation(async ({ data }: {
      data: { isPaid: boolean; paidAt: Date | null };
    }) => {
      stored = { ...stored, ...data };
      return { id: 'p-1', isPaid: stored.isPaid };
    });

    const first = await markHourlyPayrollPaid('p-1', isPaid, firstTime);
    const history = structuredClone(stored);
    const replay = await markHourlyPayrollPaid('p-1', isPaid, replayTime);

    expect(stored).toEqual(history);
    expect(stored.paidAt).toEqual(isPaid ? firstTime : null);
    expect(replay).toEqual(first);
    expect(replay).toEqual({ id: 'p-1', isPaid, workerName: '李师傅' });
    expect(dbMock.hourlyWorkerPayroll.update).toHaveBeenCalledTimes(1);
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('a concurrent payment that wins the lock is returned without overwriting its paidAt', async () => {
    dbMock.hourlyWorkerPayroll.findUnique
      .mockResolvedValueOnce({ workerId: 'worker-1', month: '2026-05', isPaid: false })
      .mockResolvedValueOnce({
        workerId: 'worker-1', month: '2026-05', isPaid: true,
        paidAt: new Date('2026-06-01T09:00:00Z'),
        salaryRuleSnapshot: { workerType: WorkerType.CLEANER },
        worker: { displayName: '李师傅' },
      });

    await expect(markHourlyPayrollPaid('p-1', true, new Date('2026-06-02T10:00:00Z')))
      .resolves.toEqual({ id: 'p-1', isPaid: true, workerName: '李师傅' });
    expect(dbMock.hourlyWorkerPayroll.update).not.toHaveBeenCalled();
    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.hourlyWorkerPayroll.findUnique.mock.invocationCallOrder[1]!,
    );
  });

  it('拒绝将上海当月的临时月结冻结为已发', async () => {
    await expect(
      markHourlyPayrollPaid(
        'p-1',
        true,
        new Date('2026-05-15T04:00:00.000Z'),
      ),
    ).rejects.toThrow(/当前或未来月份.*2026-05/);
    expect(dbMock.hourlyWorkerPayroll.update).not.toHaveBeenCalled();
  });

  it('拒绝历史遗留的未来月份记录被标记已发', async () => {
    dbMock.hourlyWorkerPayroll.findUnique.mockResolvedValue({
      workerId: 'worker-1',
      month: '2026-06',
      salaryRuleSnapshot: { workerType: WorkerType.CLEANER },
      worker: { displayName: '李师傅' },
    });

    await expect(
      markHourlyPayrollPaid(
        'p-1',
        true,
        new Date('2026-05-15T04:00:00.000Z'),
      ),
    ).rejects.toThrow(/当前或未来月份.*2026-06/);
    expect(dbMock.hourlyWorkerPayroll.update).not.toHaveBeenCalled();
  });

  it('clears paidAt on un-pay', async () => {
    // 当月的历史误发记录必须可撤销。
    await markHourlyPayrollPaid(
      'p-1',
      false,
      new Date('2026-05-15T04:00:00.000Z'),
    );
    const data = dbMock.hourlyWorkerPayroll.update.mock.calls[0][0].data;
    expect(data.isPaid).toBe(false);
    expect(data.paidAt).toBeNull();
  });

  it('keeps historical PACKER payroll immutable', async () => {
    dbMock.hourlyWorkerPayroll.findUnique.mockResolvedValue({
      workerId: 'worker-1',
      month: '2026-04',
      salaryRuleSnapshot: { workerType: WorkerType.PACKER },
      worker: { displayName: '打包阿姨' },
    });

    await expect(
      markHourlyPayrollPaid(
        'p-1',
        true,
        new Date('2026-06-01T09:00:00Z'),
      ),
    ).rejects.toThrow(/历史打包时薪快照只读/);
    expect(dbMock.hourlyWorkerPayroll.update).not.toHaveBeenCalled();
  });

  it('returns the trusted worker name for a persistent page receipt', async () => {
    const result = await markHourlyPayrollPaid(
      'p-1',
      false,
      new Date('2026-05-15T04:00:00.000Z'),
    );

    expect(result).toEqual({
      id: 'p-1',
      isPaid: true,
      workerName: '李师傅',
    });
    expect(
      dbMock.hourlyWorkerPayroll.findUnique.mock.calls[1][0].select.worker,
    ).toEqual({ select: { displayName: true } });
  });

  it('re-reads after the lock and refuses an attendance-invalidated payroll', async () => {
    dbMock.hourlyWorkerPayroll.findUnique
      .mockReset()
      .mockResolvedValueOnce({ workerId: 'worker-1', month: '2026-05' })
      .mockResolvedValueOnce(null);

    await expect(
      markHourlyPayrollPaid(
        'p-1',
        true,
        new Date('2026-06-01T09:00:00Z'),
      ),
    ).rejects.toThrow(/考勤已变更.*重新计算/);

    expect(dbMock.hourlyWorkerPayroll.update).not.toHaveBeenCalled();
    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.hourlyWorkerPayroll.findUnique.mock.invocationCallOrder[1]!,
    );
  });

  it('takes the per-(worker, month) advisory lock (Codex round 48 / P0)', async () => {
    // mark-paid must take the same lock as computeHourlyPayroll so a
    // concurrent recompute can't overwrite salary fields on a row
    // that's being marked paid.
    await markHourlyPayrollPaid('p-1', true);
    const sqlCalls = dbMock.$executeRaw.mock.calls;
    expect(sqlCalls.length).toBeGreaterThan(0);
    const sql = (sqlCalls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sqlCalls[0][1]).toMatch(
      /print-shop-erp:hourly:worker-1:2026-05/,
    );
    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.hourlyWorkerPayroll.findUnique.mock.invocationCallOrder[1]!,
    );
    expect(
      dbMock.hourlyWorkerPayroll.findUnique.mock.invocationCallOrder[1],
    ).toBeLessThan(dbMock.hourlyWorkerPayroll.update.mock.invocationCallOrder[0]!);
  });
});

describe('future-dated settlement guard (上海日历)', () => {
  // 未来月份的 Attendance 必然为空，而 COOK 的 monthlyBase 是整月 flat、
  // 不按天折算 —— 一次误操作就能凭空写出一整月厨师月固定工资。
  const FUTURE_MONTH = '2026-07';
  const NOW = new Date('2026-06-15T12:00:00Z');

  it('single path refuses a future month before touching the database', async () => {
    await expect(
      computeHourlyPayroll('worker-1', FUTURE_MONTH, NOW),
    ).rejects.toThrow(/未来月份/);
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
    expect(dbMock.hourlyWorkerPayroll.upsert).not.toHaveBeenCalled();
  });

  it('COOK: a future month cannot mint a whole month of COOK_MONTHLY base', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ workerType: WorkerType.COOK }),
    );
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue([]);

    await expect(
      computeHourlyPayroll('worker-1', FUTURE_MONTH, NOW),
    ).rejects.toThrow(/未来月份/);
    expect(dbMock.hourlyWorkerPayroll.upsert).not.toHaveBeenCalled();
  });

  it('still allows the current month (口径：只拒严格未来，别改成 >=)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue([]);

    await expect(
      computeHourlyPayroll('worker-1', '2026-06', NOW),
    ).resolves.toBeDefined();
    expect(dbMock.hourlyWorkerPayroll.upsert).toHaveBeenCalledTimes(1);
  });

  it('judges "future" on the Shanghai calendar, not UTC', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue([]);

    // UTC 2026-06-30T15:59:59Z = Shanghai 06-30 23:59:59 → 7 月仍是未来
    await expect(
      computeHourlyPayroll('worker-1', '2026-07', new Date('2026-06-30T15:59:59Z')),
    ).rejects.toThrow(/未来月份/);
    // UTC 2026-06-30T16:00:00Z = Shanghai 07-01 00:00 → 7 月已是当月
    await expect(
      computeHourlyPayroll('worker-1', '2026-07', new Date('2026-06-30T16:00:00Z')),
    ).resolves.toBeDefined();
  });

  it('batch aborts wholesale instead of reporting a per-worker error', async () => {
    let caught: unknown;
    try {
      await computeHourlyForAllInMonth(FUTURE_MONTH, NOW);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HourlyAggregateError);
    expect((caught as Error).message).toMatch(/未来月份/);
    expect(dbMock.user.findMany).not.toHaveBeenCalled();
  });
});

describe('computeHourlyPayroll — advisory lock + now pinning (Codex round 48)', () => {
  it('takes the per-(worker, month) advisory lock (P0)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue([]);
    await computeHourlyPayroll('worker-1', '2026-05');
    const sqlCalls = dbMock.$executeRaw.mock.calls;
    expect(sqlCalls.length).toBeGreaterThan(0);
    const sql = (sqlCalls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sqlCalls[0][1]).toMatch(
      /print-shop-erp:salary-identity:worker-1/,
    );
    expect(sqlCalls[1][1]).toMatch(
      /print-shop-erp:hourly:worker-1:2026-05/,
    );
    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.$executeRaw.mock.invocationCallOrder[1]!,
    );
    expect(dbMock.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
      dbMock.user.findUnique.mock.invocationCallOrder[0]!,
    );
    const sharedRuleLock = sqlCalls.find((call) =>
      (call[0] as TemplateStringsArray)
        .join('?')
        .includes('pg_advisory_xact_lock_shared'),
    );
    expect(sharedRuleLock?.[1]).toBe(
      'print-shop-erp:salary-rules:snapshot',
    );
  });

  it('pins all rule-resolution calls to the injected `now` (P1)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue([]);
    const now = new Date('2026-06-15T12:00:00Z');
    await computeHourlyPayroll('worker-1', '2026-05', now);
    // Every rule lookup inside computeHourlyPayroll must have used
    // `now` in its effectiveFrom.lte — if any call passes Date.now()
    // instead, it'll differ from `now`.
    for (const call of dbMock.salaryRule.findFirst.mock.calls) {
      expect(call[0].where.effectiveFrom.lte).toEqual(now);
    }
  });
});

describe('salary list pagination', () => {
  it.each([
    [undefined, undefined, 1, 50, 0],
    [['2', '9'], '20', 2, 20, 20],
    ['oops', '-2', 1, 1, 0],
    ['999', '999', 3, 100, 200],
  ])('parses page=%s pageSize=%s and bounds take/skip', async (page, pageSize, expectedPage, take, skip) => {
    dbMock.hourlyWorkerPayroll.count.mockResolvedValue(205);
    dbMock.hourlyWorkerPayroll.findMany.mockResolvedValue([]);
    const result = await listHourlyPayrolls({ page, pageSize });
    expect(result).toMatchObject({ page: expectedPage, pageSize: take, total: 205 });
    expect(dbMock.hourlyWorkerPayroll.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take, skip }));
  });
});

it('keeps whole-month recompute counts and sums across bounded batches and excludes historical packers', async () => {
  const batch = Array.from({ length: 100 }, (_, index) => ({
    id: `p-${index}`, workerId: `w-${index}`, totalSalary: '0.10', isPaid: false,
    salaryRuleSnapshot: { workerType: index === 0 ? WorkerType.PACKER : WorkerType.CLEANER },
    worker: { displayName: `师傅${index}` },
  }));
  dbMock.hourlyWorkerPayroll.findMany.mockResolvedValueOnce(batch).mockResolvedValueOnce([
    { ...batch[1], id: 'last', workerId: 'last-worker', totalSalary: '100.00', isPaid: true },
    { ...batch[1], id: 'unknown', workerId: 'unknown-worker', totalSalary: '0.20', salaryRuleSnapshot: {} },
  ]);
  const result = await getHourlyPayrollMonthContext('2026-05');
  expect(result.workerIds).toHaveLength(102);
  expect(result.context).toMatchObject({ existingRecordCount: 101, unpaidRecordCount: 100, paidRecordCount: 1, unpaidTotal: '10.10' });
  expect(result.context.sampleRows).toHaveLength(5);
  expect(dbMock.hourlyWorkerPayroll.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
    where: { month: '2026-05' }, take: 100, skip: 1, cursor: { id: 'p-99' },
  }));
});

it('keeps filtered owner totals independent of the visible page', async () => {
  dbMock.hourlyWorkerPayroll.count.mockResolvedValue(120);
  dbMock.hourlyWorkerPayroll.findMany.mockResolvedValue([]);
  dbMock.hourlyWorkerPayroll.aggregate
    .mockResolvedValueOnce({ _sum: { totalSalary: '1000.01' } })
    .mockResolvedValueOnce({ _sum: { totalSalary: null } });
  const result = await listHourlyPayrolls({ workerId: 'w1', isPaid: true, page: '2' });
  expect(result).toMatchObject({ total: 120, totalSalary: '1000.01', unpaidSalary: '0' });
  expect(dbMock.hourlyWorkerPayroll.aggregate).toHaveBeenNthCalledWith(1, { where: { workerId: 'w1', isPaid: true }, _sum: { totalSalary: true } });
  expect(dbMock.hourlyWorkerPayroll.aggregate).toHaveBeenNthCalledWith(2, { where: { AND: [{ workerId: 'w1', isPaid: true }, { isPaid: false }] }, _sum: { totalSalary: true } });
});
