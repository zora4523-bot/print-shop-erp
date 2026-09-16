import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import { fullFoilColorCount, calculateFoilJobWage } from './foil-wage';

type FoilOperation = {
  id: string; operationType: string; payrollPassCount: number | null;
  carriedCompletedQty: { toString(): string };
  sources: Array<{ orderItem: { quantity: number; frontFoilColors: string[]; backFoilColors: string[] } | null }>;
};
export async function priceFoilReport(tx: Prisma.TransactionClient, input: {
  operation: FoilOperation; reporterId: string; priceBookId: string; completedQty: string;
  baseAmount: string; passCount: number;
  rule: { amount: { toString(): string }; smallOrderAmount?: { toString(): string } | null; setupAmount?: { toString(): string } | null };
}) {
  const { operation, rule } = input;
  if (rule.smallOrderAmount == null || rule.setupAmount == null || operation.operationType === 'PACKING') return null;
  const previous = await tx.productionReport.findMany({
    where: { operationId: operation.id, entryType: 'REPORT', reversedBy: null, reportedCompletedQty: { gt: 0 } },
    select: { reporterId: true, priceBookId: true, snapshot: true, reportedCompletedQty: true },
  });
  let multiplier = input.passCount;
  let ambiguous = false;
  if (operation.operationType === 'FULL') {
    try {
      const counts = operation.sources.map((source) => source.orderItem ? fullFoilColorCount(source.orderItem.frontFoilColors, source.orderItem.backFoilColors) : 0);
      ambiguous = counts.length === 0 || counts.some((count) => count !== counts[0] || count === 0);
      multiplier = counts[0] || 1;
    } catch { ambiguous = true; }
  }
  const quantity = operation.sources.reduce((sum, source) => sum + (source.orderItem?.quantity ?? 0), 0);
  const carried = new Decimal(operation.carriedCompletedQty.toString()).gt(0);
  const reviewRequired = ambiguous || carried || previous.some((report) => {
    const snapshot = report.snapshot as { payroll?: { passCount?: number } } | null;
    return report.reporterId !== input.reporterId || report.priceBookId !== input.priceBookId || (snapshot?.payroll?.passCount != null && operation.operationType === 'PARTIAL' && snapshot.payroll.passCount !== multiplier);
  });
  // A mixed-colour combined operation needs a human to assign its per-style work.
  if (ambiguous) return { amount: input.baseAmount, wageSupplement: '0.00', reviewRequired, detail: { mode: 'MANUAL', reason: '合并款式颜色数不一致，需人工核定' } };
  const job = calculateFoilJobWage(quantity, multiplier, { pieceRate: rule.amount.toString(), smallOrderAmount: rule.smallOrderAmount.toString(), setupAmount: rule.setupAmount.toString() });
  const completed = new Decimal(input.completedQty);
  const fixedAmount = previous.length === 0 && !carried && completed.gt(0) ? new Decimal(job.fixedAmount) : new Decimal(0);
  const previousQty = previous.filter((report) => report.reporterId === input.reporterId && report.priceBookId === input.priceBookId).reduce((sum, report) => sum.plus(report.reportedCompletedQty.toString()), new Decimal(0));
  const cumulativeAmount = (qty: Decimal) => qty.mul(multiplier).mul(rule.amount.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const pieceAmount = job.band === 'SMALL' ? new Decimal(0) : cumulativeAmount(previousQty.plus(completed)).minus(cumulativeAmount(previousQty));
  const amount = pieceAmount.plus(fixedAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { amount: amount.toFixed(2), wageSupplement: amount.minus(input.baseAmount).toFixed(2), reviewRequired,
    detail: { mode: 'TIERED', band: job.band, orderQuantity: quantity, multiplier, smallOrderAmount: rule.smallOrderAmount.toString(), setupRate: rule.setupAmount.toString(), pieceAmount: pieceAmount.toFixed(2), fixedAmount: fixedAmount.toFixed(2), fixedAlreadyRecorded: previous.length > 0 || carried } };
}
