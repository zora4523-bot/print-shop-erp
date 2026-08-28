import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import {
  MachineType,
  OrderStatus,
  PieceworkOperationType,
  PieceworkPriceBookStatus,
  ProductionOperationStatus,
  ProductionReportEntryType,
  ProductionReportSource,
  Role,
  WorkerType,
} from '../../generated/prisma/enums';
import { databaseNow } from '../background-jobs/clock';
import { db } from '../db';
import { orderCascadeLockKey } from '../order/locks';
import { transitionOrder } from '../order/status-machine';
import {
  maybeCompleteProductionOrder,
  type ProductionCompletionTx,
} from '../production-completion';
import { calculatePieceworkAmount } from '../salary/piecework-pricing';

export type OperationReportInput = {
  operationId: string;
  completedQty: number;
  defectQty: number;
  reworkQty: number;
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
  operationType: true,
  unit: true,
  status: true,
  plannedQty: true,
  order: { select: { id: true, orderNo: true, status: true } },
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

type ReportableOperation = Prisma.ProductionOperationGetPayload<{
  select: typeof OPERATION_REPORT_SELECT;
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
  if (completed.plus(defect).plus(rework).eq(0)) {
    throw new OperationReportingError(
      'INVALID_INPUT',
      '合格、缺陷和返工数不能全为 0',
    );
  }
  return { idempotencyKey, completed, defect, rework };
}

function operationLockKey(operationId: string): string {
  return `print-shop-erp:production-operation:${operationId}`;
}

function idempotencyLockKey(idempotencyKey: string): string {
  return `print-shop-erp:production-report-idempotency:${idempotencyKey}`;
}

export type OperationReporterAccount = {
  role: Role;
  isActive: boolean;
  workerType: WorkerType | null;
  machineType: MachineType | null;
};

/** One account has one fixed operation lane; capabilities never widen it. */
export function operationTypeForReporterAccount(
  account: OperationReporterAccount,
): PieceworkOperationType | null {
  if (account.role !== Role.WORKER || !account.isActive) return null;
  if (account.workerType === WorkerType.PACKER) {
    return PieceworkOperationType.PACKING;
  }
  if (
    account.workerType === WorkerType.MACHINE &&
    account.machineType === MachineType.HAND_PRESS
  ) {
    return PieceworkOperationType.PARTIAL;
  }
  if (
    account.workerType === WorkerType.MACHINE &&
    account.machineType === MachineType.WINDMILL
  ) {
    return PieceworkOperationType.FULL;
  }
  return null;
}

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
    report.reworkQty.toString() === String(input.reworkQty)
  );
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
  return db.$transaction(async (tx) => {
    const locator = await tx.productionOperation.findUnique({
      where: { id: input.operationId },
      select: { id: true, orderId: true },
    });
    if (!locator) {
      throw new OperationReportingError(
        'OPERATION_NOT_FOUND',
        '生产工序不存在',
      );
    }

    // Order -> operation -> request is the single lock order for reporting.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      locator.orderId,
    )}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operationLockKey(
      input.operationId,
    )}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyLockKey(
      parsed.idempotencyKey,
    )}))`;

    const [operation, account, existingReport] = await Promise.all([
      tx.productionOperation.findUnique({
        where: { id: input.operationId },
        select: OPERATION_REPORT_SELECT,
      }),
      tx.user.findUnique({
        where: { id: actor.id },
        select: {
          id: true,
          role: true,
          isActive: true,
          workerType: true,
          machineType: true,
        },
      }),
      tx.productionReport.findUnique({
        where: { idempotencyKey: parsed.idempotencyKey },
        select: {
          id: true,
          operationId: true,
          reporterId: true,
          entryType: true,
          reportedCompletedQty: true,
          defectQty: true,
          reworkQty: true,
          amount: true,
          operation: {
            select: { status: true, orderId: true, order: { select: { status: true } } },
          },
        },
      }),
    ]);
    if (!operation) {
      throw new OperationReportingError(
        'OPERATION_NOT_FOUND',
        '生产工序不存在',
      );
    }
    if (
      !account ||
      actor.role !== Role.WORKER ||
      account.role !== actor.role
    ) {
      throw new OperationReportingError(
        'ACCOUNT_NOT_AUTHORIZED',
        '报工账号无效或已变更岗位',
      );
    }
    assertReporterCanPerform(operation.operationType, account);

    if (existingReport) {
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
      operation.order.status !== OrderStatus.IN_PRODUCTION
    ) {
      throw new OperationReportingError(
        'ORDER_NOT_REPORTABLE',
        `工单状态 ${operation.order.status} 不允许报工`,
      );
    }

    const plan = plannedCompletedPieces(operation);
    const aggregate = await tx.productionReport.aggregate({
      where: { operationId: operation.id },
      _sum: {
        reportedCompletedQty: true,
        defectQty: true,
        reworkQty: true,
      },
    });
    const alreadyCompleted = new Decimal(
      aggregate._sum.reportedCompletedQty?.toString() ?? 0,
    );
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

    const reportedAt = await databaseNow(tx);
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
    }

    const remainingOperations = await tx.productionOperation.count({
      where: {
        orderId: operation.orderId,
        status: {
          notIn: [
            ProductionOperationStatus.COMPLETED,
            ProductionOperationStatus.CANCELLED,
          ],
        },
      },
    });
    if (remainingOperations === 0) {
      // Reuse the existing outsource/coverage completion gate only after the
      // new operation ledger is complete. The helper may also see transitional
      // legacy tasks; that can delay completion but can never complete early.
      const completion = await maybeCompleteProductionOrder(
        tx as unknown as ProductionCompletionTx,
        operation.orderId,
        account.id,
        reportedAt,
      );
      if (completion.completed) orderStatus = OrderStatus.COMPLETED;
    }

    return {
      reportId: report.id,
      operationId: operation.id,
      orderId: operation.orderId,
      operationStatus,
      orderStatus,
      completedAggregate: completedAggregate.toString(),
      amount: priced.amount,
      idempotentReplay: false,
    };
  });
}
