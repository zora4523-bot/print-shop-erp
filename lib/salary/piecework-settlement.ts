import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import {
  PieceworkSettlementStatus,
  Role,
} from '../../generated/prisma/enums';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import { databaseNow } from '../background-jobs/clock';
import { parseStrictYmd } from '../auth/schemas';
import { todayShanghai } from '../dashboard/shanghai-clock';
import { db } from '../db';
import { shanghaiDayRange } from './daily-common';

export type PieceworkSettlementReport = {
  id: string;
  amount: Decimal.Value;
  entryType: string;
  operation: {
    id: string;
    orderId: string;
    operationType: string;
  };
};

export type PieceworkSettlementAggregate = {
  reportAmount: Decimal;
  reportCount: number;
  orderCount: number;
  operationCounts: Record<string, number>;
  reportIds: string[];
};

export type PieceworkSettlementReceipt = {
  id: string;
  reporterId: string;
  reporterName: string;
  workDate: string;
  status: PieceworkSettlementStatus;
  reportAmount: string;
  adjustmentAmount: string;
  payableAmount: string;
  reportCount: number;
  idempotentReplay: boolean;
};

export type PieceworkSettlementBatchResult = {
  settled: PieceworkSettlementReceipt[];
  errors: Array<{ reporterId: string; reporterName: string; message: string }>;
};

export class PieceworkSettlementError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_ACTOR'
      | 'OPEN_WORK_DATE'
      | 'REPORTER_NOT_FOUND'
      | 'NO_REPORTS'
      | 'SETTLEMENT_STATE_CONFLICT'
      | 'SETTLEMENT_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'PieceworkSettlementError';
  }
}

const MAX_SETTLEMENT_AMOUNT = new Decimal('999999999999.99');

function assertAdmin(actor: AuditActor): void {
  if (actor.role !== Role.ADMIN) {
    throw new PieceworkSettlementError(
      'INVALID_ACTOR',
      '只有管理员可以锁定或发放计件结算',
    );
  }
}

function assertClosedWorkDate(workDate: string, now: Date): void {
  // shanghaiDayRange performs the strict calendar-date validation first.
  shanghaiDayRange(workDate);
  if (workDate >= todayShanghai(now)) {
    throw new PieceworkSettlementError(
      'OPEN_WORK_DATE',
      `不能锁定当前或未来日期的计件结算（${workDate}，上海日历）`,
    );
  }
}

export function pieceworkSettlementLockKey(
  reporterId: string,
  workDate: string,
): string {
  return `print-shop-erp:piecework-settlement:${reporterId}:${workDate}`;
}

function settlementDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Read model for the owner list. Candidate reports and frozen settlements are
 * intentionally returned as separate collections: a candidate amount is not
 * finance-of-record until the immutable settlement row exists.
 */
