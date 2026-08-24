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
  markHourlyPayrollPaid,
} from '../hourly-aggregate';

const PACKER_RULES: Record<string, unknown> = {
  PACKER_HOURLY: { hourlyRate: 11 },
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

function workerFixture(overrides: Partial<{ workerType: WorkerType | null; isActive: boolean; role: Role }> = {}) {
  return {
    id: 'worker-1',
    role: Role.WORKER,
    workerType: WorkerType.PACKER,
    isActive: true,
    displayName: '打包阿姨',
    ...overrides,
  };
}

function setupAllRules(byKey: Record<string, unknown> = PACKER_RULES): void {
  dbMock.salaryRule.findFirst.mockImplementation(async (args: {
    where: { ruleType: SalaryRuleType; ruleKey: string };
  }) => {
    const v = byKey[args.where.ruleKey];
    return v === undefined ? null : { ruleValue: v };
  });
}

beforeEach(() => {
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
    ).rejects.toThrow(/仅时薪工.*走月结/);
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
  ])('uses the historical PACKER snapshot after the account is %s', async (_label, currentWorker) => {
    dbMock.user.findUnique.mockResolvedValue(currentWorker);
    setupAllRules();
    dbMock.attendance.findMany.mockResolvedValue([
      {
        date: new Date('2026-05-01'),
        normalHours: '8',
        otHours: '2',
        spareHours: '0',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.PACKER,
      },
    ]);

    await expect(
      computeHourlyPayroll('worker-1', '2026-05'),
    ).resolves.toMatchObject({
      workerType: WorkerType.PACKER,
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
        workerTypeSnapshot: WorkerType.PACKER,
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
});

describe('computeHourlyPayroll — PACKER', () => {
  beforeEach(() => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
    setupAllRules();
  });

  it('SPEC §7.4 reproduction: 22日×8h normal + 12h ot × 11 × 1.0 = 2068', async () => {
    // 22 days × 8 hours = 176 normal, 12 ot
    dbMock.attendance.findMany.mockResolvedValue(
      Array.from({ length: 22 }, (_, i) => ({
        date: new Date(Date.UTC(2026, 4, i + 1)),
        normalHours: '8.00',
        otHours: i < 12 ? '1.00' : '0.00',
        spareHours: '0.00',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.PACKER,
      })),
    );
    const r = await computeHourlyPayroll('worker-1', '2026-05');
    expect(r.totalNormalHours).toBe('176.00');
    expect(r.totalOtHours).toBe('12.00');
    expect(r.baseSalary).toBe('1936.00'); // 176 × 11
    expect(r.otSalary).toBe('132.00'); // 12 × 11 × 1.0
    expect(r.spareSalary).toBe('0.00');
    expect(r.totalSalary).toBe('2068.00');
  });

  it('refuses when PACKER_HOURLY is unset', async () => {
    setupAllRules({
      OT_MULTIPLIER: { multiplier: 1.0 },
    });
    dbMock.attendance.findMany.mockResolvedValue([]);
    await expect(
      computeHourlyPayroll('worker-1', '2026-05'),
    ).rejects.toThrow(/PACKER_HOURLY/);
  });

  it('defaults otMultiplier to 1.0 when OT_MULTIPLIER rule missing', async () => {
    setupAllRules({
      PACKER_HOURLY: { hourlyRate: 11 },
    });
    dbMock.attendance.findMany.mockResolvedValue([
      {
        date: new Date('2026-05-01'),
        normalHours: '8',
        otHours: '2',
        spareHours: '0',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.PACKER,
      },
    ]);
    const r = await computeHourlyPayroll('worker-1', '2026-05');
    expect(r.otMultiplier).toBe('1.00');
    // 8×11 + 2×11×1.0 = 88+22 = 110
    expect(r.totalSalary).toBe('110.00');
  });

  it('persists a total equal to the sum of independently rounded components', async () => {
    setupAllRules({
      ...PACKER_RULES,
      PACKER_HOURLY: { hourlyRate: 11.11 },
    });
    dbMock.attendance.findMany.mockResolvedValue([
      {
        date: new Date('2026-05-01'),
        normalHours: '0.5',
        otHours: '0.5',
        spareHours: '0',
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.PACKER,
      },
    ]);

    const r = await computeHourlyPayroll('worker-1', '2026-05');
    const data = dbMock.hourlyWorkerPayroll.upsert.mock.calls[0][0].create;

    expect(r.baseSalary).toBe('5.56');
    expect(r.otSalary).toBe('5.56');
    expect(r.totalSalary).toBe('11.12');
    expect(data.baseSalary).toBe('5.56');
    expect(data.otSalary).toBe('5.56');
    expect(data.totalSalary).toBe('11.12');
  });

  it('snapshots full rule context including WORK_HOURS + OT multiplier', async () => {
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
    await computeHourlyPayroll('worker-1', '2026-05');
    const data = dbMock.hourlyWorkerPayroll.upsert.mock.calls[0][0].create;
    const snap = data.salaryRuleSnapshot;
    expect(snap.workerType).toBe(WorkerType.PACKER);
    expect(snap.packerHourlyRate).toBe(11);
    expect(snap.otMultiplier).toBe(1.0);
    expect(snap.workHours).toEqual({
      morning: { start: '08:00', end: '12:00' },
      afternoon: { start: '13:30', end: '17:30' },
      otStart: '18:00',
    });
    expect(snap.totals).toEqual({
      normalHours: '8.00',
      otHours: '0.00',
      spareHours: '0.00',
    });
  });
});

describe('computeHourlyPayroll — CLEANER', () => {
  it('uses CLEANER_HOURLY rule (independent from PACKER)', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ workerType: WorkerType.CLEANER }),
    );
    setupAllRules({
      PACKER_HOURLY: { hourlyRate: 11 },
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
        return workerFixture({ workerType: WorkerType.PACKER });
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

  it('filter restricts to hourly worker types (PACKER / CLEANER / COOK)', async () => {
    dbMock.user.findMany.mockResolvedValue([]);
    await computeHourlyForAllInMonth('2026-05');
    const where = dbMock.user.findMany.mock.calls[0][0].where;
    expect(where.OR[0].workerType.in).toEqual([
      WorkerType.PACKER,
      WorkerType.CLEANER,
      WorkerType.COOK,
    ]);
    expect(where.OR[1].attendanceRecords.some).toMatchObject({
      roleSnapshot: Role.WORKER,
      workerTypeSnapshot: {
        in: [WorkerType.PACKER, WorkerType.CLEANER, WorkerType.COOK],
      },
    });
  });

  it('rethrows an unexpected worker failure with committed partial results', async () => {
    const databaseFailure = new Error('connection lost');
    dbMock.user.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);
    dbMock.user.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        if (where.id === 'w2') throw databaseFailure;
        return workerFixture({ workerType: WorkerType.PACKER });
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
        workerTypeSnapshot: WorkerType.PACKER,
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
    // Six rule keys are resolved once for the whole batch, not once per
    // worker. This is what prevents an admin edit between w1 and w2 from
    // changing only half of one settlement run.
    expect(dbMock.salaryRule.findFirst).toHaveBeenCalledTimes(6);
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
        workerTypeSnapshot: WorkerType.PACKER,
      },
    ]);

    const result = await computeHourlyForAllInMonth('2026-05');

    expect(result.settled).toEqual([
      expect.objectContaining({
        workerId: 'former-worker',
        workerType: WorkerType.PACKER,
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

    expect(rows[0].payrollWorkerType).toBe(WorkerType.PACKER);
    expect(dbMock.hourlyWorkerPayroll.findMany.mock.calls[0][0].select.worker)
      .toEqual({ select: { displayName: true } });
  });
});

describe('markHourlyPayrollPaid', () => {
  beforeEach(() => {
    dbMock.hourlyWorkerPayroll.findUnique.mockResolvedValue({
      workerId: 'worker-1',
      month: '2026-05',
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
      /print-shop-erp:hourly:worker-1:2026-05/,
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
