import Decimal from 'decimal.js';
import {
  CsSalesEntryType,
  Prisma,
  SalaryPeriodStatus,
} from '../../generated/prisma/client';

function csUserLockKey(csUserId: string): string {
  return `print-shop-erp:cs-user:${csUserId}`;
}

export type RecordCsSalesEntryInput = {
  eventKey: string;
  csUserId: string;
  orderId?: string;
  orderRevision?: number;
  type: CsSalesEntryType;
  amount: Decimal.Value;
  occurredAt: Date;
  remark?: string;
};

/**
 * Appends one idempotent sales-performance entry and updates the active
 * customer-service period in the same transaction. Payment collection is
 * deliberately not part of this ledger: sales are credited when the order
 * is submitted (and adjusted by approved revisions).
 */
export async function recordCsSalesEntryInTx(
  tx: Prisma.TransactionClient,
  input: RecordCsSalesEntryInput,
): Promise<{ entryId: string; periodId: string; amount: string } | null> {
  const amount = new Decimal(input.amount);
  if (!amount.isFinite() || amount.isZero()) return null;

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${csUserLockKey(
    input.csUserId,
  )}))`;

  const existing = await tx.csSalesEntry.findUnique({
    where: { eventKey: input.eventKey },
    select: { id: true, salaryPeriodId: true, amount: true },
  });
  if (existing) {
    return {
      entryId: existing.id,
      periodId: existing.salaryPeriodId,
      amount: String(existing.amount),
    };
  }

  const period = await tx.salaryPeriod.findFirst({
    where: {
      csUserId: input.csUserId,
      status: SalaryPeriodStatus.IN_PROGRESS,
      periodStart: { lte: input.occurredAt },
      periodEnd: { gte: input.occurredAt },
    },
    select: { id: true },
  });
  if (!period) return null;

  const normalizedAmount = amount.toFixed(2);
  const entry = await tx.csSalesEntry.create({
    data: {
      eventKey: input.eventKey,
      csUserId: input.csUserId,
      salaryPeriodId: period.id,
      orderId: input.orderId,
      orderRevision: input.orderRevision,
      type: input.type,
      amount: normalizedAmount,
      remark: input.remark?.trim() || null,
    },
    select: { id: true },
  });
  await tx.salaryPeriod.update({
    where: { id: period.id },
    data: { totalSales: { increment: normalizedAmount } },
    select: { id: true },
  });
  return {
    entryId: entry.id,
    periodId: period.id,
    amount: normalizedAmount,
  };
}
