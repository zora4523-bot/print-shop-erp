import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import {
  OrderStatus,
  PieceworkOperationType,
  PieceworkPriceBookStatus,
  ProductionOperationStatus,
  ProductionReportEntryType,
  ProductionReportSource,
  ProductionWorkOrderStage,
  Role,
} from '../../generated/prisma/enums';
import { databaseClockNow } from '../background-jobs/clock';
import { parseStrictYmd } from '../auth/schemas';
import { todayShanghai } from '../dashboard/shanghai-clock';
import { db } from '../db';
import { orderCascadeLockKey } from '../order/locks';
import { transitionOrder } from '../order/status-machine';
import {
  dispatchProductionCompletionNotification,
  maybeCompleteProductionOrder,
  type ProductionCompletionNotification,
  type ProductionCompletionTx,
} from '../production-completion';
import { calculatePieceworkAmount } from '../salary/piecework-pricing';
import {
  pieceworkReportingDayGateLockKey,
  pieceworkSettlementLockKey,
} from '../salary/piecework-lock';
import { employmentCoversDate } from '../salary/employment';
import {
  operationTypeForReporterAccount,
  type OperationReporterAccount,
} from './reporter-operation-lane';
import { salaryIdentityLockKey } from '../salary/hourly-lock';
import {
  appendWorkOrderProgressInTx,
  assertWorkOrderProgressCapacityInTx,
  ensureFirstProductionScanClaimInTx,
  parseWorkOrderProgressQuantity,
  workOrderStageForOperation,
  WorkOrderProgressError,
} from './work-order-progress';

export type OperationReportInput = {
  operationId: string;
  completedQty: number;
  defectQty: number;
  reworkQty: number;
  /**
   * Independent work-order piece progress. It is required for canonical
   * RELEASED/FOILING/PACKING orders and is never derived from payroll units.
   * Optional only so legacy SCHEDULING/IN_PRODUCTION callers can drain safely.
   */
  workOrderProgressQuantity?: number;
  idempotencyKey: string;
};

export type OperationReportActor = {
  id: string;
  role: Role;
};

export type OperationReportResult = {
  reportId: string;
  operationId: string;
  orderId: string;
  operationStatus: ProductionOperationStatus;
  orderStatus: OrderStatus;
  completedAggregate: string;
  amount: string;
  idempotentReplay: boolean;
};

export type OperationReportingErrorCode =
  | 'INVALID_INPUT'
  | 'OPERATION_NOT_FOUND'
  | 'OPERATION_NOT_REPORTABLE'
  | 'ORDER_NOT_REPORTABLE'
  | 'ACCOUNT_NOT_AUTHORIZED'
  | 'PARTIAL_SOURCE_AMBIGUOUS'
  | 'OVER_REPORT'
  | 'WORK_ORDER_PROGRESS_REQUIRED'
  | 'OVER_WORK_ORDER_PROGRESS'
  | 'REPORTING_DAY_SETTLED'
  | 'PIECEWORK_RATE_UNAVAILABLE'
  | 'IDEMPOTENCY_CONFLICT';

export class OperationReportingError extends Error {
  constructor(
    public readonly code: OperationReportingErrorCode,
    message: string,
    public readonly detail: unknown = null,
  ) {
    super(message);
    this.name = 'OperationReportingError';
  }
}

const OPERATION_REPORT_SELECT = {
  id: true,
  orderId: true,
  workOrderVersion: true,
  operationType: true,
  unit: true,
  status: true,
  plannedQty: true,
  carriedCompletedQty: true,
  order: {
    select: {
      id: true,
      orderNo: true,
      status: true,
      scheduledAt: true,
      workOrderVersion: true,
    },
  },
  sources: {
    select: {
      sourceType: true,
      sourceQty: true,
      orderItemId: true,
      packagingGroupId: true,
      orderItem: {
        select: {
          id: true,
          sequence: true,
          quantity: true,
          frontFoilColors: true,
          backFoilColors: true,
        },
      },
      packagingGroup: {
        select: { id: true, sequence: true, actualBagCount: true },
      },
    },
  },
} satisfies Prisma.ProductionOperationSelect;

