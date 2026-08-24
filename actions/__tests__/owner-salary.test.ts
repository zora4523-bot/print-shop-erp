import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  salaryMock,
  csMock,
  hourlyMock,
  revalidatePathMock,
  redirectMock,
  MockDailySalaryError,
  MockCsPeriodError,
  MockInvalidCsPeriodTransitionError,
  MockHourlyAggregateError,
  pieceworkAdminMock,
  auditMock,
  impactMock,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  salaryMock: {
    computeDailyWorkerSalary: vi.fn(),
    computeDailyForAllMachineWorkers: vi.fn(),
    markDailySalaryPaid: vi.fn(),
    addDailySalaryAdjustment: vi.fn(),
  },
  pieceworkAdminMock: {
    createWorkerMachineSalaryRule: vi.fn(),
    salaryAdjustmentInputSchema: { safeParse: vi.fn() },
    workerMachineRuleInputSchema: { safeParse: vi.fn() },
  },
  auditMock: { writeAuditLog: vi.fn() },
  impactMock: { getDailySalaryRecomputeImpact: vi.fn() },
  csMock: {
    startCsPeriod: vi.fn(),
    settleCsPeriod: vi.fn(),
    settleReadyCsPeriods: vi.fn(),
    recordCsPayrollPayment: vi.fn(),
  },
  hourlyMock: {
    computeHourlyPayroll: vi.fn(),
    computeHourlyForAllInMonth: vi.fn(),
    markHourlyPayrollPaid: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  MockDailySalaryError: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = 'DailySalaryError';
    }
  },
  MockCsPeriodError: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = 'CsPeriodError';
    }
  },
  MockInvalidCsPeriodTransitionError: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = 'InvalidCsPeriodTransitionError';
    }
  },
  MockHourlyAggregateError: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = 'HourlyAggregateError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/salary/daily', () => ({
  computeDailyWorkerSalary: salaryMock.computeDailyWorkerSalary,
  computeDailyForAllMachineWorkers: salaryMock.computeDailyForAllMachineWorkers,
  markDailySalaryPaid: salaryMock.markDailySalaryPaid,
  addDailySalaryAdjustment: salaryMock.addDailySalaryAdjustment,
  DailySalaryError: MockDailySalaryError,
}));
vi.mock('@/lib/salary/piecework-admin', () => ({
  createWorkerMachineSalaryRule:
    pieceworkAdminMock.createWorkerMachineSalaryRule,
  salaryAdjustmentInputSchema:
    pieceworkAdminMock.salaryAdjustmentInputSchema,
  workerMachineRuleInputSchema:
    pieceworkAdminMock.workerMachineRuleInputSchema,
  PieceworkRuleError: class extends Error {},
}));
vi.mock('@/lib/audit-log', () => ({
  writeAuditLog: auditMock.writeAuditLog,
}));
vi.mock('@/lib/salary/daily-recompute-impact', () => ({
  getDailySalaryRecomputeImpact:
    impactMock.getDailySalaryRecomputeImpact,
}));
vi.mock('@/lib/salary/cs', () => ({
  startCsPeriod: csMock.startCsPeriod,
  settleCsPeriod: csMock.settleCsPeriod,
  settleReadyCsPeriods: csMock.settleReadyCsPeriods,
  recordCsPayrollPayment: csMock.recordCsPayrollPayment,
  CsPeriodError: MockCsPeriodError,
  InvalidCsPeriodTransitionError: MockInvalidCsPeriodTransitionError,
}));
vi.mock('@/lib/salary/hourly-aggregate', () => ({
  computeHourlyPayroll: hourlyMock.computeHourlyPayroll,
  computeHourlyForAllInMonth: hourlyMock.computeHourlyForAllInMonth,
  markHourlyPayrollPaid: hourlyMock.markHourlyPayrollPaid,
  HourlyAggregateError: MockHourlyAggregateError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  recomputeDailySalaryAction,
  setDailySalaryPaidAction,
  addDailySalaryAdjustmentAction,
  startCsPeriodAction,
  settleCsPeriodAction,
  settleReadyCsPeriodsAction,
  recordCsPayrollPaymentAction,
  recomputeHourlyPayrollAction,
  setHourlyPayrollPaidAction,
} from '../owner-salary';

const ownerActor = {
  id: 'owner-1',
  username: 'o',
  displayName: '管理员',
  role: Role.ADMIN,
  workerType: null,
  machineType: null,
};

const confirmedRecompute = (
  overrides: Record<string, unknown> = {},
) => ({
  date: '2026-04-23',
  reason: '补报工后重新核对',
  confirmed: true,
  ...overrides,
});

const defaultRecomputeImpact = {
  candidateWorkerCount: 2,
  affectedWorkerCount: 1,
  createCount: 0,
  overwriteUnpaidCount: 1,
  paidSkippedCount: 1,
};

const matchingRecomputePreview = (
  overrides: Record<string, unknown> = {},
) => ({
  status: 'confirm' as const,
  date: '2026-04-23',
  reason: '',
  impact: defaultRecomputeImpact,
  ...overrides,
});

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  salaryMock.computeDailyWorkerSalary.mockReset();
  salaryMock.computeDailyForAllMachineWorkers.mockReset();
  salaryMock.markDailySalaryPaid.mockReset();
  salaryMock.addDailySalaryAdjustment.mockReset();
  pieceworkAdminMock.salaryAdjustmentInputSchema.safeParse.mockReset();
  auditMock.writeAuditLog.mockReset();
  impactMock.getDailySalaryRecomputeImpact
    .mockReset()
    .mockResolvedValue(defaultRecomputeImpact);
  auditMock.writeAuditLog.mockResolvedValue({ id: 'audit-1' });
  csMock.startCsPeriod.mockReset();
  csMock.settleCsPeriod.mockReset();
  csMock.settleReadyCsPeriods.mockReset();
  csMock.recordCsPayrollPayment.mockReset();
  hourlyMock.computeHourlyPayroll.mockReset();
  hourlyMock.computeHourlyForAllInMonth.mockReset();
  hourlyMock.markHourlyPayrollPaid.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockReset().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('recomputeDailySalaryAction', () => {
  it("first-line requirePermission('salary:rule:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      recomputeDailySalaryAction(null, { date: '2026-04-23' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'salary:rule:manage',
    );
  });

  it('rejects invalid date format', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeDailySalaryAction(
      null,
      confirmedRecompute({ date: '2026/04/23' }),
    );
    expect(r.status).toBe('invalid');
  });

  it('rejects invalid calendar dates (2026-02-31 rollover) via strict schema (Codex round 43 / P1)', async () => {
    // Schema now does a full calendar-validity check, not just the
    // YYYY-MM-DD regex — matches shanghaiDayRange's behavior so the
    // action fails fast without hitting the lib.
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeDailySalaryAction(
      null,
      confirmedRecompute({ date: '2026-02-31' }),
    );
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') {
      expect(r.fieldErrors.date?.[0]).toMatch(/合法日历日期/);
    }
  });

  it('rejects garbage string', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeDailySalaryAction(
      null,
      confirmedRecompute({ date: 'not-a-date' }),
    );
    expect(r.status).toBe('invalid');
  });

  it('allows the read-only impact preview without asking for a reason first', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeDailySalaryAction(null, {
      date: '2026-04-23',
      reason: '   ',
      confirmed: false,
    });

    expect(r).toEqual({
      status: 'confirm',
      date: '2026-04-23',
      reason: '',
      impact: expect.objectContaining({ affectedWorkerCount: 1 }),
    });
    expect(impactMock.getDailySalaryRecomputeImpact).toHaveBeenCalledWith(
      '2026-04-23',
      undefined,
    );
    expect(salaryMock.computeDailyForAllMachineWorkers).not.toHaveBeenCalled();
    expect(auditMock.writeAuditLog).not.toHaveBeenCalled();
  });

  it('server-side confirmed=true requires a 1–500 character reason before impact or writes', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);

    for (const reason of ['', '   ', 'x'.repeat(501)]) {
      const r = await recomputeDailySalaryAction(null, {
        date: '2026-04-23',
        reason,
        confirmed: true,
      });
      expect(r.status).toBe('invalid');
      if (r.status === 'invalid') {
        expect(r.fieldErrors.reason?.[0]).toMatch(/重算理由/);
      }
    }

    expect(impactMock.getDailySalaryRecomputeImpact).not.toHaveBeenCalled();
    expect(salaryMock.computeDailyForAllMachineWorkers).not.toHaveBeenCalled();
    expect(auditMock.writeAuditLog).not.toHaveBeenCalled();
  });

  it('does not let a direct confirmed=true request skip the server preview stage', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);

    const r = await recomputeDailySalaryAction(null, confirmedRecompute());

    expect(r).toEqual({
      status: 'confirm',
      date: '2026-04-23',
      reason: '补报工后重新核对',
      impact: defaultRecomputeImpact,
    });
    expect(salaryMock.computeDailyForAllMachineWorkers).not.toHaveBeenCalled();
    expect(auditMock.writeAuditLog).not.toHaveBeenCalled();
  });

  it('first submit returns affected/skipped counts without changing salary rows', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeDailySalaryAction(null, {
      date: '2026-04-23',
      reason: '补报工后重新核对',
      confirmed: false,
    });

    expect(r).toEqual({
      status: 'confirm',
      date: '2026-04-23',
      reason: '补报工后重新核对',
      impact: expect.objectContaining({
        affectedWorkerCount: 1,
        paidSkippedCount: 1,
      }),
    });
    expect(salaryMock.computeDailyForAllMachineWorkers).not.toHaveBeenCalled();
    expect(auditMock.writeAuditLog).not.toHaveBeenCalled();
  });

  it('recomputes server impact on confirmation instead of trusting the previous preview', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const freshImpact = {
      candidateWorkerCount: 4,
      affectedWorkerCount: 3,
      createCount: 2,
      overwriteUnpaidCount: 1,
      paidSkippedCount: 1,
    };
    impactMock.getDailySalaryRecomputeImpact.mockResolvedValueOnce(freshImpact);
    salaryMock.computeDailyForAllMachineWorkers.mockResolvedValue({
      settled: [{ workerId: 'w1' }],
      errors: [],
    });

    const r = await recomputeDailySalaryAction(
      {
        status: 'confirm',
        date: '2026-04-23',
        reason: '',
        impact: {
          candidateWorkerCount: 99,
          affectedWorkerCount: 99,
          createCount: 99,
          overwriteUnpaidCount: 0,
          paidSkippedCount: 0,
        },
      },
      confirmedRecompute(),
    );

    expect(impactMock.getDailySalaryRecomputeImpact).toHaveBeenCalledWith(
      '2026-04-23',
      undefined,
    );
    expect(r).toEqual({
      status: 'confirm',
      date: '2026-04-23',
      reason: '补报工后重新核对',
      impact: freshImpact,
    });
    expect(salaryMock.computeDailyForAllMachineWorkers).not.toHaveBeenCalled();
    expect(auditMock.writeAuditLog).not.toHaveBeenCalled();
  });

  it('binds a changed date and reason to a fresh server precheck, never to an old confirmation', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.computeDailyForAllMachineWorkers.mockResolvedValue({
      settled: [],
      errors: [],
    });

    const confirmedInput = {
      date: '2026-04-23',
      reason: '改为核对 4 月 23 日补报工',
      confirmed: true,
    };
    const refreshedPreview = await recomputeDailySalaryAction(
      {
        status: 'confirm',
        date: '2026-04-22',
        reason: '原先的重算理由',
        impact: {
          candidateWorkerCount: 8,
          affectedWorkerCount: 8,
          createCount: 8,
          overwriteUnpaidCount: 0,
          paidSkippedCount: 0,
        },
      },
      confirmedInput,
    );

    expect(impactMock.getDailySalaryRecomputeImpact).toHaveBeenCalledWith(
      '2026-04-23',
      undefined,
    );
    expect(refreshedPreview).toEqual({
      status: 'confirm',
      date: '2026-04-23',
      reason: '改为核对 4 月 23 日补报工',
      impact: defaultRecomputeImpact,
    });
    expect(salaryMock.computeDailyForAllMachineWorkers).not.toHaveBeenCalled();
    expect(auditMock.writeAuditLog).not.toHaveBeenCalled();

    const result = await recomputeDailySalaryAction(
      refreshedPreview,
      confirmedInput,
    );

    expect(result.status).toBe('success');
    expect(salaryMock.computeDailyForAllMachineWorkers).toHaveBeenCalledWith(
      '2026-04-23',
    );
    expect(auditMock.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: '2026-04-23',
        after: expect.objectContaining({
          reason: '改为核对 4 月 23 日补报工',
        }),
      }),
    );
  });

  it('batch path: calls computeDailyForAllMachineWorkers when no workerId', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.computeDailyForAllMachineWorkers.mockResolvedValue({
      settled: [{ workerId: 'w1' }, { workerId: 'w2' }],
      errors: [],
    });
    const r = await recomputeDailySalaryAction(
      matchingRecomputePreview(),
      confirmedRecompute(),
    );
    expect(r.status).toBe('success');
    if (r.status === 'success') {
      expect(r.workerCount).toBe(2);
      expect(r.date).toBe('2026-04-23');
    }
    expect(salaryMock.computeDailyWorkerSalary).not.toHaveBeenCalled();
    expect(auditMock.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ownerActor,
        action: 'SALARY_DAILY_RECOMPUTE',
        after: expect.objectContaining({ reason: '补报工后重新核对' }),
      }),
    );
  });

  it('single path: calls computeDailyWorkerSalary when workerId is provided', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.computeDailyWorkerSalary.mockResolvedValue({});
    const r = await recomputeDailySalaryAction(
      matchingRecomputePreview({ workerId: 'worker-1' }),
      confirmedRecompute({ workerId: 'worker-1' }),
    );
    expect(r.status).toBe('success');
    if (r.status === 'success') expect(r.workerCount).toBe(1);
    expect(salaryMock.computeDailyWorkerSalary).toHaveBeenCalledWith(
      'worker-1',
      '2026-04-23',
    );
  });

  it('maps DailySalaryError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.computeDailyWorkerSalary.mockRejectedValueOnce(
      new MockDailySalaryError('师傅未配置机型'),
    );
    const r = await recomputeDailySalaryAction(
      matchingRecomputePreview({ workerId: 'worker-1' }),
      confirmedRecompute({ workerId: 'worker-1' }),
    );
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toMatch(/机型/);
  });

  it('maps a batch-path DailySalaryError → error (future-date guard aborts wholesale)', async () => {
    // 未来日期的守卫落在 lib 层的批量入口上，会整批抛错而不是返回
    // { settled: [], errors: [...] } —— action 必须把它映射成
    // { status: 'error' }，而不是让它冒泡成 500。
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.computeDailyForAllMachineWorkers.mockRejectedValueOnce(
      new MockDailySalaryError('不能结算未来日期（2026-04-24，上海日历）：该日尚未开始'),
    );
    const r = await recomputeDailySalaryAction(
      matchingRecomputePreview(),
      confirmedRecompute(),
    );
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toMatch(/未来日期/);
  });

  it('revalidates /owner/salary/daily on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.computeDailyForAllMachineWorkers.mockResolvedValue({
      settled: [],
      errors: [],
    });
    await recomputeDailySalaryAction(
      matchingRecomputePreview(),
      confirmedRecompute(),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/daily');
  });

  it('rejects workerId with path-injection characters', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeDailySalaryAction(
      null,
      confirmedRecompute({ workerId: '../etc' }),
    );
    expect(r.status).toBe('invalid');
  });
});

