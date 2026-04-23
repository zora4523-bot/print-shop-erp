import { SalaryRuleType } from '../../generated/prisma/enums';
import { db } from '../db';
import type { MachineSalaryRule } from './machine-piecework';
import type { CsTiersConfig } from './cs-commission';

// Picks the currently-effective WORKER_MACHINE rule for a given
// MachineType. Rules are versioned via (ruleType, ruleKey, effectiveFrom);
// "currently effective" = latest effectiveFrom <= now, and either
// effectiveTo is null or > now.
//
// Returns null if no active rule exists — the caller (e.g. reportTask)
// should refuse to proceed rather than default to zero, since that
// silently pays the worker nothing.

export type MachineRuleWithBase = MachineSalaryRule & { dailyBase: string | number };

export async function getActiveMachineRule(
  machineType: string,
  now: Date = new Date(),
): Promise<MachineRuleWithBase | null> {
  const rule = await db.salaryRule.findFirst({
    where: {
      ruleType: SalaryRuleType.WORKER_MACHINE,
      ruleKey: machineType,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { ruleValue: true },
  });
  if (!rule) return null;
  // ruleValue is Json in Prisma; the seed shape is
  // { dailyBase, pieceRate, boardRate, smallOrderThreshold,
  //   smallOrderFlatPrice, multiplierFactors }.
  // We trust the seed / owner-side rule editor to validate on write.
  return rule.ruleValue as unknown as MachineRuleWithBase;
}

// ─────────────────────────────────────────────────────────────────────
// CS (客服) rules — SPEC §5.3
// ─────────────────────────────────────────────────────────────────────
//
// Three rule keys under ruleType=CS_COMMISSION:
//   - CS_BASE_SALARY:  ruleValue = { monthlyBase: number }
//   - CS_PERIOD_LENGTH: ruleValue = { months: number }
//   - CS_TIERS:        ruleValue = { mode: 'FLAT', tiers: [...] }
//
// All three together define the commission scheme. We fetch the
// active version of each at period start / settle time and snapshot
// the tier config onto CustomerServiceCommission (via tierRate +
// totalSales, which is enough to reproduce the applied tier).

async function getActiveCsRule<T>(
  ruleKey: string,
  now: Date,
): Promise<T | null> {
  const rule = await db.salaryRule.findFirst({
    where: {
      ruleType: SalaryRuleType.CS_COMMISSION,
      ruleKey,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { ruleValue: true },
  });
  if (!rule) return null;
  return rule.ruleValue as unknown as T;
}

export async function getActiveCsMonthlyBase(
  now: Date = new Date(),
): Promise<number | null> {
  const v = await getActiveCsRule<{ monthlyBase: number }>(
    'CS_BASE_SALARY',
    now,
  );
  return v?.monthlyBase ?? null;
}

export async function getActiveCsPeriodLength(
  now: Date = new Date(),
): Promise<number | null> {
  const v = await getActiveCsRule<{ months: number }>('CS_PERIOD_LENGTH', now);
  return v?.months ?? null;
}

export async function getActiveCsTiers(
  now: Date = new Date(),
): Promise<CsTiersConfig | null> {
  return getActiveCsRule<CsTiersConfig>('CS_TIERS', now);
}

// ─────────────────────────────────────────────────────────────────────
// 时薪工 (PACKER / CLEANER / COOK) rules — SPEC §5.4
// ─────────────────────────────────────────────────────────────────────
//
// Rule keys under WORKER_HOURLY:
//   - PACKER_HOURLY:    { hourlyRate }
//   - CLEANER_HOURLY:   { hourlyRate }
//   - COOK_SPARE_HOURLY:{ hourlyRate }  // = PACKER rate per SPEC §5.4
//   - OT_MULTIPLIER:    { multiplier }
//   - WORK_HOURS:       { morning, afternoon, otStart } — 不硬编码
//
// COOK_MONTHLY lives under its own ruleType COOK_SALARY for the same
// dictionary-family-per-rule pattern.

async function getActiveHourlyRule<T>(
  ruleKey: string,
  now: Date,
): Promise<T | null> {
  const rule = await db.salaryRule.findFirst({
    where: {
      ruleType: SalaryRuleType.WORKER_HOURLY,
      ruleKey,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { ruleValue: true },
  });
  if (!rule) return null;
  return rule.ruleValue as unknown as T;
}

export async function getActivePackerHourlyRate(
  now: Date = new Date(),
): Promise<number | null> {
  const v = await getActiveHourlyRule<{ hourlyRate: number }>(
    'PACKER_HOURLY',
    now,
  );
  return v?.hourlyRate ?? null;
}

export async function getActiveCleanerHourlyRate(
  now: Date = new Date(),
): Promise<number | null> {
  const v = await getActiveHourlyRule<{ hourlyRate: number }>(
    'CLEANER_HOURLY',
    now,
  );
  return v?.hourlyRate ?? null;
}

// COOK 空闲时间打包按 PACKER 时薪的独立规则（SPEC §5.4 "spare_pay =
// attendance.spareHours * packer_rule.hourlyRate"）。单独一条规则
// key 让老板可以把"厨师打包兼职时薪"和主 PACKER_HOURLY 解耦调整。
export async function getActiveCookSpareHourlyRate(
  now: Date = new Date(),
): Promise<number | null> {
  const v = await getActiveHourlyRule<{ hourlyRate: number }>(
    'COOK_SPARE_HOURLY',
    now,
  );
  return v?.hourlyRate ?? null;
}

export async function getActiveOtMultiplier(
  now: Date = new Date(),
): Promise<number | null> {
  const v = await getActiveHourlyRule<{ multiplier: number }>(
    'OT_MULTIPLIER',
    now,
  );
  return v?.multiplier ?? null;
}

export type WorkHoursConfig = {
  morning: { start: string; end: string };
  afternoon: { start: string; end: string };
  // Hour (inclusive lower bound) at which OT starts. `>= otStart`
  // counts as OT per DECISIONS 2026-04-24.
  otStart: string;
};

// SPEC §5.4 / §3.9: 正常工时段 + 加班起始，用于考勤录入 UI 的"全勤"
// 快速填 hint；严格要求从 SalaryRule 读（注意事项 5），不得硬编码。
export async function getActiveWorkHours(
  now: Date = new Date(),
): Promise<WorkHoursConfig | null> {
  return getActiveHourlyRule<WorkHoursConfig>('WORK_HOURS', now);
}

// COOK_SALARY / COOK_MONTHLY — separate ruleType from WORKER_HOURLY.
export async function getActiveCookMonthlyBase(
  now: Date = new Date(),
): Promise<number | null> {
  const rule = await db.salaryRule.findFirst({
    where: {
      ruleType: SalaryRuleType.COOK_SALARY,
      ruleKey: 'COOK_MONTHLY',
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { ruleValue: true },
  });
  if (!rule) return null;
  const v = rule.ruleValue as unknown as { monthlyBase: number };
  return v?.monthlyBase ?? null;
}
