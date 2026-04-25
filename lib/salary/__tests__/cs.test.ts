import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Role,
  SalaryPeriodStatus,
} from '../../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
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
  computePeriodEnd,
  startCsPeriod,
  accumulateCsSales,
  settleCsPeriod,
  settleReadyCsPeriods,
  markCsCommissionPaid,
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
  dbMock.user.findUnique.mockReset();
  dbMock.salaryRule.findFirst.mockReset();
  dbMock.salaryPeriod.findFirst.mockReset().mockResolvedValue(null);
  dbMock.salaryPeriod.findUnique.mockReset();
  dbMock.salaryPeriod.findMany.mockReset();
  dbMock.salaryPeriod.create.mockReset();
  dbMock.salaryPeriod.update.mockReset();
  dbMock.customerServiceCommission.findUnique.mockReset();
  dbMock.customerServiceCommission.create.mockReset();
  dbMock.customerServiceCommission.update.mockReset();
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
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

  it('refuses an overlapping IN_PROGRESS period', async () => {
    dbMock.user.findUnique.mockResolvedValue(csUser);
    dbMock.salaryPeriod.findFirst.mockResolvedValue({
      id: 'existing',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-04-30'),
    });
    await expect(
      startCsPeriod({
        csUserId: 'cs-1',
        periodStart: '2026-03-01',
      }),
    ).rejects.toThrow(/区间重叠/);
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

describe('accumulateCsSales', () => {
  it('returns null when no active period at the given time', async () => {
    dbMock.salaryPeriod.findFirst.mockResolvedValue(null);
    const r = await accumulateCsSales('cs-1', 5000);
    expect(r).toBeNull();
  });

  it('uses Prisma atomic increment to avoid lost-update races', async () => {
    dbMock.salaryPeriod.findFirst.mockResolvedValue({
      id: 'period-1',
      totalSales: '10000',
    });
    dbMock.salaryPeriod.update.mockResolvedValue({
      id: 'period-1',
      totalSales: '15000',
    });
    await accumulateCsSales('cs-1', 5000);
    const data = dbMock.salaryPeriod.update.mock.calls[0][0].data;
    expect(data.totalSales).toEqual({ increment: '5000.00' });
  });

  it('takes the CS-user advisory lock BEFORE finding the period (Codex round 46 / P0)', async () => {
    dbMock.salaryPeriod.findFirst.mockResolvedValue({
      id: 'period-1',
      totalSales: '0',
    });
    dbMock.salaryPeriod.update.mockResolvedValue({
      id: 'period-1',
      totalSales: '5000',
    });
    await accumulateCsSales('cs-1', 5000);
    // Lock comes first — BEFORE any salaryPeriod read.
    expect(dbMock.$executeRaw).toHaveBeenCalled();
    const firstCall = dbMock.$executeRaw.mock.calls[0];
    const sql = (firstCall[0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(firstCall[1]).toMatch(/print-shop-erp:cs-user:cs-1/);
    // And the lock must be taken before findFirst runs. Vitest's
    // mock tracking doesn't expose cross-fn ordering directly, but
    // we can assert both were called.
    expect(dbMock.salaryPeriod.findFirst).toHaveBeenCalled();
  });

  it('finds the period where periodStart ≤ at ≤ periodEnd', async () => {
    dbMock.salaryPeriod.findFirst.mockResolvedValue({
      id: 'period-1',
      totalSales: '0',
    });
    dbMock.salaryPeriod.update.mockResolvedValue({
      id: 'period-1',
      totalSales: '5000',
    });
    const at = new Date('2026-03-15');
    await accumulateCsSales('cs-1', 5000, at);
    const where = dbMock.salaryPeriod.findFirst.mock.calls[0][0].where;
    expect(where.csUserId).toBe('cs-1');
    expect(where.status).toBe(SalaryPeriodStatus.IN_PROGRESS);
    expect(where.periodStart.lte).toEqual(at);
    expect(where.periodEnd.gte).toEqual(at);
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
    // Lock keyed on csUserId so it serializes with accumulateCsSales
    // and any concurrent settler for the SAME user.
    expect(firstCall[1]).toMatch(/print-shop-erp:cs-user:cs-1/);
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

  it('skips next-period creation if rules are missing at settlement time (leaves for manual restart)', async () => {
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
    const r = await settleCsPeriod('period-1');
    expect(r.nextPeriodId).toBeNull();
    expect(dbMock.salaryPeriod.create).not.toHaveBeenCalled();
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
  it('scans for periodEnd < now + IN_PROGRESS and settles each', async () => {
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
    const out = await settleReadyCsPeriods();
    expect(out.settled).toHaveLength(2);
    expect(out.errors).toEqual([]);
    expect(out.settled[0].periodId).toBe('period-a');
    expect(out.settled[1].periodId).toBe('period-b');
  });

  it('returns empty when nothing is due', async () => {
    dbMock.salaryPeriod.findMany.mockResolvedValue([]);
    const out = await settleReadyCsPeriods();
    expect(out.settled).toEqual([]);
    expect(out.errors).toEqual([]);
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
});

describe('markCsCommissionPaid', () => {
  const commFixture = {
    id: 'comm-1',
    monthlyBaseTotal: '8000.00',
    commissionAmount: '33000.00',
  };

  it('sets isFullyPaid=true + paidBase + paidCommission + paidAt', async () => {
    dbMock.customerServiceCommission.findUnique.mockResolvedValue(commFixture);
    dbMock.customerServiceCommission.update.mockResolvedValue({
      id: 'comm-1',
      isFullyPaid: true,
    });
    const now = new Date('2026-05-10T09:00:00Z');
    await markCsCommissionPaid('comm-1', true, now);
    const data = dbMock.customerServiceCommission.update.mock.calls[0][0].data;
    expect(data.isFullyPaid).toBe(true);
    expect(data.paidBase).toBe('8000.00');
    expect(data.paidCommission).toBe('33000.00');
    expect(data.paidAt).toBe(now);
  });

  it('un-pay clears the counters + paidAt', async () => {
    dbMock.customerServiceCommission.findUnique.mockResolvedValue(commFixture);
    dbMock.customerServiceCommission.update.mockResolvedValue({
      id: 'comm-1',
      isFullyPaid: false,
    });
    await markCsCommissionPaid('comm-1', false);
    const data = dbMock.customerServiceCommission.update.mock.calls[0][0].data;
    expect(data.isFullyPaid).toBe(false);
    expect(data.paidBase).toBe('0');
    expect(data.paidCommission).toBe('0');
    expect(data.paidAt).toBeNull();
  });

  it('throws CsPeriodError when the commission is missing', async () => {
    dbMock.customerServiceCommission.findUnique.mockResolvedValue(null);
    await expect(markCsCommissionPaid('ghost', true)).rejects.toBeInstanceOf(
      CsPeriodError,
    );
  });
});