const fd = (data: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

describe('setDailySalaryPaidAction', () => {
  it("first-line requirePermission('salary:view:all')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      setDailySalaryPaidAction('ds-1', null, fd({ isPaid: 'true' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'salary:view:all',
    );
  });

  it('parses HTML-checkbox isPaid=on as true', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.markDailySalaryPaid.mockResolvedValue({
      id: 'ds-1',
      isPaid: true,
      workerName: '张师傅',
    });
    // 成功后 action 走 redirect（把确认信息提升到页面级），测试里的
    // redirect mock 会抛 NEXT_REDIRECT，所以这里断言抛出而不是返回值。
    await expect(
      setDailySalaryPaidAction('ds-1', null, fd({ isPaid: 'on' })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(salaryMock.markDailySalaryPaid).toHaveBeenCalledWith('ds-1', true);
  });

  it('missing isPaid defaults to false (toggle off via empty POST)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.markDailySalaryPaid.mockResolvedValue({
      id: 'ds-1',
      isPaid: false,
      workerName: '张师傅',
    });
    await expect(
      setDailySalaryPaidAction('ds-1', null, fd({})),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(salaryMock.markDailySalaryPaid).toHaveBeenCalledWith('ds-1', false);
  });

  it('将当前日期禁付等已知业务错误返回给表单', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.markDailySalaryPaid.mockRejectedValue(
      new MockDailySalaryError(
        '不能将当前或未来日期的日薪标记为已发（2026-04-23）',
      ),
    );

    await expect(
      setDailySalaryPaidAction('ds-1', null, fd({ isPaid: 'true' })),
    ).resolves.toEqual({
      status: 'error',
      message: '不能将当前或未来日期的日薪标记为已发（2026-04-23）',
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('标记日薪已发时未知错误继续抛出', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const unexpected = new Error('database unavailable');
    salaryMock.markDailySalaryPaid.mockRejectedValue(unexpected);

    await expect(
      setDailySalaryPaidAction('ds-1', null, fd({ isPaid: 'true' })),
    ).rejects.toBe(unexpected);
  });

  it('returnTo 被限制在 /owner/salary/daily 前缀内（防开放重定向）', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.markDailySalaryPaid.mockResolvedValue({
      id: 'ds-1',
      isPaid: true,
      workerName: '张师傅',
    });
    // returnTo 是客户端提交的 hidden field，必须当不可信输入处理。
    await expect(
      setDailySalaryPaidAction(
        'ds-1',
        null,
        fd({ isPaid: 'true', returnTo: 'https://evil.example.com/steal' }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT:\/owner\/salary\/daily\?marked=/);
  });

  it('合法 returnTo 保留用户当前筛选', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.markDailySalaryPaid.mockResolvedValue({
      id: 'ds-1',
      isPaid: true,
      workerName: '张师傅',
    });
    await expect(
      setDailySalaryPaidAction(
        'ds-1',
        null,
        fd({
          isPaid: 'true',
          returnTo: '/owner/salary/daily?date=2026-04-23&paid=unpaid',
        }),
      ),
    ).rejects.toThrow(
      /NEXT_REDIRECT:\/owner\/salary\/daily\?date=2026-04-23&paid=unpaid&marked=/,
    );
  });

  it('revalidates the list on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.markDailySalaryPaid.mockResolvedValue({
      id: 'ds-1',
      isPaid: true,
      workerName: '张师傅',
    });
    await expect(
      setDailySalaryPaidAction('ds-1', null, fd({ isPaid: 'true' })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/daily');
  });
});