const REPORTER_ACCOUNT_SELECT = {
  id: true,
  role: true,
  isActive: true,
  workerType: true,
  machineType: true,
  employmentStartDate: true,
  employmentEndDate: true,
} satisfies Prisma.UserSelect;

const IDEMPOTENT_REPORT_SELECT = {
  id: true,
  operationId: true,
  reporterId: true,
  entryType: true,
  reportedCompletedQty: true,
  defectQty: true,
  reworkQty: true,
  amount: true,
  workOrderProgress: {
    select: {
      stage: true,
      workOrderProgressQuantity: true,
      idempotencyKey: true,
    },
  },
  operation: {
    select: {
      status: true,
      orderId: true,
      order: { select: { status: true, scheduledAt: true } },
    },
  },
} satisfies Prisma.ProductionReportSelect;

type ReportableOperation = Prisma.ProductionOperationGetPayload<{
  select: typeof OPERATION_REPORT_SELECT;
}>;

type ReporterAccount = Prisma.UserGetPayload<{
  select: typeof REPORTER_ACCOUNT_SELECT;
}>;

type IdempotentReport = Prisma.ProductionReportGetPayload<{
  select: typeof IDEMPOTENT_REPORT_SELECT;
}>;

const MAX_QUANTITY = new Decimal('99999999999.999');

function quantity(value: number, label: string): Decimal {
  const parsed = new Decimal(value);
  if (
    !parsed.isFinite() ||
    parsed.isNegative() ||
    !parsed.isInteger() ||
    parsed.gt(MAX_QUANTITY)
  ) {
    throw new OperationReportingError(
      'INVALID_INPUT',
      `${label}必须是有限非负整数`,
    );
  }
  return parsed;
}

function validateInput(input: OperationReportInput) {
  if (!input.operationId.trim()) {
    throw new OperationReportingError('INVALID_INPUT', '工序参数缺失');
  }
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new OperationReportingError(
      'INVALID_INPUT',
      '幂等键长度必须为 8–128 个字符',
    );
  }
  const completed = quantity(input.completedQty, '合格完成数');
  const defect = quantity(input.defectQty, '缺陷数');
  const rework = quantity(input.reworkQty, '返工数');
  let workOrderProgress: Decimal | null = null;
  if (input.workOrderProgressQuantity !== undefined) {
    try {
      workOrderProgress = parseWorkOrderProgressQuantity(
        input.workOrderProgressQuantity,
      );
    } catch (error) {
      if (error instanceof WorkOrderProgressError) {
        throw new OperationReportingError(
          'INVALID_INPUT',
          error.message,
          error.detail,
        );
      }
      throw error;
    }
  }
  if (completed.plus(defect).plus(rework).eq(0)) {
    throw new OperationReportingError(
      'INVALID_INPUT',
      '合格、缺陷和返工数不能全为 0',
    );
  }
  return {
    idempotencyKey,
    completed,
    defect,
    rework,
    workOrderProgress,
  };
}

function operationLockKey(operationId: string): string {
  return `print-shop-erp:production-operation:${operationId}`;
}

function idempotencyLockKey(idempotencyKey: string): string {
  return `print-shop-erp:production-report-idempotency:${idempotencyKey}`;
}

