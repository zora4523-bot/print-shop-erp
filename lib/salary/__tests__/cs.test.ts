import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Role,
  SalaryPeriodStatus,
} from '../../../generated/prisma/enums';

const {
  dbMock,
  enqueueNotificationInTransactionMock,
  dispatchNotificationMock,
} = vi.hoisted(() => {
  const mock = {
    user: { findUnique: vi.fn() },
    salaryRule: { findFirst: vi.fn() },
    salaryPeriod: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    customerServiceCommission: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    csPayrollPayment: {
      findUnique: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(mock);
      return fn;
    }),
  };
  return {
    dbMock: mock,
    enqueueNotificationInTransactionMock: vi.fn(),
    dispatchNotificationMock: vi.fn(),
  };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: dispatchNotificationMock,
}));
vi.mock('@/lib/notification/transactional-outbox', () => ({
  enqueueNotificationInTransaction: enqueueNotificationInTransactionMock,
}));

import {
  computePeriodEnd,
  startCsPeriod,
  settleCsPeriod,
  settleReadyCsPeriods,
  recordCsPayrollPayment,
  CsBatchUnexpectedError,
  CsPeriodError,
} from '../cs';
import { InvalidCsPeriodTransitionError } from '../cs/status-machine';

const BASE_RULE_VALUE = { monthlyBase: 2000 };
const PERIOD_RULE_VALUE = { months: 4 };
const TIERS_RULE_VALUE = {
  mode: 'FLAT',
  tiers: [
    { minSales: 100000, rate: 0.01 },
    { minSales: 200000, rate: 0.02 },
    { minSales: 300000, rate: 0.03 },
    { minSales: 400000, rate: 0.045 },
    { minSales: 500000, rate: 0.06 },
  ],
};

beforeEach(() => {
  enqueueNotificationInTransactionMock.mockReset().mockResolvedValue(false);
  dispatchNotificationMock.mockReset().mockResolvedValue(undefined);
  dbMock.user.findUnique.mockReset().mockResolvedValue({
    id: 'cs-1',
    role: Role.CUSTOMER_SERVICE,
    isActive: true,
    employmentStartDate: null,
    employmentEndDate: null,
  });
  dbMock.salaryRule.findFirst.mockReset();
  dbMock.salaryPeriod.findFirst.mockReset().mockResolvedValue(null);
  dbMock.salaryPeriod.findUnique.mockReset();
  dbMock.salaryPeriod.findMany.mockReset();
  dbMock.salaryPeriod.create.mockReset();
  dbMock.salaryPeriod.update.mockReset();
  dbMock.customerServiceCommission.findUnique.mockReset();
  dbMock.customerServiceCommission.create.mockReset();
  dbMock.customerServiceCommission.update.mockReset();
  dbMock.csPayrollPayment.findUnique.mockReset().mockResolvedValue(null);
  dbMock.csPayrollPayment.aggregate.mockReset().mockResolvedValue({
    _sum: { baseAmount: null, commissionAmount: null },
    _max: { paidAt: null },
  });
  dbMock.csPayrollPayment.create
    .mockReset()
    .mockResolvedValue({ id: 'pay-1' });
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
    if (typeof fn === 'function') {
      return await (fn as (tx: unknown) => unknown)(dbMock);
    }
    return fn;
  });
  // Default: all three CS rules resolve to seed values.
  dbMock.salaryRule.findFirst.mockImplementation(async (args: {
    where: { ruleKey: string };
  }) => {
    const map: Record<string, unknown> = {
      CS_BASE_SALARY: BASE_RULE_VALUE,
      CS_PERIOD_LENGTH: PERIOD_RULE_VALUE,
      CS_TIERS: TIERS_RULE_VALUE,
    };
    const ruleValue = map[args.where.ruleKey];
    return ruleValue ? { ruleValue } : null;
  });
});

