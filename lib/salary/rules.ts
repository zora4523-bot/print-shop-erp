import { SalaryRuleType } from '../../generated/prisma/enums';
import { db } from '../db';
import type { MachineSalaryRule } from './machine-piecework';

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