describe('addDailySalaryAdjustmentAction', () => {
  const idempotencyKey = '00000000-0000-4000-8000-000000000001';
  const parsedData = {
    idempotencyKey,
    dailySalaryId: 'ds-1',
    type: 'BONUS',
    amount: '20.00',
    reason: '急单奖励',
  };

  beforeEach(() => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    pieceworkAdminMock.salaryAdjustmentInputSchema.safeParse.mockReturnValue({
      success: true,
      data: parsedData,
    });
  });

  it('passes the browser request key into the append-only salary ledger', async () => {
    salaryMock.addDailySalaryAdjustment.mockResolvedValue({
      id: 'adjustment-1',
      amount: '20.00',
      adjustmentAmount: '20.00',
      actualSalary: '120.00',
    });

    const result = await addDailySalaryAdjustmentAction(
      'ds-1',
      null,
      fd({
        idempotencyKey,
        type: 'BONUS',
        amount: '20.00',
        reason: '急单奖励',
      }),
    );

    expect(result).toEqual({ status: 'success' });
    expect(salaryMock.addDailySalaryAdjustment).toHaveBeenCalledWith({
      ...parsedData,
      actor: ownerActor,
    });
    expect(auditMock.writeAuditLog).not.toHaveBeenCalled();
  });

  it('delegates an exact replay to the atomic domain command', async () => {
    salaryMock.addDailySalaryAdjustment.mockResolvedValue({
      id: 'adjustment-1',
      amount: '20.00',
      adjustmentAmount: '20.00',
      actualSalary: '120.00',
    });

    await addDailySalaryAdjustmentAction(
      'ds-1',
      null,
      fd({
        idempotencyKey,
        type: 'BONUS',
        amount: '20.00',
        reason: '急单奖励',
      }),
    );

    expect(salaryMock.addDailySalaryAdjustment).toHaveBeenCalledTimes(1);
    expect(auditMock.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe('startCsPeriodAction', () => {
  it("first-line requirePermission('salary:rule:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      startCsPeriodAction(null, {
        csUserId: 'cs-1',
        periodStart: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects invalid calendar dates via the strict schema', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await startCsPeriodAction(null, {
      csUserId: 'cs-1',
      periodStart: '2026-02-31',
    });
    expect(r.status).toBe('invalid');
  });

  it('rejects garbage csUserId', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await startCsPeriodAction(null, {
      csUserId: '../evil',
      periodStart: '2026-01-01',
    });
    expect(r.status).toBe('invalid');
  });

  it('success path: redirects to the new period detail', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.startCsPeriod.mockResolvedValue({
      id: 'period-1',
      periodStart: '2026-01-01',
      periodEnd: '2026-04-30',
    });
    await expect(
      startCsPeriodAction(null, {
        csUserId: 'cs-1',
        periodStart: '2026-01-01',
      }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/cs');
    expect(redirectMock).toHaveBeenCalledWith('/owner/salary/cs/period-1');
  });

  it('maps CsPeriodError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.startCsPeriod.mockRejectedValueOnce(
      new MockCsPeriodError('区间重叠'),
    );
    const r = await startCsPeriodAction(null, {
      csUserId: 'cs-1',
      periodStart: '2026-01-01',
    });
    expect(r.status).toBe('error');
  });

  it('parses empty optional strings as undefined (falls back to active rules)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.startCsPeriod.mockResolvedValue({
      id: 'period-1',
      periodStart: '2026-01-01',
      periodEnd: '2026-04-30',
    });
    await expect(
      startCsPeriodAction(null, {
        csUserId: 'cs-1',
        periodStart: '2026-01-01',
        durationMonths: '',
        initialSales: '',
        monthlyBase: '',
      }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    const payload = csMock.startCsPeriod.mock.calls[0][0];
    expect(payload.durationMonths).toBeUndefined();
    expect(payload.initialSales).toBeUndefined();
    expect(payload.monthlyBase).toBeUndefined();
  });
});