async function lockCurrentPieceworkReportingDay(
  tx: Prisma.TransactionClient,
  reporterId: string,
): Promise<{ reportedAt: Date; workDate: string; workDateCol: Date }> {
  let reportedAt = await databaseClockNow(tx);
  let workDate = todayShanghai(reportedAt);

  // Normally one iteration. The loop closes the narrow case where Shanghai
  // midnight passes while this transaction waits for the batch discovery
  // gate: after acquiring the old gate, move forward to the new open day.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pieceworkReportingDayGateLockKey(
      workDate,
    )}))`;
    const confirmedAt = await databaseClockNow(tx);
    const confirmedWorkDate = todayShanghai(confirmedAt);
    if (confirmedWorkDate === workDate) {
      const workDateCol = parseStrictYmd(workDate);
      if (!workDateCol) {
        throw new OperationReportingError(
          'INVALID_INPUT',
          '数据库报工日期非法',
        );
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pieceworkSettlementLockKey(
        reporterId,
        workDate,
      )}))`;
      return { reportedAt: confirmedAt, workDate, workDateCol };
    }
    reportedAt = confirmedAt;
    workDate = confirmedWorkDate;
  }

  throw new OperationReportingError(
    'INVALID_INPUT',
    `数据库报工日期在事务内持续变化（最后时点 ${reportedAt.toISOString()}）`,
  );
}

export { operationTypeForReporterAccount } from './reporter-operation-lane';

function assertReporterCanPerform(
  operationType: PieceworkOperationType,
  account: OperationReporterAccount,
): void {
  if (operationTypeForReporterAccount(account) !== operationType) {
    throw new OperationReportingError(
      'ACCOUNT_NOT_AUTHORIZED',
      '当前账号的固定工序岗位与该工序不符',
    );
  }
}

function plannedCompletedPieces(operation: ReportableOperation): {
  plannedPieces: Decimal;
  passCount: number;
  evidence: Array<Record<string, unknown>>;
} {
  if (operation.operationType === PieceworkOperationType.PARTIAL) {
    let commonPassCount: number | null = null;
    let plannedPieces = new Decimal(0);
    const evidence: Array<Record<string, unknown>> = [];
    for (const source of operation.sources) {
      const item = source.orderItem;
      if (!item || source.packagingGroupId !== null) {
        throw new OperationReportingError(
          'PARTIAL_SOURCE_AMBIGUOUS',
          'PARTIAL 工序必须只引用款式来源',
        );
      }
      const passCount =
        item.frontFoilColors.length + item.backFoilColors.length;
      const expectedSourceQty = new Decimal(item.quantity).mul(passCount);
      if (
        passCount <= 0 ||
        !expectedSourceQty.eq(source.sourceQty) ||
        (commonPassCount !== null && commonPassCount !== passCount)
      ) {
        throw new OperationReportingError(
          'PARTIAL_SOURCE_AMBIGUOUS',
          'PARTIAL 工序的款式数、过版数或来源数量不一致',
        );
      }
      commonPassCount = passCount;
      plannedPieces = plannedPieces.plus(item.quantity);
      evidence.push({
        orderItemId: item.id,
        sequence: item.sequence,
        plannedPieces: String(item.quantity),
        passCount,
        plannedPasses: source.sourceQty.toString(),
      });
    }
    if (
      commonPassCount === null ||
      !plannedPieces.mul(commonPassCount).eq(operation.plannedQty)
    ) {
      throw new OperationReportingError(
        'PARTIAL_SOURCE_AMBIGUOUS',
        'PARTIAL 工序的计划数无法从来源唯一还原',
      );
    }
    return { plannedPieces, passCount: commonPassCount, evidence };
  }

  if (operation.sources.length === 0) {
    throw new OperationReportingError(
      'OPERATION_NOT_REPORTABLE',
      '工序缺少可追溯来源',
    );
  }
  for (const source of operation.sources) {
    if (operation.operationType === PieceworkOperationType.FULL) {
      if (
        !source.orderItem ||
        source.packagingGroupId !== null ||
        !new Decimal(source.orderItem.quantity).eq(source.sourceQty)
      ) {
        throw new OperationReportingError(
          'OPERATION_NOT_REPORTABLE',
          'FULL 工序必须以款式件数作为唯一来源数量',
        );
      }
    } else if (operation.operationType === PieceworkOperationType.PACKING) {
      if (
        !source.packagingGroup ||
        source.orderItemId !== null ||
        !new Decimal(source.packagingGroup.actualBagCount).eq(source.sourceQty)
      ) {
        throw new OperationReportingError(
          'OPERATION_NOT_REPORTABLE',
          'PACKING 工序必须以包装组实际袋数作为唯一来源数量',
        );
      }
    }
  }
  const sourceTotal = operation.sources.reduce(
    (total, source) => total.plus(source.sourceQty),
    new Decimal(0),
  );
  if (!sourceTotal.eq(operation.plannedQty)) {
    throw new OperationReportingError(
      'OPERATION_NOT_REPORTABLE',
      '工序计划数与来源数量不一致',
    );
  }
  return {
    plannedPieces: new Decimal(operation.plannedQty.toString()),
    passCount: 1,
    evidence: operation.sources.map((source) => ({
      orderItemId: source.orderItemId,
      packagingGroupId: source.packagingGroupId,
      sourceQty: source.sourceQty.toString(),
    })),
  };
}

