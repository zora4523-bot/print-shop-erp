import Decimal from 'decimal.js';
import {
  CsSalesEntryType,
  Prisma,
  SalaryPeriodStatus,
} from '../../generated/prisma/client';
import { parseStrictYmd } from '../auth/schemas';
import { todayShanghai } from '../dashboard/shanghai-clock';
import { csUserLockKey } from './cs-lock';

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

export class CsSalesLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsSalesLedgerError';
  }
}

export class CsSalesPeriodMissingError extends CsSalesLedgerError {
  constructor(
    message = '客服当前业务日期没有可用的工资周期，为避免漏记销售额，操作已取消',
  ) {
    super(message);
    this.name = 'CsSalesPeriodMissingError';
  }
}

/**
 * Verifies that an already-submitted order's immutable CS ledger currently
 * reconciles to the order amount before appending a change or cancellation.
 * This deliberately blocks legacy orders that only contributed to a
 * period-level opening adjustment: whether such an order was included in the
 * old aggregate cannot be inferred safely.
 */
export async function assertCsOrderSalesLedgerReconciledInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  expectedOrderTotal: Decimal.Value,
): Promise<void> {
  const expected = new Decimal(expectedOrderTotal);
  if (!expected.isFinite() || expected.decimalPlaces() > 2) {
    throw new CsSalesLedgerError('工单当前金额不合法，无法核对客服业绩流水');
  }
  const aggregate = await tx.csSalesEntry.aggregate({
    where: { orderId },
    _sum: { amount: true },
  });
  const recorded = new Decimal(aggregate._sum.amount ?? 0);
  if (!recorded.eq(expected)) {
    throw new CsSalesLedgerError(
      `工单客服业绩流水未与当前金额对平（流水 ¥${recorded.toFixed(
        2,
      )}，工单 ¥${expected.toFixed(2)}）；请先完成历史财务校准再修改或取消`,
    );
  }
}

// SalaryPeriod boundaries are PostgreSQL DATE values. Prisma exposes DATE as
// UTC-midnight Date objects, whereas sales events are real instants. Convert an
// event to its Shanghai calendar date before comparing the two domains.
function shanghaiDateColumnValue(at: Date): Date {
  const value = parseStrictYmd(todayShanghai(at));
  if (!value) {
    // todayShanghai always emits a valid YYYY-MM-DD for a valid Date. Keep the
    // guard so an invalid internal timestamp cannot be silently misattributed.
    throw new Error('客服业绩发生时间非法');
  }
  return value;
}

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
  if (Number.isNaN(input.occurredAt.getTime())) {
    throw new CsSalesLedgerError('客服业绩发生时间不合法');
  }
  const amount = new Decimal(input.amount);
  if (!amount.isFinite() || amount.isZero()) return null;
  if (amount.decimalPlaces() > 2 || amount.abs().gt('9999999999.99')) {
    throw new CsSalesLedgerError(
      '客服销售额变动必须是两位小数且不超过 9,999,999,999.99 元',
    );
  }
  const normalizedAmount = amount.toFixed(2);

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${csUserLockKey(
    input.csUserId,
  )}))`;

  const existing = await tx.csSalesEntry.findUnique({
    where: { eventKey: input.eventKey },
    select: {
      id: true,
      eventKey: true,
      csUserId: true,
      salaryPeriodId: true,
      orderId: true,
      orderRevision: true,
      type: true,
      amount: true,
      occurredAt: true,
      remark: true,
    },
  });
  if (existing) {
    if (
      existing.csUserId !== input.csUserId ||
      existing.orderId !== (input.orderId ?? null) ||
      existing.orderRevision !== (input.orderRevision ?? null) ||
      existing.type !== input.type ||
      !new Decimal(existing.amount).eq(normalizedAmount) ||
      existing.occurredAt.getTime() !== input.occurredAt.getTime() ||
      existing.remark !== (input.remark?.trim() || null)
    ) {
      throw new CsSalesLedgerError(
        '客服销售额事件标识已被不同内容使用，操作已取消',
      );
    }
    return {
      entryId: existing.id,
      periodId: existing.salaryPeriodId,
      amount: String(existing.amount),
    };
  }

  const occurredOn = shanghaiDateColumnValue(input.occurredAt);

  const period = await tx.salaryPeriod.findFirst({
    where: {
      csUserId: input.csUserId,
      status: SalaryPeriodStatus.IN_PROGRESS,
      periodStart: { lte: occurredOn },
      periodEnd: { gte: occurredOn },
    },
    select: { id: true, totalSales: true, initialSales: true },
  });
  if (!period) throw new CsSalesPeriodMissingError();

  const nextTotal = new Decimal(period.totalSales).plus(normalizedAmount);
  if (nextTotal.abs().gt('9999999999.99')) {
    throw new CsSalesLedgerError(
      '客服周期累计销售额超过可保存上限，操作已取消',
    );
  }
  const nextTierSales = nextTotal.plus(period.initialSales);
  if (nextTierSales.abs().gt('9999999999.99')) {
    throw new CsSalesLedgerError(
      '客服周期算档业绩（累计销售额 + 期初校准）超过可保存上限，操作已取消',
    );
  }
  const entry = await tx.csSalesEntry.create({
    data: {
      eventKey: input.eventKey,
      csUserId: input.csUserId,
      salaryPeriodId: period.id,
      orderId: input.orderId,
      orderRevision: input.orderRevision,
      type: input.type,
      amount: normalizedAmount,
      occurredAt: input.occurredAt,
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