describe('settleCsPeriodAction', () => {
  it("first-line requirePermission('salary:rule:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(settleCsPeriodAction('period-1')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('forwards to settleCsPeriod and returns the breakdown', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.settleCsPeriod.mockResolvedValue({
      commissionId: 'comm-1',
      periodId: 'period-1',
      csUserId: 'cs-1',
      totalSales: '550000.00',
      tierRate: '0.0600',
      commissionAmount: '33000.00',
      monthlyBaseTotal: '8000.00',
      totalIncome: '41000.00',
      nextPeriodId: 'period-2',
    });
    const r = await settleCsPeriodAction('period-1');
    expect(r.status).toBe('success');
    if (r.status === 'success') {
      expect(r.commissionAmount).toBe('33000.00');
      expect(r.totalIncome).toBe('41000.00');
      expect(r.nextPeriodId).toBe('period-2');
    }
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/cs/period-1');
  });

  it('maps InvalidCsPeriodTransitionError → error (re-settle attempt)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.settleCsPeriod.mockRejectedValueOnce(
      new MockInvalidCsPeriodTransitionError('re-settle'),
    );
    const r = await settleCsPeriodAction('period-1');
    expect(r.status).toBe('error');
  });
});

describe('settleReadyCsPeriodsAction', () => {
  it('returns settledCount + errorCount on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.settleReadyCsPeriods.mockResolvedValue({
      settled: [{ periodId: 'p1' }, { periodId: 'p2' }],
      errors: [],
    });
    const r = await settleReadyCsPeriodsAction();
    expect(r.status).toBe('success');
    if (r.status === 'success') {
      expect(r.settledCount).toBe(2);
      expect(r.errorCount).toBe(0);
      expect(r.errors).toEqual([]);
    }
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/cs');
  });

  it('surfaces per-period errors from the batch (Codex round 45 / P1)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.settleReadyCsPeriods.mockResolvedValue({
      settled: [{ periodId: 'p1' }],
      errors: [
        { periodId: 'p2', message: '无当前生效的 CS_TIERS 规则' },
      ],
    });
    const r = await settleReadyCsPeriodsAction();
    expect(r.status).toBe('success');
    if (r.status === 'success') {
      expect(r.settledCount).toBe(1);
      expect(r.errorCount).toBe(1);
      expect(r.errors[0].periodId).toBe('p2');
    }
  });

  it('maps a known CsPeriodError to { status: error }', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.settleReadyCsPeriods.mockRejectedValueOnce(
      new MockCsPeriodError('结算冲突'),
    );
    const r = await settleReadyCsPeriodsAction();
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toBe('结算冲突');
  });

  it('rethrows an unknown error instead of swallowing it into a toast (→ Sentry)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.settleReadyCsPeriods.mockRejectedValueOnce(new Error('db down'));
    // Unknown errors must bubble to Next onRequestError → Sentry, not be
    // returned as a graceful { status: 'error' } that hides the fault.
    await expect(settleReadyCsPeriodsAction()).rejects.toThrow('db down');
  });
});