describe('computePeriodEnd', () => {
  it('SPEC §7.3: 2026-01-01 + 4 months → 2026-04-30', () => {
    const start = new Date(Date.UTC(2026, 0, 1)); // Jan 1
    const end = computePeriodEnd(start, 4);
    expect(end.toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('clamps February boundary (Jan 31 + 1 month → Feb 28 in non-leap)', () => {
    const start = new Date(Date.UTC(2026, 0, 31));
    const end = computePeriodEnd(start, 1);
    // Jan 31 + 1 month → Feb 28 (candidate would be Mar 3, clamped
    // to last day of February), then minus 1 day = Feb 27? No:
    // addMonthsUtc returns Feb 28 in non-leap. Then -1 day = Feb 27.
    // This is the CORRECT semantic — "one calendar month ending
    // at the end of Feb".
    expect(end.toISOString().slice(0, 10)).toBe('2026-02-27');
  });

  it('leap-year Feb (2024): Jan 31 + 1 month → Feb 29 candidate, -1 → Feb 28', () => {
    const start = new Date(Date.UTC(2024, 0, 31));
    const end = computePeriodEnd(start, 1);
    expect(end.toISOString().slice(0, 10)).toBe('2024-02-28');
  });
});

describe('startCsPeriod', () => {
  const csUser = {
    id: 'cs-1',
    role: Role.CUSTOMER_SERVICE,
    isActive: true,
    employmentStartDate: null,
    employmentEndDate: null,
  };

  it('rejects an invalid calendar date (2026-02-31)', async () => {
    await expect(
      startCsPeriod({
        csUserId: 'cs-1',
        periodStart: '2026-02-31',
      }),
    ).rejects.toThrow(/周期起始日期非法/);
  });

  it('rejects a non-CUSTOMER_SERVICE user', async () => {
    dbMock.user.findUnique.mockResolvedValue({
      ...csUser,
      role: Role.SALES,
    });
    await expect(
      startCsPeriod({
        csUserId: 'cs-1',
        periodStart: '2026-01-01',
      }),
    ).rejects.toThrow(/不是客服/);
  });

  it('rejects an inactive CUSTOMER_SERVICE user', async () => {
    dbMock.user.findUnique.mockResolvedValue({ ...csUser, isActive: false });
    await expect(
      startCsPeriod({
        csUserId: 'cs-1',
        periodStart: '2026-01-01',
      }),
    ).rejects.toThrow(/已停用/);
    expect(dbMock.salaryPeriod.create).not.toHaveBeenCalled();
  });

  it('creates IN_PROGRESS period with seed rules (SPEC §7.3 defaults)', async () => {
    dbMock.user.findUnique.mockResolvedValue(csUser);
    dbMock.salaryPeriod.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'period-1',
      csUserId: data.csUserId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      durationMonths: data.durationMonths,
      monthlyBase: data.monthlyBase,
      initialSales: data.initialSales,
    }));
    const r = await startCsPeriod({
      csUserId: 'cs-1',
      periodStart: '2026-01-01',
    });
    expect(r.periodStart).toBe('2026-01-01');
    expect(r.periodEnd).toBe('2026-04-30');
    expect(r.durationMonths).toBe(4);
    expect(r.monthlyBase).toBe('2000.00');
    expect(r.initialSales).toBe('0.00');
  });

  it('honors monthlyBase / durationMonths / initialSales overrides (import path, SPEC §5.5)', async () => {
    dbMock.user.findUnique.mockResolvedValue(csUser);
    dbMock.salaryPeriod.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'period-1',
      csUserId: data.csUserId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      durationMonths: data.durationMonths,
      monthlyBase: data.monthlyBase,
      initialSales: data.initialSales,
    }));
    const r = await startCsPeriod({
      csUserId: 'cs-1',
      periodStart: '2026-02-01',
      durationMonths: 3, // override
      initialSales: 230000, // SPEC §5.5 example
      monthlyBase: 2500, // owner-specified override
    });
    expect(r.initialSales).toBe('230000.00');
    expect(r.monthlyBase).toBe('2500.00');
    expect(r.durationMonths).toBe(3);
    // start 2026-02-01 + 3 months = 2026-05-01, end = 2026-04-30
    expect(r.periodEnd).toBe('2026-04-30');
  });

  it('allows full first/last employment months but rejects wholly disjoint CS periods', async () => {
    dbMock.user.findUnique.mockResolvedValue({
      ...csUser,
      employmentStartDate: new Date('2026-08-15T00:00:00.000Z'),
      employmentEndDate: new Date('2026-10-15T00:00:00.000Z'),
    });
    dbMock.salaryPeriod.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'period-employment',
        ...data,
      }),
    );

    await expect(
      startCsPeriod({
        csUserId: 'cs-1',
        periodStart: '2026-08-01',
        durationMonths: 3,
      }),
    ).resolves.toMatchObject({
      periodStart: '2026-08-01',
      periodEnd: '2026-10-31',
      durationMonths: 3,
    });

    for (const periodStart of ['2026-07-01', '2026-11-01']) {
      await expect(
        startCsPeriod({
          csUserId: 'cs-1',
          periodStart,
          durationMonths: 1,
        }),
      ).rejects.toThrow(/雇佣起止月份/);
    }
  });

  it('stores the maximum CS base multiplied by 24 months in Decimal(12,2)', async () => {
    dbMock.user.findUnique.mockResolvedValue(csUser);
    dbMock.salaryPeriod.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'period-max-base',
        ...data,
      }),
    );

    await expect(
      startCsPeriod({
        csUserId: 'cs-1',
        periodStart: '2026-01-01',
        durationMonths: 24,
        monthlyBase: '99999999.99',
      }),
    ).resolves.toBeDefined();
    expect(dbMock.salaryPeriod.create).toHaveBeenCalledOnce();
  });

  it('rejects fractional-cent import values at the domain boundary', async () => {
    await expect(
      startCsPeriod({
        csUserId: 'cs-1',
        periodStart: '2026-02-01',
        initialSales: '1.001',
      }),
    ).rejects.toThrow(/两位小数/);
    await expect(
      startCsPeriod({
        csUserId: 'cs-1',
        periodStart: '2026-02-01',
        monthlyBase: '2000.001',
      }),
    ).rejects.toThrow(/两位小数/);
    expect(dbMock.salaryPeriod.create).not.toHaveBeenCalled();
  });

  it.each([
    ['not-money', /规则金额非法/],
    ['-1', /超出可保存的金额范围/],
    ['2000.001', /超出可保存的金额范围/],
    ['100000000.00', /超出可保存的金额范围/],
  ])(
    'rejects an invalid rule-derived monthly base: %s',
    async (monthlyBase, expectedMessage) => {
      dbMock.salaryRule.findFirst.mockImplementation(async (args: {
        where: { ruleKey: string };
      }) => {
        if (args.where.ruleKey === 'CS_BASE_SALARY') {
          return { ruleValue: { monthlyBase } };
        }
        if (args.where.ruleKey === 'CS_PERIOD_LENGTH') {
          return { ruleValue: PERIOD_RULE_VALUE };
        }
        return null;
      });

      await expect(
        startCsPeriod({
          csUserId: 'cs-1',
          periodStart: '2026-02-01',
        }),
      ).rejects.toThrow(expectedMessage);
      expect(dbMock.salaryPeriod.create).not.toHaveBeenCalled();
    },
  );

  it.each([25, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an out-of-range period length from the rule: %s',
    async (months) => {
      dbMock.salaryRule.findFirst.mockImplementation(async (args: {
        where: { ruleKey: string };
      }) => {
        if (args.where.ruleKey === 'CS_BASE_SALARY') {
          return { ruleValue: BASE_RULE_VALUE };
        }
        if (args.where.ruleKey === 'CS_PERIOD_LENGTH') {
          return { ruleValue: { months } };
        }
        return null;
      });

      await expect(
        startCsPeriod({
          csUserId: 'cs-1',
          periodStart: '2026-02-01',
        }),
      ).rejects.toThrow(/周期月数必须是 1 到 24 的整数/);
      expect(dbMock.salaryPeriod.create).not.toHaveBeenCalled();
    },
  );

  it('imports already-paid base months as an immutable opening payment', async () => {
    dbMock.user.findUnique.mockResolvedValue(csUser);
    dbMock.salaryPeriod.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'period-1',
        csUserId: data.csUserId,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        durationMonths: data.durationMonths,
        monthlyBase: data.monthlyBase,
        initialSales: data.initialSales,
      }),
    );
    const now = new Date('2026-04-01T00:00:00Z');
    await startCsPeriod(
      {
        csUserId: 'cs-1',
        periodStart: '2026-01-01',
        baseMonthsAlreadyPaid: 3,
      },
      now,
      { id: 'owner-1', role: Role.ADMIN },
    );

    expect(dbMock.csPayrollPayment.create).toHaveBeenCalledWith({
      data: {
        idempotencyKey: 'cs-period-opening-base:period-1',
        salaryPeriodId: 'period-1',
        baseAmount: '6000.00',
        commissionAmount: '0.00',
        paidAt: now,
        paymentMethod: null,
        referenceNo: null,
        remark: '历史导入：已发 3 个月底薪',
        recordedById: 'owner-1',
      },
    });
  });

  it('does not create a zero-value payment when imported monthly base is zero', async () => {
    dbMock.user.findUnique.mockResolvedValue(csUser);
    dbMock.salaryPeriod.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'period-zero-base',
        csUserId: data.csUserId,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        durationMonths: data.durationMonths,
        monthlyBase: data.monthlyBase,
        initialSales: data.initialSales,
      }),
    );

    await startCsPeriod(
      {
        csUserId: 'cs-1',
        periodStart: '2026-01-01',
        monthlyBase: 0,
        baseMonthsAlreadyPaid: 3,
      },
      new Date('2026-04-01T00:00:00Z'),
      { id: 'owner-1', role: Role.ADMIN },
    );

    expect(dbMock.csPayrollPayment.create).not.toHaveBeenCalled();
  });

  it('refuses an overlapping period regardless of finance status', async () => {
    dbMock.user.findUnique.mockResolvedValue(csUser);
    dbMock.salaryPeriod.findFirst.mockResolvedValue({
      id: 'existing',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-04-30'),
      status: SalaryPeriodStatus.SETTLED,
    });
    await expect(
      startCsPeriod({
        csUserId: 'cs-1',
        periodStart: '2026-03-01',
      }),
    ).rejects.toThrow(/区间重叠/);
    const where = dbMock.salaryPeriod.findFirst.mock.calls[0][0].where;
    expect(where.status).toBeUndefined();
  });

  it('locks the CS user before the overlap read and create', async () => {
    dbMock.user.findUnique.mockResolvedValue(csUser);
    dbMock.salaryPeriod.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'period-1',
      csUserId: data.csUserId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      durationMonths: data.durationMonths,
      monthlyBase: data.monthlyBase,
      initialSales: data.initialSales,
    }));

    await startCsPeriod({
      csUserId: 'cs-1',
      periodStart: '2026-01-01',
    });

    expect(dbMock.$executeRaw.mock.calls[0][1]).toBe(
      'print-shop-erp:salary-identity:cs-1',
    );
    expect(dbMock.$executeRaw.mock.calls[1][1]).toBe(
      'print-shop-erp:cs-user:cs-1',
    );
    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.$executeRaw.mock.invocationCallOrder[1],
    );
    expect(dbMock.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
      dbMock.salaryPeriod.findFirst.mock.invocationCallOrder[0],
    );
    expect(dbMock.salaryPeriod.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.salaryPeriod.create.mock.invocationCallOrder[0],
    );
  });

  it('refuses when no active CS_BASE_SALARY rule and no override', async () => {
    dbMock.user.findUnique.mockResolvedValue(csUser);
    dbMock.salaryRule.findFirst.mockImplementation(async (args: {
      where: { ruleKey: string };
    }) => {
      if (args.where.ruleKey === 'CS_BASE_SALARY') return null;
      if (args.where.ruleKey === 'CS_PERIOD_LENGTH') return { ruleValue: PERIOD_RULE_VALUE };
      return null;
    });
    await expect(
      startCsPeriod({
        csUserId: 'cs-1',
        periodStart: '2026-01-01',
      }),
    ).rejects.toThrow(/CS_BASE_SALARY/);
  });
});

