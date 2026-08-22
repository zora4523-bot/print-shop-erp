import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MachineType, SalaryRuleType } from '../../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    salaryRule: { findFirst: vi.fn() },
    workerMachineSalaryRule: { findFirst: vi.fn() },
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
  getActiveMachineRule,
} from '../rules';

beforeEach(() => {
  dbMock.salaryRule.findFirst.mockReset();
  dbMock.workerMachineSalaryRule.findFirst.mockReset().mockResolvedValue(null);
});

describe('getActiveMachineRule — personal override priority', () => {
  const globalRule = {
    dailyBase: 100,
    pieceRate: 0.007,
    boardRate: 5,
    smallOrderThreshold: 1000,
    smallOrderFlatPrice: 12,
    multiplierFactors: ['DOUBLE_SIDED'],
  };

  it('prefers the active worker-specific version over the machine default', async () => {
    const personalRule = { ...globalRule, dailyBase: 180, pieceRate: 0.01 };
    dbMock.workerMachineSalaryRule.findFirst.mockResolvedValue({
      ruleValue: personalRule,
    });
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: globalRule });
    const now = new Date('2026-07-19T03:00:00Z');

    await expect(
      getActiveMachineRule(MachineType.HAND_PRESS, now, 'worker-1'),
    ).resolves.toEqual(personalRule);
    expect(dbMock.salaryRule.findFirst).not.toHaveBeenCalled();
    expect(dbMock.workerMachineSalaryRule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workerId: 'worker-1',
          machineType: MachineType.HAND_PRESS,
          effectiveFrom: { lte: now },
        }),
      }),
    );
  });

  it('falls back to the machine default when no personal version is active', async () => {
    dbMock.salaryRule.findFirst.mockResolvedValue({ ruleValue: globalRule });
    await expect(
      getActiveMachineRule(MachineType.HAND_PRESS, new Date(), 'worker-1'),
    ).resolves.toEqual(globalRule);
  });

  it('uses the supplied transaction client for personal and global reads', async () => {
    const txClient = {
      workerMachineSalaryRule: { findFirst: vi.fn().mockResolvedValue(null) },
      salaryRule: {
        findFirst: vi.fn().mockResolvedValue({ ruleValue: globalRule }),
      },
    };
    const now = new Date('2026-07-19T03:00:00Z');

    await expect(
      getActiveMachineRule(
        MachineType.HAND_PRESS,
        now,
        'worker-1',
        txClient,
      ),
    ).resolves.toEqual(globalRule);
    expect(txClient.workerMachineSalaryRule.findFirst).toHaveBeenCalled();
    expect(txClient.salaryRule.findFirst).toHaveBeenCalled();
    expect(dbMock.workerMachineSalaryRule.findFirst).not.toHaveBeenCalled();
    expect(dbMock.salaryRule.findFirst).not.toHaveBeenCalled();
  });
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