describe('recordCsPayrollPaymentAction', () => {
  const paymentForm = () =>
    fd({
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      baseAmount: '2000.00',
      commissionAmount: '0',
      paidAt: '2026-05-01T10:30',
    });

  it("first-line requirePermission('salary:view:all')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      recordCsPayrollPaymentAction('period-1', null, paymentForm()),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('records a partial bottom-salary payment and refreshes the detail', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.recordCsPayrollPayment.mockResolvedValue({
      paymentId: 'payment-1',
      paidBase: '2000.00',
      paidCommission: '0.00',
      isFullyPaid: false,
    });
    const r = await recordCsPayrollPaymentAction(
      'period-1',
      null,
      paymentForm(),
    );
    expect(r.status).toBe('success');
    expect(csMock.recordCsPayrollPayment).toHaveBeenCalledWith(
      'period-1',
      expect.objectContaining({
        baseAmount: '2000.00',
        commissionAmount: '0',
      }),
      expect.objectContaining({ id: 'owner-1' }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/salary/cs/period-1',
    );
  });

  it('maps CsPeriodError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.recordCsPayrollPayment.mockRejectedValueOnce(
      new MockCsPeriodError('发放金额超出剩余金额'),
    );
    const r = await recordCsPayrollPaymentAction(
      'period-1',
      null,
      paymentForm(),
    );
    expect(r.status).toBe('error');
  });

  it('rejects an empty zero-value payment at the action boundary', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recordCsPayrollPaymentAction(
      'period-1',
      null,
      fd({
        idempotencyKey: '00000000-0000-4000-8000-000000000001',
        baseAmount: '',
        commissionAmount: '',
        paidAt: '2026-05-01T10:30',
      }),
    );
    expect(r.status).toBe('invalid');
    expect(csMock.recordCsPayrollPayment).not.toHaveBeenCalled();
  });
});