describe('settleCsPeriod', () => {
  const periodFixture = {
    id: 'period-1',
    csUserId: 'cs-1',
    periodStart: new Date(Date.UTC(2026, 0, 1)),
    periodEnd: new Date(Date.UTC(2026, 3, 30)),
    durationMonths: 4,
    totalSales: '550000',
    initialSales: '0',
    monthlyBase: '2000',
    status: SalaryPeriodStatus.IN_PROGRESS,
  };

  it('throws when the period is missing', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(null);
    await expect(settleCsPeriod('ghost')).rejects.toBeInstanceOf(
      CsPeriodError,
    );
  });

  it('refuses to re-settle a SETTLED period', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue({
      ...periodFixture,
      status: SalaryPeriodStatus.SETTLED,
    });
    await expect(settleCsPeriod('period-1')).rejects.toBeInstanceOf(
      InvalidCsPeriodTransitionError,
    );
  });

  it('refuses manual settlement until the Shanghai date has passed periodEnd', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);

    // Shanghai 2026-04-30 23:59:59: the inclusive final day is still open.
    await expect(
      settleCsPeriod('period-1', new Date('2026-04-30T15:59:59.999Z')),
    ).rejects.toThrow(/尚未结束/);
    expect(dbMock.salaryPeriod.update).not.toHaveBeenCalled();
    expect(dbMock.customerServiceCommission.create).not.toHaveBeenCalled();
  });

  it('allows settlement exactly when the next Shanghai day begins', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });

    await expect(
      settleCsPeriod('period-1', new Date('2026-04-30T16:00:00.000Z')),
    ).resolves.toMatchObject({ periodId: 'period-1' });
  });

  it('SPEC §7.3 reproduction: 55万 → tier 5 (0.06) → 33000 + base 8000 = 41000', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });
    const now = new Date('2026-05-01T00:00:00Z');
    const r = await settleCsPeriod('period-1', now);
    expect(r.totalSales).toBe('550000.00');
    expect(r.tierRate).toBe('0.0600');
    expect(r.commissionAmount).toBe('33000.00');
    expect(r.monthlyBaseTotal).toBe('8000.00');
    expect(r.totalIncome).toBe('41000.00');
    expect(r.nextPeriodId).toBe('period-2');
  });

  it('rounds commission to cents once before payment limits and total income', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue({
      ...periodFixture,
      totalSales: '1.01',
    });
    dbMock.salaryRule.findFirst.mockImplementation(async (args: {
      where: { ruleKey: string };
    }) => {
      if (args.where.ruleKey === 'CS_TIERS') {
        return {
          ruleValue: {
            mode: 'FLAT',
            tiers: [{ minSales: 0, rate: 0.5 }],
          },
        };
      }
      if (args.where.ruleKey === 'CS_BASE_SALARY') {
        return { ruleValue: BASE_RULE_VALUE };
      }
      return { ruleValue: PERIOD_RULE_VALUE };
    });
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });

    const result = await settleCsPeriod('period-1');

    expect(result.commissionAmount).toBe('0.51');
    expect(result.totalIncome).toBe('8000.51');
    expect(
      dbMock.customerServiceCommission.create.mock.calls[0][0].data
        .commissionAmount,
    ).toBe('0.51');
  });

  it('rejects a combined period total that cannot fit the commission record', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue({
      ...periodFixture,
      totalSales: '6000000000.00',
      initialSales: '5000000000.00',
    });

    await expect(settleCsPeriod('period-1')).rejects.toThrow(
      /提成计算业绩.*超出/,
    );
    expect(dbMock.customerServiceCommission.create).not.toHaveBeenCalled();
  });

  it('carries three monthly base payments into the settled commission snapshot', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });
    const lastBasePaidAt = new Date('2026-03-31T04:00:00Z');
    dbMock.csPayrollPayment.aggregate.mockResolvedValue({
      _sum: { baseAmount: '6000.00', commissionAmount: '0.00' },
      _max: { paidAt: lastBasePaidAt },
    });

    await settleCsPeriod('period-1', new Date('2026-05-01T00:00:00Z'));
    const data = dbMock.customerServiceCommission.create.mock.calls[0][0].data;
    expect(data.paidBase).toBe('6000.00');
    expect(data.paidCommission).toBe('0.00');
    expect(data.isFullyPaid).toBe(false);
    expect(data.paidAt).toBeNull();
  });

  it('writes salaryRuleSnapshot with full tier table + monthlyBase (Codex round 45 / P1)', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });
    await settleCsPeriod('period-1');
    const data = dbMock.customerServiceCommission.create.mock.calls[0][0].data;
    expect(data.salaryRuleSnapshot).toBeDefined();
    expect(data.salaryRuleSnapshot.tiers.mode).toBe('FLAT');
    expect(data.salaryRuleSnapshot.tiers.tiers).toHaveLength(5);
    expect(data.salaryRuleSnapshot.monthlyBase).toBe('2000');
    expect(data.salaryRuleSnapshot.durationMonths).toBe(4);
    expect(data.salaryRuleSnapshot.activeAtSettle.monthlyBase).toBe(2000);
    expect(data.salaryRuleSnapshot.activeAtSettle.durationMonths).toBe(4);
  });

  it('takes the CS-user advisory lock (Codex round 46 / P0)', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });
    await settleCsPeriod('period-1');
    expect(dbMock.$executeRaw).toHaveBeenCalled();
    const firstCall = dbMock.$executeRaw.mock.calls[0];
    const sql = (firstCall[0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(firstCall[1]).toMatch(/print-shop-erp:salary-identity:cs-1/);
    expect(dbMock.$executeRaw.mock.calls[1]?.[1]).toMatch(
      /print-shop-erp:cs-user:cs-1/,
    );
    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.$executeRaw.mock.invocationCallOrder[1],
    );
  });

  it('adds initialSales to totalSales when picking the tier (SPEC §5.5 continuation)', async () => {
    // Period with 230000 initial + 320000 this period = 550000 total
    dbMock.salaryPeriod.findUnique.mockResolvedValue({
      ...periodFixture,
      totalSales: '320000',
      initialSales: '230000',
    });
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });
    const r = await settleCsPeriod('period-1');
    expect(r.totalSales).toBe('550000.00');
    expect(r.tierRate).toBe('0.0600');
  });

  it('below lowest tier: records zero commission, still emits a CustomerServiceCommission row', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue({
      ...periodFixture,
      totalSales: '50000',
      initialSales: '0',
    });
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });
    const r = await settleCsPeriod('period-1');
    expect(r.commissionAmount).toBe('0.00');
    expect(r.monthlyBaseTotal).toBe('8000.00');
    expect(r.totalIncome).toBe('8000.00');
  });

  it('transitions the period to SETTLED with settledAt from the injected clock', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });
    const now = new Date('2026-05-01T12:00:00Z');
    await settleCsPeriod('period-1', now);
    const update = dbMock.salaryPeriod.update.mock.calls[0][0];
    expect(update.data.status).toBe(SalaryPeriodStatus.SETTLED);
    expect(update.data.settledAt).toBe(now);
  });

  it('commits the durable notification through the same settlement transaction', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });
    enqueueNotificationInTransactionMock.mockResolvedValue(true);

    const result = await settleCsPeriod('period-1');

    expect(result.notificationQueued).toBe(true);
    expect(enqueueNotificationInTransactionMock).toHaveBeenCalledExactlyOnceWith(
      dbMock,
      'CS_PERIOD_SETTLED',
      {
        settledCount: 1,
        csName: 'cs-1',
        totalSales: '550000.00',
        commission: '33000.00',
      },
      { dedupeKey: 'notification:CS_PERIOD_SETTLED:period-1' },
    );
    expect(dispatchNotificationMock).not.toHaveBeenCalled();
  });

  it('dispatches the inline notification exactly once after settlement commits', async () => {
    dbMock.user.findUnique.mockResolvedValue({
      id: 'cs-1',
      role: Role.CUSTOMER_SERVICE,
      isActive: true,
      displayName: '客服一',
      employmentStartDate: null,
      employmentEndDate: null,
    });
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });
    enqueueNotificationInTransactionMock.mockResolvedValue(false);
    let transactionCommitted = false;
    dbMock.$transaction.mockImplementationOnce(async (fn: unknown) => {
      const result = await (fn as (tx: unknown) => unknown)(dbMock);
      transactionCommitted = true;
      return result;
    });
    dispatchNotificationMock.mockImplementationOnce(async () => {
      expect(transactionCommitted).toBe(true);
    });

    const result = await settleCsPeriod('period-1');

    expect(result.notificationQueued).toBe(false);
    expect(dispatchNotificationMock).toHaveBeenCalledExactlyOnceWith(
      'CS_PERIOD_SETTLED',
      {
        settledCount: 1,
        csName: '客服一',
        totalSales: '550000.00',
        commission: '33000.00',
      },
      { dedupeKey: 'notification:CS_PERIOD_SETTLED:period-1' },
    );
  });

  it('does not suppress a durable outbox failure after finance writes', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });
    enqueueNotificationInTransactionMock.mockRejectedValue(
      new Error('outbox unavailable'),
    );

    await expect(settleCsPeriod('period-1')).rejects.toThrow(
      'outbox unavailable',
    );
  });

  it('auto-starts next period beginning the day after periodEnd', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });
    await settleCsPeriod('period-1');
    const nextCreate = dbMock.salaryPeriod.create.mock.calls[0][0].data;
    // periodEnd 2026-04-30 → next starts 2026-05-01
    expect((nextCreate.periodStart as Date).toISOString().slice(0, 10)).toBe(
      '2026-05-01',
    );
    expect(nextCreate.status).toBe(SalaryPeriodStatus.IN_PROGRESS);
    expect(nextCreate.initialSales).toBe('0.00');
  });

  it('keeps a mid-month successor contiguous instead of moving it back to day 1', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue({
      ...periodFixture,
      periodStart: new Date('2026-01-15T00:00:00.000Z'),
      periodEnd: new Date('2026-05-14T00:00:00.000Z'),
    });
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });

    await settleCsPeriod('period-1', new Date('2026-05-15T00:00:00.000Z'));

    const nextCreate = dbMock.salaryPeriod.create.mock.calls[0][0].data;
    expect((nextCreate.periodStart as Date).toISOString().slice(0, 10)).toBe(
      '2026-05-15',
    );
    expect((nextCreate.periodEnd as Date).toISOString().slice(0, 10)).toBe(
      '2026-09-14',
    );
  });

  it('clamps an automatic successor to the inclusive final employment month', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.user.findUnique.mockResolvedValue({
      id: 'cs-1',
      role: Role.CUSTOMER_SERVICE,
      isActive: true,
      employmentStartDate: null,
      employmentEndDate: new Date('2026-06-15T00:00:00.000Z'),
    });
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'period-2' });

    await settleCsPeriod('period-1');

    const nextCreate = dbMock.salaryPeriod.create.mock.calls[0][0].data;
    expect(nextCreate.durationMonths).toBe(2);
    expect((nextCreate.periodStart as Date).toISOString().slice(0, 10)).toBe(
      '2026-05-01',
    );
    expect((nextCreate.periodEnd as Date).toISOString().slice(0, 10)).toBe(
      '2026-06-30',
    );
  });

  it('does not create a successor wholly after employment ended', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.user.findUnique.mockResolvedValue({
      id: 'cs-1',
      role: Role.CUSTOMER_SERVICE,
      isActive: true,
      employmentStartDate: null,
      employmentEndDate: new Date('2026-04-30T00:00:00.000Z'),
    });
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });

    const result = await settleCsPeriod('period-1');

    expect(result.nextPeriodId).toBeNull();
    expect(dbMock.salaryPeriod.create).not.toHaveBeenCalled();
  });

  it('stores the maximum closed CS combination in Decimal(13,2)', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue({
      ...periodFixture,
      durationMonths: 24,
      totalSales: '9999999999.99',
      monthlyBase: '99999999.99',
    });
    dbMock.salaryRule.findFirst.mockImplementation(async (args: {
      where: { ruleKey: string };
    }) => {
      if (args.where.ruleKey === 'CS_TIERS') {
        return {
          ruleValue: {
            mode: 'FLAT',
            tiers: [{ minSales: 0, rate: 1 }],
          },
        };
      }
      if (args.where.ruleKey === 'CS_BASE_SALARY') {
        return { ruleValue: { monthlyBase: 99_999_999.99 } };
      }
      return { ruleValue: { months: 24 } };
    });
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-max' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'next-max' });

    const result = await settleCsPeriod('period-1');

    expect(result.monthlyBaseTotal).toBe('2399999999.76');
    expect(result.commissionAmount).toBe('9999999999.99');
    expect(result.totalIncome).toBe('12399999999.75');
    expect(dbMock.customerServiceCommission.create).toHaveBeenCalledOnce();
  });

  it('reuses an exact next period prepared in advance instead of duplicating it', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.salaryPeriod.findFirst.mockResolvedValue({
      id: 'prepared-next',
      periodStart: new Date(Date.UTC(2026, 4, 1)),
      periodEnd: new Date(Date.UTC(2026, 7, 31)),
      status: SalaryPeriodStatus.IN_PROGRESS,
    });
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });

    const result = await settleCsPeriod(
      'period-1',
      new Date('2026-05-01T00:00:00.000Z'),
    );

    expect(result.nextPeriodId).toBe('prepared-next');
    expect(dbMock.salaryPeriod.create).not.toHaveBeenCalled();
  });

  it('rejects settlement if auto-start would overlap a different existing period', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.salaryPeriod.findFirst.mockResolvedValue({
      id: 'conflicting-future',
      periodStart: new Date(Date.UTC(2026, 5, 1)),
      periodEnd: new Date(Date.UTC(2026, 8, 30)),
      status: SalaryPeriodStatus.IN_PROGRESS,
    });
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });

    await expect(
      settleCsPeriod('period-1', new Date('2026-05-01T00:00:00.000Z')),
    ).rejects.toThrow(/自动开启的下一周期.*重叠/);
    expect(dbMock.salaryPeriod.create).not.toHaveBeenCalled();
  });

  it('atomically rejects settlement if an active CS cannot receive a next period', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });
    // CS_TIERS still resolves (used for commission) but CS_PERIOD_LENGTH is gone.
    dbMock.salaryRule.findFirst.mockImplementation(async (args: {
      where: { ruleKey: string };
    }) => {
      if (args.where.ruleKey === 'CS_TIERS') return { ruleValue: TIERS_RULE_VALUE };
      if (args.where.ruleKey === 'CS_BASE_SALARY') return { ruleValue: BASE_RULE_VALUE };
      if (args.where.ruleKey === 'CS_PERIOD_LENGTH') return null;
      return null;
    });
    await expect(settleCsPeriod('period-1')).rejects.toThrow(/结算后出现空档/);
    expect(dbMock.salaryPeriod.create).not.toHaveBeenCalled();
    expect(dbMock.salaryPeriod.update).not.toHaveBeenCalled();
    expect(dbMock.customerServiceCommission.create).not.toHaveBeenCalled();
  });

  it('rejects an out-of-policy next-period duration from the active rule', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.salaryRule.findFirst.mockImplementation(async (args: {
      where: { ruleKey: string };
    }) => {
      if (args.where.ruleKey === 'CS_TIERS') {
        return { ruleValue: TIERS_RULE_VALUE };
      }
      if (args.where.ruleKey === 'CS_BASE_SALARY') {
        return { ruleValue: BASE_RULE_VALUE };
      }
      if (args.where.ruleKey === 'CS_PERIOD_LENGTH') {
        return { ruleValue: { months: 25 } };
      }
      return null;
    });

    await expect(settleCsPeriod('period-1')).rejects.toThrow(/1 到 24/);
    expect(dbMock.salaryPeriod.update).not.toHaveBeenCalled();
    expect(dbMock.customerServiceCommission.create).not.toHaveBeenCalled();
  });

  it('settles but does not create another period for a disabled former CS', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.user.findUnique.mockResolvedValue({
      id: 'cs-1',
      role: Role.CUSTOMER_SERVICE,
      isActive: false,
    });
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm-1' });

    const result = await settleCsPeriod('period-1');

    expect(result.nextPeriodId).toBeNull();
    expect(dbMock.salaryPeriod.create).not.toHaveBeenCalled();
    expect(dbMock.customerServiceCommission.create).toHaveBeenCalled();
  });

  it('refuses to settle if no CS_TIERS rule is active', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue(periodFixture);
    dbMock.salaryRule.findFirst.mockImplementation(async (args: {
      where: { ruleKey: string };
    }) => {
      if (args.where.ruleKey === 'CS_TIERS') return null;
      if (args.where.ruleKey === 'CS_BASE_SALARY') return { ruleValue: BASE_RULE_VALUE };
      if (args.where.ruleKey === 'CS_PERIOD_LENGTH') return { ruleValue: PERIOD_RULE_VALUE };
      return null;
    });
    await expect(settleCsPeriod('period-1')).rejects.toThrow(/CS_TIERS/);
  });
});

