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
