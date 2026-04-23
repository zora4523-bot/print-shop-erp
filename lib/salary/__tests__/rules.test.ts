import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SalaryRuleType } from '../../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    salaryRule: { findFirst: vi.fn() },
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  getActivePackerHourlyRate,
  getActiveCleanerHourlyRate,
  getActiveCookSpareHourlyRate,
  getActiveOtMultiplier,
  getActiveWorkHours,
  getActiveCookMonthlyBase,
} from '../rules';

beforeEach(() => {
  dbMock.salaryRule.findFirst.mockReset();
});

function mockRule(byKey: Record<string, unknown>) {
  dbMock.salaryRule.findFirst.mockImplementation(async (args: {
    where: { ruleKey: string; ruleType: SalaryRuleType };
  }) => {
    const v = byKey[args.where.ruleKey];
    return v === undefined ? null : { ruleValue: v };
  });
}

describe('getActivePackerHourlyRate / CleanerHourlyRate', () => {
  it('returns hourlyRate when PACKER_HOURLY rule is set', async () => {
    mockRule({ PACKER_HOURLY: { hourlyRate: 11 } });
    expect(await getActivePackerHourlyRate()).toBe(11);
  });

  it('returns null when rule is missing', async () => {
    mockRule({});
    expect(await getActivePackerHourlyRate()).toBeNull();
  });

  it('CLEANER_HOURLY is independent from PACKER_HOURLY', async () => {
    mockRule({ CLEANER_HOURLY: { hourlyRate: 12 } });
    expect(await getActiveCleanerHourlyRate()).toBe(12);
    expect(await getActivePackerHourlyRate()).toBeNull();
  });

  it('queries the effective window (effectiveFrom <= now < effectiveTo)', async () => {
    mockRule({ PACKER_HOURLY: { hourlyRate: 11 } });
    const now = new Date('2026-05-01T00:00:00Z');
    await getActivePackerHourlyRate(now);
    const where = dbMock.salaryRule.findFirst.mock.calls[0][0].where;
    expect(where.ruleType).toBe(SalaryRuleType.WORKER_HOURLY);
    expect(where.ruleKey).toBe('PACKER_HOURLY');
    expect(where.effectiveFrom.lte).toEqual(now);
    expect(where.OR).toContainEqual({ effectiveTo: null });
    expect(where.OR).toContainEqual({ effectiveTo: { gt: now } });
  });
});

describe('getActiveCookSpareHourlyRate', () => {
  it('decouples from PACKER_HOURLY — owner may set its own rate', async () => {
    mockRule({
      PACKER_HOURLY: { hourlyRate: 11 },
      COOK_SPARE_HOURLY: { hourlyRate: 13 },
    });
    expect(await getActiveCookSpareHourlyRate()).toBe(13);
  });

  it('returns null when unset (caller decides whether to fall back)', async () => {
    mockRule({});
    expect(await getActiveCookSpareHourlyRate()).toBeNull();
  });
});

describe('getActiveOtMultiplier', () => {
  it('defaults to seed value 1.0', async () => {
    mockRule({ OT_MULTIPLIER: { multiplier: 1.0 } });
    expect(await getActiveOtMultiplier()).toBe(1.0);
  });

  it('can go above 1.0 when owner adjusts policy', async () => {
    mockRule({ OT_MULTIPLIER: { multiplier: 1.5 } });
    expect(await getActiveOtMultiplier()).toBe(1.5);
  });

  it('returns null when unset (calcHourlyPayroll then defaults to 1.0)', async () => {
    mockRule({});
    expect(await getActiveOtMultiplier()).toBeNull();
  });
});

describe('getActiveWorkHours', () => {
  it('returns { morning, afternoon, otStart } from rule, NOT hardcoded', async () => {
    // The business-critical property here (DECISIONS 2026-04-24 /
    // 注意事项 5): WORK_HOURS comes from the rule table. Changing the
    // rule immediately reflects in the UI's "全勤" hint.
    mockRule({
      WORK_HOURS: {
        morning: { start: '08:00', end: '12:00' },
        afternoon: { start: '13:30', end: '17:30' },
        otStart: '18:00',
      },
    });
    const wh = await getActiveWorkHours();
    expect(wh).toEqual({
      morning: { start: '08:00', end: '12:00' },
      afternoon: { start: '13:30', end: '17:30' },
      otStart: '18:00',
    });
  });

  it('reflects an owner-edited rule (e.g. shifted morning start)', async () => {
    mockRule({
      WORK_HOURS: {
        morning: { start: '09:00', end: '12:00' },
        afternoon: { start: '13:00', end: '18:00' },
        otStart: '19:00',
      },
    });
    const wh = await getActiveWorkHours();
    expect(wh?.morning.start).toBe('09:00');
    expect(wh?.otStart).toBe('19:00');
  });

  it('returns null when rule is missing (UI must tolerate and show a no-hint state)', async () => {
    mockRule({});
    expect(await getActiveWorkHours()).toBeNull();
  });
});

describe('getActiveCookMonthlyBase (COOK_SALARY ruleType, separate from WORKER_HOURLY)', () => {
  it('reads COOK_MONTHLY with COOK_SALARY ruleType', async () => {
    dbMock.salaryRule.findFirst.mockImplementation(async (args: {
      where: { ruleType: SalaryRuleType; ruleKey: string };
    }) => {
      if (
        args.where.ruleType === SalaryRuleType.COOK_SALARY &&
        args.where.ruleKey === 'COOK_MONTHLY'
      ) {
        return { ruleValue: { monthlyBase: 3000 } };
      }
      return null;
    });
    expect(await getActiveCookMonthlyBase()).toBe(3000);
  });

  it('returns null when unset', async () => {
    dbMock.salaryRule.findFirst.mockResolvedValue(null);
    expect(await getActiveCookMonthlyBase()).toBeNull();
  });
});