function sameIdempotentRequest(
  report: {
    operationId: string;
    reporterId: string;
    entryType: string;
    reportedCompletedQty: { toString(): string };
    defectQty: { toString(): string };
    reworkQty: { toString(): string };
    workOrderProgress?: null | {
      stage: ProductionWorkOrderStage;
      workOrderProgressQuantity: { toString(): string };
      idempotencyKey: string;
    };
  },
  input: OperationReportInput,
  actor: OperationReportActor,
): boolean {
  return (
    report.operationId === input.operationId &&
    report.reporterId === actor.id &&
    report.entryType === ProductionReportEntryType.REPORT &&
    report.reportedCompletedQty.toString() === String(input.completedQty) &&
    report.defectQty.toString() === String(input.defectQty) &&
    report.reworkQty.toString() === String(input.reworkQty) &&
    (input.workOrderProgressQuantity === undefined
      ? report.workOrderProgress == null
      : report.workOrderProgress?.workOrderProgressQuantity.toString() ===
          String(input.workOrderProgressQuantity) &&
        report.workOrderProgress.idempotencyKey === input.idempotencyKey)
  );
}

type ValidatedOperationReportInput = ReturnType<typeof validateInput>;
type OperationCompletionPlan = ReturnType<typeof plannedCompletedPieces>;