describe('settleReadyCsPeriods', () => {
  it('scans for periodEnd before today-in-Shanghai + IN_PROGRESS and settles each', async () => {
    dbMock.salaryPeriod.findMany.mockResolvedValue([
      { id: 'period-a' },
      { id: 'period-b' },
    ]);
    // Make settleCsPeriod succeed for both — we need findUnique to
    // return a valid row for each id.
    dbMock.salaryPeriod.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      csUserId: 'cs-1',
      periodStart: new Date(Date.UTC(2026, 0, 1)),
      periodEnd: new Date(Date.UTC(2026, 3, 30)),
      durationMonths: 4,
      totalSales: '100000',
      initialSales: '0',
      monthlyBase: '2000',
      status: SalaryPeriodStatus.IN_PROGRESS,
    }));
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'next' });
    const out = await settleReadyCsPeriods(
      new Date('2026-04-30T16:00:00.000Z'),
    );
    expect(out.settled).toHaveLength(2);
    expect(out.errors).toEqual([]);
    expect(out.settled[0].periodId).toBe('period-a');
    expect(out.settled[1].periodId).toBe('period-b');
    const where = dbMock.salaryPeriod.findMany.mock.calls[0][0].where;
    expect(where.periodEnd.lt.toISOString()).toBe(
      '2026-05-01T00:00:00.000Z',
    );
  });

  it('does not make a period due during its final Shanghai calendar day', async () => {
    dbMock.salaryPeriod.findMany.mockResolvedValue([]);

    await settleReadyCsPeriods(new Date('2026-04-30T15:59:59.999Z'));

    const where = dbMock.salaryPeriod.findMany.mock.calls[0][0].where;
    expect(where.periodEnd.lt.toISOString()).toBe(
      '2026-04-30T00:00:00.000Z',
    );
  });

  it('returns empty when nothing is due', async () => {
    dbMock.salaryPeriod.findMany.mockResolvedValue([]);
    const out = await settleReadyCsPeriods();
    expect(out.settled).toEqual([]);
    expect(out.errors).toEqual([]);
  });

  it('settles newly-created overdue successors in the same cron run', async () => {
    dbMock.salaryPeriod.findMany
      .mockResolvedValueOnce([{ id: 'period-jan-apr' }])
      .mockResolvedValueOnce([{ id: 'period-may-aug' }])
      .mockResolvedValueOnce([]);
    dbMock.salaryPeriod.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        csUserId: 'cs-1',
        periodStart:
          where.id === 'period-jan-apr'
            ? new Date(Date.UTC(2026, 0, 1))
            : new Date(Date.UTC(2026, 4, 1)),
        periodEnd:
          where.id === 'period-jan-apr'
            ? new Date(Date.UTC(2026, 3, 30))
            : new Date(Date.UTC(2026, 7, 31)),
        durationMonths: 4,
        totalSales: '0',
        initialSales: '0',
        monthlyBase: '2000',
        status: SalaryPeriodStatus.IN_PROGRESS,
      }),
    );
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm' });
    dbMock.salaryPeriod.create
      .mockResolvedValueOnce({ id: 'period-may-aug' })
      .mockResolvedValueOnce({ id: 'period-sep-dec' });

    const out = await settleReadyCsPeriods(
      new Date('2026-12-01T00:00:00.000Z'),
    );

    expect(out.settled.map((entry) => entry.periodId)).toEqual([
      'period-jan-apr',
      'period-may-aug',
    ]);
    expect(out.errors).toEqual([]);
    expect(dbMock.salaryPeriod.findMany).toHaveBeenCalledTimes(3);
    expect(dbMock.salaryPeriod.findMany.mock.calls[1][0].where.id).toEqual({
      notIn: ['period-jan-apr'],
    });
  });

  it('per-period try: one failure does not abort the batch (Codex round 45 / P1)', async () => {
    dbMock.salaryPeriod.findMany.mockResolvedValue([
      { id: 'period-ok' },
      { id: 'period-broken' },
      { id: 'period-ok-2' },
    ]);
    dbMock.salaryPeriod.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        if (where.id === 'period-broken') return null; // triggers CsPeriodError
        return {
          id: where.id,
          csUserId: 'cs-1',
          periodStart: new Date(Date.UTC(2026, 0, 1)),
          periodEnd: new Date(Date.UTC(2026, 3, 30)),
          durationMonths: 4,
          totalSales: '100000',
          initialSales: '0',
          monthlyBase: '2000',
          status: SalaryPeriodStatus.IN_PROGRESS,
        };
      },
    );
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'next' });
    const out = await settleReadyCsPeriods();
    expect(out.settled.map((s) => s.periodId)).toEqual([
      'period-ok',
      'period-ok-2',
    ]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].periodId).toBe('period-broken');
    expect(out.errors[0].message).toMatch(/周期不存在/);
  });

  it('rethrows an unknown settlement failure with earlier committed results attached', async () => {
    dbMock.salaryPeriod.findMany.mockResolvedValue([
      { id: 'period-ok' },
      { id: 'period-db-error' },
    ]);
    dbMock.salaryPeriod.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        if (where.id === 'period-db-error') throw new Error('database offline');
        return {
          id: where.id,
          csUserId: 'cs-1',
          periodStart: new Date(Date.UTC(2026, 0, 1)),
          periodEnd: new Date(Date.UTC(2026, 3, 30)),
          durationMonths: 4,
          totalSales: '100000',
          initialSales: '0',
          monthlyBase: '2000',
          status: SalaryPeriodStatus.IN_PROGRESS,
        };
      },
    );
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'next' });

    const caught = await settleReadyCsPeriods().catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(CsBatchUnexpectedError);
    expect((caught as CsBatchUnexpectedError).partialResult.settled).toHaveLength(1);
    expect((caught as CsBatchUnexpectedError).partialResult.settled[0].periodId)
      .toBe('period-ok');
    expect((caught as Error).message).not.toContain('database offline');
  });

  it('preserves committed results when a later catch-up scan fails', async () => {
    dbMock.salaryPeriod.findMany
      .mockResolvedValueOnce([{ id: 'period-ok' }])
      .mockRejectedValueOnce(new Error('scan failed'));
    dbMock.salaryPeriod.findUnique.mockResolvedValue({
      id: 'period-ok',
      csUserId: 'cs-1',
      periodStart: new Date(Date.UTC(2026, 0, 1)),
      periodEnd: new Date(Date.UTC(2026, 3, 30)),
      durationMonths: 4,
      totalSales: '100000',
      initialSales: '0',
      monthlyBase: '2000',
      status: SalaryPeriodStatus.IN_PROGRESS,
    });
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'next' });

    const caught = await settleReadyCsPeriods().catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(CsBatchUnexpectedError);
    expect((caught as CsBatchUnexpectedError).partialResult.settled)
      .toHaveLength(1);
  });

  it('does not report a batch-limit error when the exact limit drains the queue', async () => {
    dbMock.salaryPeriod.findMany.mockResolvedValue([{ id: 'period-only' }]);
    dbMock.salaryPeriod.findUnique.mockResolvedValue({
      id: 'period-only',
      csUserId: 'cs-1',
      periodStart: new Date(Date.UTC(2026, 0, 1)),
      periodEnd: new Date(Date.UTC(2026, 3, 30)),
      durationMonths: 4,
      totalSales: '100000',
      initialSales: '0',
      monthlyBase: '2000',
      status: SalaryPeriodStatus.IN_PROGRESS,
    });
    dbMock.customerServiceCommission.create.mockResolvedValue({ id: 'comm' });
    dbMock.salaryPeriod.create.mockResolvedValue({ id: 'next' });
    dbMock.salaryPeriod.findFirst.mockResolvedValue(null);

    const out = await settleReadyCsPeriods(new Date(), 1);

    expect(out.settled).toHaveLength(1);
    expect(out.errors).toEqual([]);
  });
});