export async function getPieceworkSettlementDay(input: {
  workDate: string;
  reporterId?: string;
  status?: PieceworkSettlementStatus;
}) {
  const dateCol = parseStrictYmd(input.workDate);
  if (!dateCol) {
    throw new PieceworkSettlementError(
      'SETTLEMENT_STATE_CONFLICT',
      `日期格式非法或非法日历日期（应为合法 YYYY-MM-DD）：${input.workDate}`,
    );
  }
  const { start, end } = shanghaiDayRange(input.workDate);
  const [settlements, reports] = await Promise.all([
    db.pieceworkSettlement.findMany({
      where: {
        workDate: dateCol,
        ...(input.reporterId ? { reporterId: input.reporterId } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      orderBy: [{ reporter: { displayName: 'asc' } }, { id: 'asc' }],
      select: {
        id: true,
        reporterId: true,
        workDate: true,
        status: true,
        reportAmount: true,
        adjustmentAmount: true,
        payableAmount: true,
        lockedAt: true,
        paidAt: true,
        reporter: { select: { displayName: true, username: true } },
        _count: { select: { items: true } },
      },
    }),
    db.productionReport.findMany({
      where: {
        reportedAt: { gte: start, lt: end },
        settlementItem: null,
        ...(input.reporterId ? { reporterId: input.reporterId } : {}),
      },
      orderBy: [{ reporter: { displayName: 'asc' } }, { reportedAt: 'asc' }],
      select: {
        id: true,
        reporterId: true,
        amount: true,
        reporter: { select: { displayName: true, username: true } },
        operation: {
          select: { orderId: true, operationType: true },
        },
      },
    }),
  ]);

  const candidates = new Map<
    string,
    {
      reporterId: string;
      reporterName: string;
      username: string;
      reportAmount: Decimal;
      reportCount: number;
      orderIds: Set<string>;
      operationCounts: Record<string, number>;
    }
  >();
  for (const report of reports) {
    const current = candidates.get(report.reporterId) ?? {
      reporterId: report.reporterId,
      reporterName: report.reporter.displayName,
      username: report.reporter.username,
      reportAmount: new Decimal(0),
      reportCount: 0,
      orderIds: new Set<string>(),
      operationCounts: {},
    };
    current.reportAmount = current.reportAmount.plus(report.amount);
    current.reportCount += 1;
    current.orderIds.add(report.operation.orderId);
    current.operationCounts[report.operation.operationType] =
      (current.operationCounts[report.operation.operationType] ?? 0) + 1;
    candidates.set(report.reporterId, current);
  }

  return {
    workDate: input.workDate,
    settlements: settlements.map((row) => ({
      ...row,
      workDate: settlementDateKey(row.workDate),
    })),
    candidates: [...candidates.values()].map((row) => ({
      reporterId: row.reporterId,
      reporterName: row.reporterName,
      username: row.username,
      reportAmount: row.reportAmount.toFixed(2),
      reportCount: row.reportCount,
      orderCount: row.orderIds.size,
      operationCounts: row.operationCounts,
    })),
  };
}

export async function getPieceworkSettlementDetail(
  settlementId: string,
  reporterId?: string,
) {
  return db.pieceworkSettlement.findFirst({
    where: {
      id: settlementId,
      ...(reporterId ? { reporterId } : {}),
    },
    select: {
      id: true,
      reporterId: true,
      workDate: true,
      status: true,
      reportAmount: true,
      adjustmentAmount: true,
      payableAmount: true,
      snapshot: true,
      lockedAt: true,
      paidAt: true,
      createdAt: true,
      reporter: { select: { displayName: true, username: true } },
      items: {
        orderBy: [{ report: { reportedAt: 'asc' } }, { id: 'asc' }],
        select: {
          id: true,
          amount: true,
          snapshot: true,
          report: {
            select: {
              id: true,
              entryType: true,
              reportedCompletedQty: true,
              defectQty: true,
              reworkQty: true,
              chargeableQty: true,
              unit: true,
              rate: true,
              amount: true,
              priceBookVersion: true,
              ruleSetSha256: true,
              reportedAt: true,
              operation: {
                select: {
                  id: true,
                  operationType: true,
                  order: {
                    select: { id: true, orderNo: true, customName: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

export async function listWorkerPieceworkSettlements(input: {
  reporterId: string;
  from?: Date;
  to?: Date;
}) {
  return db.pieceworkSettlement.findMany({
    where: {
      reporterId: input.reporterId,
      workDate:
        input.from || input.to
          ? { gte: input.from, lte: input.to }
          : undefined,
    },
    orderBy: [{ workDate: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      workDate: true,
      status: true,
      reportAmount: true,
      adjustmentAmount: true,
      payableAmount: true,
      lockedAt: true,
      paidAt: true,
      _count: { select: { items: true } },
    },
  });
}

/**
 * Pure aggregation over immutable report snapshots. Reversal entries already
 * carry the exact negative amount, so summing the ledger is sufficient and
 * deliberately does not consult legacy ProductionTask rows or current rates.
 */
export function aggregatePieceworkSettlementReports(
  reports: readonly PieceworkSettlementReport[],
): PieceworkSettlementAggregate {
  let reportAmount = new Decimal(0);
  const orderIds = new Set<string>();
  const operationCounts: Record<string, number> = {};
  const reportIds: string[] = [];
  const seen = new Set<string>();

  for (const report of reports) {
    if (!report.id || seen.has(report.id)) {
      throw new PieceworkSettlementError(
        'SETTLEMENT_STATE_CONFLICT',
        '计件报工账本包含空或重复的 report id',
      );
    }
    seen.add(report.id);
    let amount: Decimal;
    try {
      amount = new Decimal(report.amount);
    } catch {
      throw new PieceworkSettlementError(
        'SETTLEMENT_STATE_CONFLICT',
        `计件报工 ${report.id} 的金额无效`,
      );
    }
    if (!amount.isFinite() || amount.decimalPlaces() > 2) {
      throw new PieceworkSettlementError(
        'SETTLEMENT_STATE_CONFLICT',
        `计件报工 ${report.id} 的金额无效`,
      );
    }
    reportAmount = reportAmount.plus(amount);
    if (reportAmount.abs().gt(MAX_SETTLEMENT_AMOUNT)) {
      throw new PieceworkSettlementError(
        'SETTLEMENT_STATE_CONFLICT',
        '计件结算金额超出可保存范围',
      );
    }
    orderIds.add(report.operation.orderId);
    operationCounts[report.operation.operationType] =
      (operationCounts[report.operation.operationType] ?? 0) + 1;
    reportIds.push(report.id);
  }

  if (reportAmount.isNegative()) {
    throw new PieceworkSettlementError(
      'SETTLEMENT_STATE_CONFLICT',
      '计件结算净额不能小于 0',
    );
  }

  return {
    reportAmount,
    reportCount: reports.length,
    orderCount: orderIds.size,
    operationCounts,
    reportIds,
  };
}

function toReceipt(
  row: {
    id: string;
    reporterId: string;
    workDate: Date;
    status: PieceworkSettlementStatus;
    reportAmount: Decimal.Value;
    adjustmentAmount: Decimal.Value;
    payableAmount: Decimal.Value;
    reporter: { displayName: string };
    _count: { items: number };
  },
  idempotentReplay: boolean,
): PieceworkSettlementReceipt {
  return {
    id: row.id,
    reporterId: row.reporterId,
    reporterName: row.reporter.displayName,
    workDate: row.workDate.toISOString().slice(0, 10),
    status: row.status,
    reportAmount: new Decimal(row.reportAmount).toFixed(2),
    adjustmentAmount: new Decimal(row.adjustmentAmount).toFixed(2),
    payableAmount: new Decimal(row.payableAmount).toFixed(2),
    reportCount: row._count.items,
    idempotentReplay,
  };
}

const SETTLEMENT_RECEIPT_SELECT = {
  id: true,
  reporterId: true,
  workDate: true,
  status: true,
  reportAmount: true,
  adjustmentAmount: true,
  payableAmount: true,
  reporter: { select: { displayName: true } },
  _count: { select: { items: true } },
} satisfies Prisma.PieceworkSettlementSelect;

/**
 * Freeze one reporter's closed Shanghai day into an immutable settlement.
 * The row is created directly as LOCKED because SettlementItem rows are
 * append-only; there is intentionally no delete/rebuild recomputation path.
 */
export async function lockPieceworkSettlement(input: {
  reporterId: string;
  workDate: string;
  actor: AuditActor;
  now?: Date;
}): Promise<PieceworkSettlementReceipt> {
  assertAdmin(input.actor);
  const now = input.now ?? new Date();
  assertClosedWorkDate(input.workDate, now);
  const { start, end } = shanghaiDayRange(input.workDate);
  const dateCol = parseStrictYmd(input.workDate)!;

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pieceworkSettlementLockKey(
      input.reporterId,
      input.workDate,
    )}))`;

    const existing = await tx.pieceworkSettlement.findUnique({
      where: {
        reporterId_workDate: {
          reporterId: input.reporterId,
          workDate: dateCol,
        },
      },
      select: SETTLEMENT_RECEIPT_SELECT,
    });
    if (existing) {
      if (
        existing.status !== PieceworkSettlementStatus.LOCKED &&
        existing.status !== PieceworkSettlementStatus.PAID
      ) {
        throw new PieceworkSettlementError(
          'SETTLEMENT_STATE_CONFLICT',
          '已有未锁定的计件结算，禁止覆盖或重建明细',
        );
      }
      return toReceipt(existing, true);
    }

    const reporter = await tx.user.findUnique({
      where: { id: input.reporterId },
      select: { id: true, displayName: true },
    });
    if (!reporter) {
      throw new PieceworkSettlementError(
        'REPORTER_NOT_FOUND',
        '报工人不存在',
      );
    }

    const reports = await tx.productionReport.findMany({
      where: {
        reporterId: input.reporterId,
        reportedAt: { gte: start, lt: end },
        settlementItem: null,
      },
      orderBy: [{ reportedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        amount: true,
        entryType: true,
        reportedAt: true,
        operation: {
          select: { id: true, orderId: true, operationType: true },
        },
      },
    });
    if (reports.length === 0) {
      throw new PieceworkSettlementError(
        'NO_REPORTS',
        '该报工人在所选日期没有待结算的新工序报工',
      );
    }
    const aggregate = aggregatePieceworkSettlementReports(reports);
    const lockedAt = await databaseNow(tx);
    const snapshot = {
      schemaVersion: 1,
      ledger: 'PRODUCTION_REPORT',
      legacyProductionTaskIncluded: false,
      reporterId: reporter.id,
      workDate: input.workDate,
      range: { start: start.toISOString(), end: end.toISOString() },
      reportIds: aggregate.reportIds,
      reportCount: aggregate.reportCount,
      orderCount: aggregate.orderCount,
      operationCounts: aggregate.operationCounts,
      reportAmount: aggregate.reportAmount.toFixed(2),
      adjustmentAmount: '0.00',
      payableAmount: aggregate.reportAmount.toFixed(2),
      lockedAt: lockedAt.toISOString(),
    } satisfies Prisma.InputJsonObject;

    const created = await tx.pieceworkSettlement.create({
      data: {
        reporterId: reporter.id,
        workDate: dateCol,
        status: PieceworkSettlementStatus.LOCKED,
        reportAmount: aggregate.reportAmount.toFixed(2),
        adjustmentAmount: '0.00',
        payableAmount: aggregate.reportAmount.toFixed(2),
        snapshot,
        lockedAt,
        items: {
          create: reports.map((report) => ({
            reportId: report.id,
            amount: report.amount,
            snapshot: {
              schemaVersion: 1,
              reportId: report.id,
              entryType: report.entryType,
              reportedAt: report.reportedAt.toISOString(),
              operationId: report.operation.id,
              orderId: report.operation.orderId,
              operationType: report.operation.operationType,
              amount: new Decimal(report.amount).toFixed(2),
            } satisfies Prisma.InputJsonObject,
          })),
        },
      },
      select: SETTLEMENT_RECEIPT_SELECT,
    });
    await writeAuditLogInTx(tx, {
      actor: input.actor,
      action: 'LOCK',
      entityType: 'PieceworkSettlement',
      entityId: created.id,
      after: snapshot,
      requestMetadata: { source: 'piecework-settlement' },
    });
    return toReceipt(created, false);
  });
}

/**
 * Locks every reporter that still has an unsettled report on one closed day.
 * Each reporter keeps its own transaction and advisory lock, so one malformed
 * ledger cannot roll back settlements already frozen for other reporters.
 */
export async function lockPieceworkSettlementsForDate(input: {
  workDate: string;
  actor: AuditActor;
  now?: Date;
}): Promise<PieceworkSettlementBatchResult> {
  assertAdmin(input.actor);
  const now = input.now ?? new Date();
  assertClosedWorkDate(input.workDate, now);
  const { start, end } = shanghaiDayRange(input.workDate);
  const reporters = await db.productionReport.findMany({
    where: {
      reportedAt: { gte: start, lt: end },
      settlementItem: null,
    },
    distinct: ['reporterId'],
    orderBy: { reporterId: 'asc' },
    select: {
      reporterId: true,
      reporter: { select: { displayName: true } },
    },
  });
  const settled: PieceworkSettlementReceipt[] = [];
  const errors: PieceworkSettlementBatchResult['errors'] = [];
  for (const reporter of reporters) {
    try {
      settled.push(
        await lockPieceworkSettlement({
          reporterId: reporter.reporterId,
          workDate: input.workDate,
          actor: input.actor,
          now,
        }),
      );
    } catch (error) {
      // Another concurrent locker may consume the final candidate report
      // between the distinct scan and the per-reporter lock. That is a clean
      // idempotent outcome, not a failed payroll.
      if (
        error instanceof PieceworkSettlementError &&
        error.code === 'NO_REPORTS'
      ) {
        continue;
      }
      if (error instanceof PieceworkSettlementError) {
        errors.push({
          reporterId: reporter.reporterId,
          reporterName: reporter.reporter.displayName,
          message: error.message,
        });
        continue;
      }
      throw error;
    }
  }
  return { settled, errors };
}

/** Mark a locked settlement paid. PAID rows are database-protected forever. */
export async function markPieceworkSettlementPaid(input: {
  settlementId: string;
  actor: AuditActor;
}): Promise<PieceworkSettlementReceipt> {
  assertAdmin(input.actor);
  return db.$transaction(async (tx) => {
    const locator = await tx.pieceworkSettlement.findUnique({
      where: { id: input.settlementId },
      select: { reporterId: true, workDate: true },
    });
    if (!locator) {
      throw new PieceworkSettlementError(
        'SETTLEMENT_NOT_FOUND',
        '计件结算不存在',
      );
    }
    const workDate = locator.workDate.toISOString().slice(0, 10);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pieceworkSettlementLockKey(
      locator.reporterId,
      workDate,
    )}))`;
    const current = await tx.pieceworkSettlement.findUnique({
      where: { id: input.settlementId },
      select: SETTLEMENT_RECEIPT_SELECT,
    });
    if (!current) {
      throw new PieceworkSettlementError(
        'SETTLEMENT_NOT_FOUND',
        '计件结算不存在',
      );
    }
    if (current.status === PieceworkSettlementStatus.PAID) {
      return toReceipt(current, true);
    }
    if (current.status !== PieceworkSettlementStatus.LOCKED) {
      throw new PieceworkSettlementError(
        'SETTLEMENT_STATE_CONFLICT',
        '只有已锁定的计件结算可以标记为已发放',
      );
    }
    const paidAt = await databaseNow(tx);
    const updated = await tx.pieceworkSettlement.update({
      where: { id: current.id },
      data: { status: PieceworkSettlementStatus.PAID, paidAt },
      select: SETTLEMENT_RECEIPT_SELECT,
    });
    await writeAuditLogInTx(tx, {
      actor: input.actor,
      action: 'MARK_PAID',
      entityType: 'PieceworkSettlement',
      entityId: updated.id,
      before: { status: current.status, paidAt: null },
      after: { status: updated.status, paidAt: paidAt.toISOString() },
      requestMetadata: { source: 'piecework-settlement' },
    });
    return toReceipt(updated, false);
  });
}
