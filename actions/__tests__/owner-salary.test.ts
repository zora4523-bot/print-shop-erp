import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '../../generated/prisma/client';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  salaryMock,
  csMock,
  revalidatePathMock,
  redirectMock,
  MockDailySalaryError,
  MockCsPeriodError,
  MockInvalidCsPeriodTransitionError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  salaryMock: {
    computeDailyWorkerSalary: vi.fn(),
    computeDailyForAllMachineWorkers: vi.fn(),
    markDailySalaryPaid: vi.fn(),
  },
  csMock: {
    startCsPeriod: vi.fn(),
    settleCsPeriod: vi.fn(),
    settleReadyCsPeriods: vi.fn(),
    markCsCommissionPaid: vi.fn(),
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
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/salary/daily', () => ({
  computeDailyWorkerSalary: salaryMock.computeDailyWorkerSalary,
  computeDailyForAllMachineWorkers: salaryMock.computeDailyForAllMachineWorkers,
  markDailySalaryPaid: salaryMock.markDailySalaryPaid,
  DailySalaryError: MockDailySalaryError,
}));
vi.mock('@/lib/salary/cs', () => ({
  startCsPeriod: csMock.startCsPeriod,
  settleCsPeriod: csMock.settleCsPeriod,
  settleReadyCsPeriods: csMock.settleReadyCsPeriods,
  markCsCommissionPaid: csMock.markCsCommissionPaid,
  CsPeriodError: MockCsPeriodError,
  InvalidCsPeriodTransitionError: MockInvalidCsPeriodTransitionError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  recomputeDailySalaryAction,
  setDailySalaryPaidAction,
  startCsPeriodAction,
  settleCsPeriodAction,
  settleReadyCsPeriodsAction,
  markCsCommissionPaidAction,
} from '../owner-salary';

const ownerActor = {
  id: 'owner-1',
  username: 'o',
  displayName: '老板',
  role: Role.OWNER,
  workerType: null,
  machineType: null,
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  salaryMock.computeDailyWorkerSalary.mockReset();
  salaryMock.computeDailyForAllMachineWorkers.mockReset();
  salaryMock.markDailySalaryPaid.mockReset();
  csMock.startCsPeriod.mockReset();
  csMock.settleCsPeriod.mockReset();
  csMock.settleReadyCsPeriods.mockReset();
  csMock.markCsCommissionPaid.mockReset();
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
    const r = await recomputeDailySalaryAction(null, { date: '2026/04/23' });
    expect(r.status).toBe('invalid');
  });

  it('rejects invalid calendar dates (2026-02-31 rollover) via strict schema (Codex round 43 / P1)', async () => {
    // Schema now does a full calendar-validity check, not just the
    // YYYY-MM-DD regex — matches shanghaiDayRange's behavior so the
    // action fails fast without hitting the lib.
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeDailySalaryAction(null, { date: '2026-02-31' });
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') {
      expect(r.fieldErrors.date?.[0]).toMatch(/合法日历日期/);
    }
  });

  it('rejects garbage string', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeDailySalaryAction(null, { date: 'not-a-date' });
    expect(r.status).toBe('invalid');
  });

  it('batch path: calls computeDailyForAllMachineWorkers when no workerId', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.computeDailyForAllMachineWorkers.mockResolvedValue([
      { workerId: 'w1' },
      { workerId: 'w2' },
    ]);
    const r = await recomputeDailySalaryAction(null, { date: '2026-04-23' });
    expect(r.status).toBe('success');
    if (r.status === 'success') {
      expect(r.workerCount).toBe(2);
      expect(r.date).toBe('2026-04-23');
    }
    expect(salaryMock.computeDailyWorkerSalary).not.toHaveBeenCalled();
  });

  it('single path: calls computeDailyWorkerSalary when workerId is provided', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.computeDailyWorkerSalary.mockResolvedValue({});
    const r = await recomputeDailySalaryAction(null, {
      date: '2026-04-23',
      workerId: 'worker-1',
    });
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
    const r = await recomputeDailySalaryAction(null, {
      date: '2026-04-23',
      workerId: 'worker-1',
    });
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toMatch(/机型/);
  });

  it('revalidates /owner/salary/daily on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.computeDailyForAllMachineWorkers.mockResolvedValue([]);
    await recomputeDailySalaryAction(null, { date: '2026-04-23' });
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/daily');
  });

  it('rejects workerId with path-injection characters', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeDailySalaryAction(null, {
      date: '2026-04-23',
      workerId: '../etc',
    });
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
    });
    await setDailySalaryPaidAction('ds-1', null, fd({ isPaid: 'on' }));
    expect(salaryMock.markDailySalaryPaid).toHaveBeenCalledWith('ds-1', true);
  });

  it('missing isPaid defaults to false (toggle off via empty POST)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.markDailySalaryPaid.mockResolvedValue({
      id: 'ds-1',
      isPaid: false,
    });
    await setDailySalaryPaidAction('ds-1', null, fd({}));
    expect(salaryMock.markDailySalaryPaid).toHaveBeenCalledWith('ds-1', false);
  });

  it('revalidates the list on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.markDailySalaryPaid.mockResolvedValue({
      id: 'ds-1',
      isPaid: true,
    });
    await setDailySalaryPaidAction('ds-1', null, fd({ isPaid: 'true' }));
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/daily');
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
  it('returns settledCount on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.settleReadyCsPeriods.mockResolvedValue([
      { periodId: 'p1' },
      { periodId: 'p2' },
    ]);
    const r = await settleReadyCsPeriodsAction();
    expect(r.status).toBe('success');
    if (r.status === 'success') expect(r.settledCount).toBe(2);
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/cs');
  });

  it('maps errors to { status: error }', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.settleReadyCsPeriods.mockRejectedValueOnce(
      new Error('db down'),
    );
    const r = await settleReadyCsPeriodsAction();
    expect(r.status).toBe('error');
  });
});

describe('markCsCommissionPaidAction', () => {
  it("first-line requirePermission('salary:view:all')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      markCsCommissionPaidAction('comm-1', null, fd({ isPaid: 'true' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('parses isPaid=true and calls markCsCommissionPaid', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.markCsCommissionPaid.mockResolvedValue({
      id: 'comm-1',
      isFullyPaid: true,
    });
    const r = await markCsCommissionPaidAction(
      'comm-1',
      null,
      fd({ isPaid: 'true' }),
    );
    expect(r.status).toBe('success');
    expect(csMock.markCsCommissionPaid).toHaveBeenCalledWith('comm-1', true);
  });

  it('maps CsPeriodError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    csMock.markCsCommissionPaid.mockRejectedValueOnce(
      new MockCsPeriodError('提成记录不存在'),
    );
    const r = await markCsCommissionPaidAction(
      'comm-1',
      null,
      fd({ isPaid: 'true' }),
    );
    expect(r.status).toBe('error');
  });
});