describe('recordCsPayrollPayment', () => {
  const paymentInput = {
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    baseAmount: '2000.00',
    commissionAmount: '0.00',
    paidAt: new Date('2026-02-01T02:00:00Z'),
    paymentMethod: '银行',
  };
  const actor = { id: 'owner-1', role: Role.ADMIN };

  it('allows monthly bottom-salary payment before settlement', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      csUserId: 'cs-7',
      monthlyBase: '2000.00',
      durationMonths: 4,
      commissions: [],
    });
    const result = await recordCsPayrollPayment(
      'period-1',
      paymentInput,
      actor,
    );
    expect(result).toEqual({
      paymentId: 'pay-1',
      paidBase: '2000.00',
      paidCommission: '0.00',
      isFullyPaid: false,
    });
    expect(dbMock.csPayrollPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        salaryPeriodId: 'period-1',
        baseAmount: '2000.00',
        commissionAmount: '0.00',
        recordedById: 'owner-1',
      }),
      select: { id: true },
    });
    expect(dbMock.customerServiceCommission.update).not.toHaveBeenCalled();
  });

  it('rejects commission payment before the period settles', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      csUserId: 'cs-7',
      monthlyBase: '2000.00',
      durationMonths: 4,
      commissions: [],
    });
    await expect(
      recordCsPayrollPayment(
        'period-1',
        { ...paymentInput, baseAmount: '0', commissionAmount: '1' },
        actor,
      ),
    ).rejects.toThrow(/尚未结算/);
  });

  it('records the final month base plus commission and marks fully paid', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      csUserId: 'cs-7',
      monthlyBase: '2000.00',
      durationMonths: 4,
      commissions: [
        {
          id: 'comm-1',
          monthlyBaseTotal: '8000.00',
          commissionAmount: '33000.00',
        },
      ],
    });
    dbMock.csPayrollPayment.aggregate.mockResolvedValue({
      _sum: { baseAmount: '6000.00', commissionAmount: '0.00' },
      _max: { paidAt: null },
    });
    const result = await recordCsPayrollPayment(
      'period-1',
      { ...paymentInput, commissionAmount: '33000.00' },
      actor,
    );
    expect(result).toMatchObject({
      paidBase: '8000.00',
      paidCommission: '33000.00',
      isFullyPaid: true,
    });
    expect(dbMock.customerServiceCommission.update).toHaveBeenCalledWith({
      where: { id: 'comm-1' },
      data: expect.objectContaining({
        paidBase: '8000.00',
        paidCommission: '33000.00',
        isFullyPaid: true,
        paidAt: paymentInput.paidAt,
      }),
    });
  });

  it('replays an existing request without inserting a second row', async () => {
    dbMock.csPayrollPayment.findUnique.mockResolvedValue({
      id: 'pay-existing',
      salaryPeriodId: 'period-1',
      baseAmount: '2000.00',
      commissionAmount: '0.00',
      paidAt: paymentInput.paidAt,
      paymentMethod: '银行',
      referenceNo: null,
      remark: null,
      recordedById: 'owner-1',
    });
    dbMock.csPayrollPayment.aggregate.mockResolvedValue({
      _sum: { baseAmount: '2000.00', commissionAmount: '0.00' },
    });
    dbMock.customerServiceCommission.findUnique.mockResolvedValue(null);
    const result = await recordCsPayrollPayment(
      'period-1',
      paymentInput,
      actor,
    );
    expect(result.paymentId).toBe('pay-existing');
    expect(dbMock.csPayrollPayment.create).not.toHaveBeenCalled();
  });

  it('rejects reuse of a request key when any audit field changed', async () => {
    dbMock.csPayrollPayment.findUnique.mockResolvedValue({
      id: 'pay-existing',
      salaryPeriodId: 'period-1',
      baseAmount: '2000.00',
      commissionAmount: '0.00',
      paidAt: paymentInput.paidAt,
      paymentMethod: '现金',
      referenceNo: null,
      remark: null,
      recordedById: 'owner-1',
    });

    await expect(
      recordCsPayrollPayment('period-1', paymentInput, actor),
    ).rejects.toThrow(/请求标识已被其他记录使用/);
  });

  it('uses the latest ledger timestamp as the fully-paid timestamp', async () => {
    dbMock.salaryPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      csUserId: 'cs-7',
      monthlyBase: '2000.00',
      durationMonths: 4,
      commissions: [
        {
          id: 'comm-1',
          monthlyBaseTotal: '8000.00',
          commissionAmount: '33000.00',
        },
      ],
    });
    const latestExisting = new Date('2026-05-10T02:00:00Z');
    dbMock.csPayrollPayment.aggregate.mockResolvedValue({
      _sum: { baseAmount: '6000.00', commissionAmount: '0.00' },
      _max: { paidAt: latestExisting },
    });

    await recordCsPayrollPayment(
      'period-1',
      { ...paymentInput, commissionAmount: '33000.00' },
      actor,
    );

    expect(dbMock.customerServiceCommission.update).toHaveBeenCalledWith({
      where: { id: 'comm-1' },
      data: expect.objectContaining({ paidAt: latestExisting }),
    });
  });

  it('rejects fractional cents at the domain boundary', async () => {
    await expect(
      recordCsPayrollPayment(
        'period-1',
        { ...paymentInput, baseAmount: '0.001' },
        actor,
      ),
    ).rejects.toThrow(/必须为非负金额/);
  });

  it('rejects an invalid payment timestamp at the domain boundary', async () => {
    await expect(
      recordCsPayrollPayment(
        'period-1',
        { ...paymentInput, paidAt: new Date(Number.NaN) },
        actor,
      ),
    ).rejects.toThrow(/发放时间不合法/);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });
});
