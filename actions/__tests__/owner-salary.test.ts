import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  csMock,
  hourlyMock,
  revalidatePathMock,
  redirectMock,
  MockCsPeriodError,
  MockInvalidCsPeriodTransitionError,
  MockHourlyAggregateError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
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
  MockCsPeriodError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'CsPeriodError';
    }
  },
  MockInvalidCsPeriodTransitionError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'InvalidCsPeriodTransitionError';
    }
  },
  MockHourlyAggregateError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'HourlyAggregateError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
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

const fd = (data: Record<string, string>): FormData => {
  const formData = new FormData();
  for (const [key, value] of Object.entries(data)) formData.set(key, value);
  return formData;
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
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
    expect(redirectMock).toHaveBeenCalledWith('/owner/salary/cs/period-1?created=1');
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
      errors: [{ workerId: 'w3', message: '无当前生效的 CLEANER_HOURLY 规则' }],
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