describe('recomputeHourlyPayrollAction', () => {
  it("first-line requirePermission('salary:rule:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      recomputeHourlyPayrollAction(null, { month: '2026-05' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects bad month format (schema)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeHourlyPayrollAction(null, { month: '2026/05' });
    expect(r.status).toBe('invalid');
  });

  it('rejects invalid month (13+)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeHourlyPayrollAction(null, { month: '2026-13' });
    expect(r.status).toBe('invalid');
  });

  it('single-worker path calls computeHourlyPayroll', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    hourlyMock.computeHourlyPayroll.mockResolvedValue({});
    const r = await recomputeHourlyPayrollAction(null, {
      month: '2026-05',
      workerId: 'worker-1',
    });
    expect(r.status).toBe('success');
    if (r.status === 'success') {
      expect(r.workerCount).toBe(1);
      expect(r.month).toBe('2026-05');
    }
    expect(hourlyMock.computeHourlyPayroll).toHaveBeenCalledWith(
      'worker-1',
      '2026-05',
    );
  });

  it('batch path calls computeHourlyForAllInMonth and forwards errors', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    hourlyMock.computeHourlyForAllInMonth.mockResolvedValue({
      settled: [{ workerId: 'w1' }, { workerId: 'w2' }],
      errors: [{ workerId: 'w3', message: '无当前生效的 PACKER_HOURLY 规则' }],
    });
    const r = await recomputeHourlyPayrollAction(null, { month: '2026-05' });
    expect(r.status).toBe('success');
    if (r.status === 'success') {
      expect(r.workerCount).toBe(2);
      expect(r.errorCount).toBe(1);
      expect(r.errors[0].workerId).toBe('w3');
    }
  });

  it('maps HourlyAggregateError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    hourlyMock.computeHourlyPayroll.mockRejectedValueOnce(
      new MockHourlyAggregateError('已标记发放'),
    );
    const r = await recomputeHourlyPayrollAction(null, {
      month: '2026-05',
      workerId: 'worker-1',
    });
    expect(r.status).toBe('error');
  });

  it('maps a batch-path HourlyAggregateError → error (future-month guard aborts wholesale)', async () => {
    // 同 daily 那条：月份错是整批的输入错，lib 层整批抛 HourlyAggregateError。
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    hourlyMock.computeHourlyForAllInMonth.mockRejectedValueOnce(
      new MockHourlyAggregateError('不能结算未来月份（2026-07，上海日历）：该月尚未开始'),
    );
    const r = await recomputeHourlyPayrollAction(null, { month: '2026-05' });
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toMatch(/未来月份/);
  });

  it('revalidates /owner/salary/hourly on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    hourlyMock.computeHourlyForAllInMonth.mockResolvedValue({
      settled: [],
      errors: [],
    });
    await recomputeHourlyPayrollAction(null, { month: '2026-05' });
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/hourly');
  });
});

