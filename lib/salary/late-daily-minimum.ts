import Decimal from 'decimal.js';
import type { Prisma } from '@/generated/prisma/client';
import { hasDailyMinimum, lateCommissionDifference } from './daily-minimum';

function originalCommission(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.originalEvidence !== undefined) return originalCommission(value.originalEvidence);
  // New records preserve gross commission independently of the supplement.
  const amount = value.lateCommissionAmount;
  if (typeof amount !== 'string') return null;
  const parsed = new Decimal(amount);
  return parsed.isFinite() && !parsed.isNegative() ? parsed.toFixed(2) : null;
}

/** Called under the worker identity + work-day locks, before storing this review. */
export async function lateDailyMinimumEvidence(tx: Prisma.TransactionClient, input: {
  workerId: string; workDate: Date; jobId: string; amount: string | null;
  settlement: { id: string; snapshot: Prisma.JsonValue; reportAmount: Decimal.Value; payableAmount: Decimal.Value };
}) {
  if (!hasDailyMinimum(input.settlement.snapshot)) return { expectedAmount: input.amount, paidAmount: '0' };
  const previous = await tx.productionFactReview.findMany({
    where: { job: { workerId: input.workerId, workDate: input.workDate }, jobId: { not: input.jobId },
      status: { in: ['WAGES_DUE', 'DISMISSED'] } }, select: { evidence: true },
  });
  const amounts = previous.map(row => originalCommission(row.evidence));
  const known = input.amount !== null && amounts.every(amount => amount !== null);
  const earlier = known ? amounts.reduce<Decimal>((sum, amount) => sum.plus(amount!), new Decimal(0)).toFixed(2) : null;
  return { lateCommissionAmount: input.amount, earlierLateCommission: earlier,
    frozenCommission: new Decimal(input.settlement.reportAmount).toFixed(2), frozenPayable: new Decimal(input.settlement.payableAmount).toFixed(2),
    expectedAmount: known ? lateCommissionDifference(input.settlement.reportAmount, input.settlement.payableAmount, earlier!, input.amount!) : null,
    paidAmount: '0', calculation: 'DAILY_MINIMUM_INCREMENT', manualReviewRequired: !known };
}