async function loadLockedOperationContext(
  tx: Prisma.TransactionClient,
  input: OperationReportInput,
  actor: OperationReportActor,
  parsed: ValidatedOperationReportInput,
): Promise<{
  operation: ReportableOperation;
  account: ReporterAccount;
  existingReport: IdempotentReport | null;
}> {
  const locator = await tx.productionOperation.findUnique({
    where: { id: input.operationId },
    select: { id: true, orderId: true },
  });
  if (!locator) {
    throw new OperationReportingError('OPERATION_NOT_FOUND', '生产工序不存在');
  }

  // Lock order is part of the write protocol. Keep these awaits sequential.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
    locator.orderId,
  )}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operationLockKey(
    input.operationId,
  )}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyLockKey(
    parsed.idempotencyKey,
  )}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(
    actor.id,
  )}))`;

  const [operation, account, existingReport] = await Promise.all([
    tx.productionOperation.findUnique({
      where: { id: input.operationId },
      select: OPERATION_REPORT_SELECT,
    }),
    tx.user.findUnique({
      where: { id: actor.id },
      select: REPORTER_ACCOUNT_SELECT,
    }),
    tx.productionReport.findUnique({
      where: { idempotencyKey: parsed.idempotencyKey },
      select: IDEMPOTENT_REPORT_SELECT,
    }),
  ]);
  if (!operation) {
    throw new OperationReportingError('OPERATION_NOT_FOUND', '生产工序不存在');
  }
  if (!account || actor.role !== Role.WORKER || account.role !== actor.role) {
    throw new OperationReportingError(
      'ACCOUNT_NOT_AUTHORIZED',
      '报工账号无效或已变更岗位',
    );
  }
  assertReporterCanPerform(operation.operationType, account);
  return { operation, account, existingReport };
}

function replayIdempotentReport(
  existingReport: IdempotentReport,
  input: OperationReportInput,
  actor: OperationReportActor,
): OperationReportResult {
  if (!sameIdempotentRequest(existingReport, input, actor)) {
    throw new OperationReportingError(
      'IDEMPOTENCY_CONFLICT',
      '同一幂等键已用于不同的报工请求',
    );
  }
  return {
    reportId: existingReport.id,
    operationId: existingReport.operationId,
    orderId: existingReport.operation.orderId,
    operationStatus: existingReport.operation.status,
    orderStatus: existingReport.operation.order.status,
    completedAggregate: existingReport.reportedCompletedQty.toString(),
    amount: existingReport.amount.toFixed(2),
    idempotentReplay: true,
  };
}

function assertOperationIsReportable(operation: ReportableOperation): void {
  if (operation.workOrderVersion !== operation.order.workOrderVersion) {
    throw new OperationReportingError(
      'OPERATION_NOT_REPORTABLE',
      `该工序属于已作废的工单 v${operation.workOrderVersion}`,
    );
  }
  if (
    operation.status === ProductionOperationStatus.COMPLETED ||
    operation.status === ProductionOperationStatus.CANCELLED
  ) {
    throw new OperationReportingError(
      'OPERATION_NOT_REPORTABLE',
      '该工序已终态，不能再追加报工',
    );
  }
  if (
    operation.order.status !== OrderStatus.SCHEDULING &&
    operation.order.status !== OrderStatus.IN_PRODUCTION &&
    operation.order.status !== OrderStatus.RELEASED &&
    operation.order.status !== OrderStatus.FOILING &&
    operation.order.status !== OrderStatus.PACKING
  ) {
    throw new OperationReportingError(
      'ORDER_NOT_REPORTABLE',
      `工单状态 ${operation.order.status} 不允许报工`,
    );
  }
}

async function computeCompletedAggregate(
  tx: Prisma.TransactionClient,
  operation: ReportableOperation,
  plan: OperationCompletionPlan,
  parsed: ValidatedOperationReportInput,
): Promise<Decimal> {
  const aggregate = await tx.productionReport.aggregate({
    where: { operationId: operation.id },
    _sum: { reportedCompletedQty: true, defectQty: true, reworkQty: true },
  });
  const alreadyCompleted = new Decimal(
    aggregate._sum.reportedCompletedQty?.toString() ?? 0,
  ).plus(operation.carriedCompletedQty?.toString() ?? 0);
  const completedAggregate = alreadyCompleted.plus(parsed.completed);
  if (completedAggregate.gt(plan.plannedPieces)) {
    throw new OperationReportingError(
      'OVER_REPORT',
      `累计合格完成数 ${completedAggregate.toString()} 超过计划 ${plan.plannedPieces.toString()}`,
      {
        plannedQty: plan.plannedPieces.toString(),
        alreadyCompleted: alreadyCompleted.toString(),
        submittedCompleted: parsed.completed.toString(),
      },
    );
  }
  return completedAggregate;
}

function isCanonicalProductionStatus(status: OrderStatus): boolean {
  return (
    status === OrderStatus.RELEASED ||
    status === OrderStatus.FOILING ||
    status === OrderStatus.PACKING
  );
}

type PreparedWorkOrderProgress = {
  stage: ProductionWorkOrderStage;
  quantity: Decimal;
  orderTotal: Decimal;
  afterReport: Decimal;
};

async function prepareWorkOrderProgress(
  tx: Prisma.TransactionClient,
  operation: ReportableOperation,
  parsed: ValidatedOperationReportInput,
): Promise<PreparedWorkOrderProgress | null> {
  if (
    isCanonicalProductionStatus(operation.order.status) &&
    parsed.workOrderProgress === null
  ) {
    throw new OperationReportingError(
      'WORK_ORDER_PROGRESS_REQUIRED',
      '已下发工单必须单独填写本次工单件数进度',
    );
  }
  if (parsed.workOrderProgress === null) return null;

  const stage = workOrderStageForOperation(operation.operationType);
  try {
    const capacity = await assertWorkOrderProgressCapacityInTx(tx, {
      orderId: operation.orderId,
      workOrderVersion: operation.workOrderVersion,
      stage,
      quantity: parsed.workOrderProgress,
    });
    return {
      stage,
      quantity: parsed.workOrderProgress,
      orderTotal: capacity.orderTotal,
      afterReport: capacity.afterReport,
    };
  } catch (error) {
    if (error instanceof WorkOrderProgressError) {
      throw new OperationReportingError(
        error.code === 'OVER_WORK_ORDER_PROGRESS'
          ? 'OVER_WORK_ORDER_PROGRESS'
          : 'INVALID_INPUT',
        error.message,
        error.detail,
      );
    }
    throw error;
  }
}

async function appendPricedProductionReport(
  tx: Prisma.TransactionClient,
  operation: ReportableOperation,
  account: ReporterAccount,
  plan: OperationCompletionPlan,
  parsed: ValidatedOperationReportInput,
): Promise<{ reportId: string; reportedAt: Date; amount: string }> {
  // The locks above are followed by reporting-day gate -> reporter/day.
  const { reportedAt, workDate, workDateCol } =
    await lockCurrentPieceworkReportingDay(tx, account.id);
  if (!employmentCoversDate(workDateCol, account)) {
    throw new OperationReportingError(
      'ACCOUNT_NOT_AUTHORIZED',
      `报工日 ${workDate} 不在当前账号的雇佣区间内`,
      { workDate },
    );
  }
  const closedSettlement = await tx.pieceworkSettlement.findUnique({
    where: {
      reporterId_workDate: { reporterId: account.id, workDate: workDateCol },
    },
    select: { status: true },
  });
  if (closedSettlement) {
    throw new OperationReportingError(
      'REPORTING_DAY_SETTLED',
      `报工日 ${workDate} 的计件工资已经 ${closedSettlement.status}，本次报工未写入；请刷新后在当前工作日重试`,
      { workDate, settlementStatus: closedSettlement.status },
    );
  }

  const books = await tx.pieceworkPriceBook.findMany({
    where: {
      status: PieceworkPriceBookStatus.PUBLISHED,
      effectiveFrom: { lte: reportedAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: reportedAt } }],
    },
    select: {
      id: true,
      version: true,
      ruleSetSha256: true,
      rules: {
        where: { operationType: operation.operationType },
        select: { operationType: true, unit: true, amount: true },
      },
    },
    take: 2,
  });
  const book = books[0];
  const rule = book?.rules[0];
  if (
    books.length !== 1 ||
    !book ||
    !book.ruleSetSha256 ||
    book.rules.length !== 1 ||
    !rule ||
    rule.amount === null ||
    rule.unit !== operation.unit
  ) {
    throw new OperationReportingError(
      'PIECEWORK_RATE_UNAVAILABLE',
      '当前时点没有唯一、完整且已发布的工序工价',
    );
  }

  const priced = calculatePieceworkAmount(
    {
      operationType: operation.operationType,
      completedQty: parsed.completed.toString(),
      defectQty: parsed.defect.toString(),
      reworkQty: parsed.rework.toString(),
      ...(operation.operationType === PieceworkOperationType.PARTIAL
        ? { passCount: plan.passCount }
        : {}),
    },
    {
      operationType: rule.operationType,
      unit: rule.unit,
      amount: rule.amount.toString(),
    },
  );
  const report = await tx.productionReport.create({
    data: {
      operationId: operation.id,
      reporterId: account.id,
      entryType: ProductionReportEntryType.REPORT,
      source: ProductionReportSource.LIVE,
      reportedCompletedQty: priced.completedQty,
      defectQty: priced.excludedDefectQty,
      reworkQty: priced.excludedReworkQty,
      chargeableQty: priced.chargeableQty,
      unit: priced.unit,
      rate: priced.rate,
      amount: priced.amount,
      priceBookId: book.id,
      priceBookVersion: book.version,
      ruleSetSha256: book.ruleSetSha256,
      snapshot: {
        schemaVersion: 1,
        reporterId: account.id,
        operation: {
          id: operation.id,
          operationType: operation.operationType,
          unit: operation.unit,
          plannedQty: operation.plannedQty.toString(),
          plannedCompletedPieces: plan.plannedPieces.toString(),
          passCount: plan.passCount,
          sources: plan.evidence,
        },
        submitted: {
          completedQty: priced.completedQty,
          defectQty: priced.excludedDefectQty,
          reworkQty: priced.excludedReworkQty,
          workOrderProgressQuantity:
            parsed.workOrderProgress?.toString() ?? null,
        },
        payroll: {
          defectAndReworkExcluded: true,
          chargeableQty: priced.chargeableQty,
          rate: priced.rate,
          amount: priced.amount,
          priceBookId: book.id,
          priceBookVersion: book.version,
          ruleSetSha256: book.ruleSetSha256,
        },
      } as Prisma.InputJsonValue,
      idempotencyKey: parsed.idempotencyKey,
      reportedAt,
    },
    select: { id: true },
  });
  return { reportId: report.id, reportedAt, amount: priced.amount };
}

async function advanceProductionAfterReport(
  tx: Prisma.TransactionClient,
  operation: ReportableOperation,
  account: ReporterAccount,
  plan: OperationCompletionPlan,
  completedAggregate: Decimal,
  reportedAt: Date,
): Promise<{
  operationStatus: ProductionOperationStatus;
  orderStatus: OrderStatus;
  notification?: ProductionCompletionNotification;
}> {
  const operationStatus = completedAggregate.eq(plan.plannedPieces)
    ? ProductionOperationStatus.COMPLETED
    : ProductionOperationStatus.IN_PROGRESS;
  if (operation.status !== operationStatus) {
    await tx.productionOperation.update({
      where: { id: operation.id },
      data: { status: operationStatus },
    });
  }

  let orderStatus: OrderStatus = operation.order.status;
  if (orderStatus === OrderStatus.SCHEDULING) {
    transitionOrder(orderStatus, OrderStatus.IN_PRODUCTION);
    await tx.order.update({
      where: { id: operation.orderId },
      data: { status: OrderStatus.IN_PRODUCTION },
    });
    await tx.orderLog.create({
      data: {
        orderId: operation.orderId,
        operatorId: account.id,
        action: 'STATUS_CHANGE',
        changedFields: {
          status: {
            before: OrderStatus.SCHEDULING,
            after: OrderStatus.IN_PRODUCTION,
          },
        },
        remark: `工序 ${operation.operationType} 首次扫码报工`,
      },
    });
    orderStatus = OrderStatus.IN_PRODUCTION;
  } else if (isCanonicalProductionStatus(orderStatus)) {
    const stage = workOrderStageForOperation(operation.operationType);
    const targetStatus =
      stage === ProductionWorkOrderStage.PACKING
        ? OrderStatus.PACKING
        : OrderStatus.FOILING;
    const shouldAdvance =
      (orderStatus === OrderStatus.RELEASED &&
        (targetStatus === OrderStatus.FOILING ||
          targetStatus === OrderStatus.PACKING)) ||
      (orderStatus === OrderStatus.FOILING &&
        targetStatus === OrderStatus.PACKING);
    if (shouldAdvance) {
      transitionOrder(orderStatus, targetStatus);
      await tx.order.update({
        where: { id: operation.orderId },
        data: { status: targetStatus },
      });
      await tx.orderLog.create({
        data: {
          orderId: operation.orderId,
          operatorId: account.id,
          action: 'STATUS_CHANGE',
          changedFields: {
            status: { before: orderStatus, after: targetStatus },
          },
          remark: `${stage === ProductionWorkOrderStage.FOILING ? '烫金' : '打包'}工序首次有效扫码报工`,
        },
      });
      orderStatus = targetStatus;
    }
  }

  let notification: ProductionCompletionNotification | undefined;
  // The shared gate now has two effects: legacy orders still transition to
  // COMPLETED, while canonical orders converge on PACKING and emit the
  // production-ready notification once every current unit and outsource row
  // is complete. Calling it only when this operation reaches terminal state
  // avoids redundant reads on partial reports.
  if (operationStatus === ProductionOperationStatus.COMPLETED) {
    const completion = await maybeCompleteProductionOrder(
      tx as unknown as ProductionCompletionTx,
      operation.orderId,
      account.id,
      reportedAt,
    );
    if (completion.orderStatus) orderStatus = completion.orderStatus;
    notification = completion.notification;
  }
  return { operationStatus, orderStatus, notification };
}

type OperationReportTransactionResult = {
  result: OperationReportResult;
  notification?: ProductionCompletionNotification;
};

async function reportProductionOperationInTx(
  tx: Prisma.TransactionClient,
  input: OperationReportInput,
  actor: OperationReportActor,
  parsed: ValidatedOperationReportInput,
): Promise<OperationReportTransactionResult> {
  const { operation, account, existingReport } =
    await loadLockedOperationContext(tx, input, actor, parsed);
  if (existingReport) {
    return { result: replayIdempotentReport(existingReport, input, actor) };
  }

  assertOperationIsReportable(operation);
  const plan = plannedCompletedPieces(operation);
  const workOrderProgress = await prepareWorkOrderProgress(
    tx,
    operation,
    parsed,
  );
  const completedAggregate = await computeCompletedAggregate(
    tx,
    operation,
    plan,
    parsed,
  );
  const { reportId, reportedAt, amount } = await appendPricedProductionReport(
    tx,
    operation,
    account,
    plan,
    parsed,
  );
  if (workOrderProgress) {
    await appendWorkOrderProgressInTx(tx, {
      orderId: operation.orderId,
      workOrderVersion: operation.workOrderVersion,
      operationId: operation.id,
      sourceReportId: reportId,
      reporterId: account.id,
      stage: workOrderProgress.stage,
      quantity: workOrderProgress.quantity,
      idempotencyKey: parsed.idempotencyKey,
      reportedAt,
    });
  }
  if (isCanonicalProductionStatus(operation.order.status)) {
    try {
      await ensureFirstProductionScanClaimInTx(
        tx,
        {
          orderId: operation.orderId,
          workOrderVersion: operation.order.workOrderVersion,
          operationId: operation.id,
          progressStepId: null,
          reporterId: account.id,
          idempotencyKey: parsed.idempotencyKey,
          orderStatus: operation.order.status,
          scheduledAt: operation.order.scheduledAt,
          claimedAt: reportedAt,
        },
        { source: 'REPORT' },
      );
    } catch (error) {
      if (error instanceof WorkOrderProgressError) {
        throw new OperationReportingError(
          error.code === 'IDEMPOTENCY_CONFLICT'
            ? 'IDEMPOTENCY_CONFLICT'
            : 'ORDER_NOT_REPORTABLE',
          error.message,
          error.detail,
        );
      }
      throw error;
    }
  }
  const { operationStatus, orderStatus, notification } =
    await advanceProductionAfterReport(
      tx,
      operation,
      account,
      plan,
      completedAggregate,
      reportedAt,
    );
  return {
    result: {
      reportId,
      operationId: operation.id,
      orderId: operation.orderId,
      operationStatus,
      orderStatus,
      completedAggregate: completedAggregate.toString(),
      amount,
      idempotentReplay: false,
    },
    ...(notification ? { notification } : {}),
  };
}

/**
 * Append one immutable operation report. The session actor identifies the
 * reporter; no worker id, assignment, machine candidate, or personal rate is
 * accepted from the caller.
 */
export async function reportProductionOperation(
  input: OperationReportInput,
  actor: OperationReportActor,
): Promise<OperationReportResult> {
  const parsed = validateInput(input);
  const committed = await db.$transaction((tx) =>
    reportProductionOperationInTx(tx, input, actor, parsed),
  );
  await dispatchProductionCompletionNotification(committed.notification);
  return committed.result;
}
