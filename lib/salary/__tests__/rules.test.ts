import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SalaryRuleType } from '../../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    salaryRule: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import { getActiveWorkHours } from '../rules';

beforeEach(() => {
  dbMock.salaryRule.findFirst.mockReset();
});

function mockRule(byKey: Record<string, unknown>) {
  dbMock.salaryRule.findFirst.mockImplementation(async (args: {
    where: { ruleKey: string; ruleType: SalaryRuleType };
  }) => {
    const value = byKey[args.where.ruleKey];
    return value === undefined ? null : { ruleValue: value };
  });
}

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

  it('reads WORKER_HOURLY/WORK_HOURS within its effective window', async () => {
    mockRule({});
    const now = new Date('2026-05-01T00:00:00Z');
    await getActiveWorkHours(now);
    const where = dbMock.salaryRule.findFirst.mock.calls[0]![0].where;
    expect(where.ruleType).toBe(SalaryRuleType.WORKER_HOURLY);
    expect(where.ruleKey).toBe('WORK_HOURS');
    expect(where.effectiveFrom.lte).toEqual(now);
    expect(where.OR).toContainEqual({ effectiveTo: null });
    expect(where.OR).toContainEqual({ effectiveTo: { gt: now } });
  });

  it('returns null when rule is missing (UI must tolerate and show a no-hint state)', async () => {
    mockRule({});
    expect(await getActiveWorkHours()).toBeNull();
  });
});