describe('setHourlyPayrollPaidAction', () => {
  it("first-line requirePermission('salary:view:all')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      setHourlyPayrollPaidAction('p-1', null, fd({ isPaid: 'true' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'salary:view:all',
    );
  });

  it('parses checkbox on=true and forwards', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    hourlyMock.markHourlyPayrollPaid.mockResolvedValue({
      id: 'p-1',
      isPaid: true,
      workerName: '李师傅',
    });
    await expect(
      setHourlyPayrollPaidAction('p-1', null, fd({ isPaid: 'on' })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(hourlyMock.markHourlyPayrollPaid).toHaveBeenCalledWith('p-1', true);
  });

  it('missing field defaults to false (unpaid)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    hourlyMock.markHourlyPayrollPaid.mockResolvedValue({
      id: 'p-1',
      isPaid: false,
      workerName: '李师傅',
    });
    await expect(
      setHourlyPayrollPaidAction('p-1', null, fd({})),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(hourlyMock.markHourlyPayrollPaid).toHaveBeenCalledWith('p-1', false);
  });

  it('保留时薪筛选并把可信人员名提升为页面级回执', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    hourlyMock.markHourlyPayrollPaid.mockResolvedValue({
      id: 'p-1',
      isPaid: true,
      workerName: '李师傅',
    });

    await expect(
      setHourlyPayrollPaidAction(
        'p-1',
        null,
        fd({
          isPaid: 'true',
          returnTo: '/owner/salary/hourly?month=2026-07&paid=unpaid',
        }),
      ),
    ).rejects.toThrow(
      /NEXT_REDIRECT:\/owner\/salary\/hourly\?month=2026-07&paid=unpaid&marked=/,
    );
  });

  it('拒绝把时薪 returnTo 当成开放重定向', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    hourlyMock.markHourlyPayrollPaid.mockResolvedValue({
      id: 'p-1',
      isPaid: true,
      workerName: '李师傅',
    });

    await expect(
      setHourlyPayrollPaidAction(
        'p-1',
        null,
        fd({
          isPaid: 'true',
          returnTo: 'https://evil.example.com/steal',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT:\/owner\/salary\/hourly\?marked=/);
  });

  it('将当前月禁付等已知业务错误返回给表单', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    hourlyMock.markHourlyPayrollPaid.mockRejectedValue(
      new MockHourlyAggregateError(
        '不能将当前或未来月份的月结标记为已发（2026-05）',
      ),
    );

    await expect(
      setHourlyPayrollPaidAction('p-1', null, fd({ isPaid: 'true' })),
    ).resolves.toEqual({
      status: 'error',
      message: '不能将当前或未来月份的月结标记为已发（2026-05）',
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('标记月结已发时未知错误继续抛出', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const unexpected = new Error('database unavailable');
    hourlyMock.markHourlyPayrollPaid.mockRejectedValue(unexpected);

    await expect(
      setHourlyPayrollPaidAction('p-1', null, fd({ isPaid: 'true' })),
    ).rejects.toBe(unexpected);
  });
});
