import Decimal from 'decimal.js';

// Versioned business decision, effective on Shanghai work dates. Never change
// this version retrospectively; frozen settlements keep their own snapshot.
export const DAILY_MINIMUM = { version: 1, effectiveFrom: '2026-10-06', amount: '100.00' } as const;

/** Reversed/mistaken registrations alone are not proof of a worked day. */
export function hasMinimumProduction(reports: readonly { operation: { id: string }; reportedCompletedQty: Decimal.Value }[],
  wages: readonly { job: { workDate: Date | null; completedQty: Decimal.Value | null } }[], workDate: string): boolean {
  const quantities = new Map<string, Decimal>();
  for (const report of reports) quantities.set(report.operation.id, (quantities.get(report.operation.id) ?? new Decimal(0)).plus(report.reportedCompletedQty));
  return [...quantities.values()].some(quantity => quantity.gt(0)) || wages.some(wage =>
    wage.job.workDate?.toISOString().slice(0, 10) === workDate && new Decimal(wage.job.completedQty ?? 0).gt(0));
}

export function dailyMinimumPay(commission: Decimal.Value, workDate: string, eligible: boolean) {
  const amount = new Decimal(commission);
  if (!amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > 2) throw new Error('当日提成金额无效');
  const applies = workDate >= DAILY_MINIMUM.effectiveFrom && eligible;
  const payable = applies ? Decimal.max(amount, DAILY_MINIMUM.amount) : amount;
  return { reportAmount: amount.toFixed(2), adjustmentAmount: payable.minus(amount).toFixed(2), payableAmount: payable.toFixed(2), applies };
}

export function hasDailyMinimum(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  const rule = (snapshot as Record<string, unknown>).dailyMinimum;
  return !!rule && typeof rule === 'object' && !Array.isArray(rule) && (rule as Record<string, unknown>).applies === true;
}

export function settlementAdjustmentLabel(snapshot: unknown): string {
  return hasDailyMinimum(snapshot) ? '日薪补足' : '调整';
}

/** A late completion consumes the frozen floor before creating extra wages. */
export function lateCommissionDifference(baseCommission: Decimal.Value, frozenPayable: Decimal.Value, earlierLateCommission: Decimal.Value, commission: Decimal.Value): string {
  const before = new Decimal(baseCommission).plus(earlierLateCommission);
  return Decimal.max(before.plus(commission), frozenPayable).minus(Decimal.max(before, frozenPayable)).toFixed(2);
}
