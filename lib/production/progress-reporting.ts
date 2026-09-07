import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import {
  OrderStatus,
  ProductionOperationStatus,
  Role,
} from '../../generated/prisma/enums';
import { databaseNow } from '../background-jobs/clock';
import { db } from '../db';
import { orderCascadeLockKey } from '../order/locks';
import { transitionOrder } from '../order/status-machine';
import {
  dispatchProductionCompletionNotification,
  maybeCompleteProductionOrder,
  type ProductionCompletionNotification,
  type ProductionCompletionTx,
} from '../production-completion';
import {
  ensureFirstProductionScanClaimInTx,
  WorkOrderProgressError,
} from './work-order-progress';

export type ProgressReportInput = {
  progressStepId: string;
  completedQty: number;
  defectQty: number;
  reworkQty: number;
  idempotencyKey: string;
};

export type ProgressReportActor = {
  id: string;
  role: Role;
};

export type ProgressReportResult = {
  reportId: string;
  progressStepId: string;
  orderId: string;
  progressStatus: ProductionOperationStatus;
  orderStatus: OrderStatus;
  completedAggregate: string;
  idempotentReplay: boolean;
};

type ProgressReportTransactionResult = {
  result: ProgressReportResult;
  notification?: ProductionCompletionNotification;
};

export type ProgressReportingErrorCode =
  | 'INVALID_INPUT'
  | 'PROGRESS_STEP_NOT_FOUND'
  | 'PROGRESS_STEP_NOT_REPORTABLE'
  | 'ORDER_NOT_REPORTABLE'
  | 'ACCOUNT_NOT_AUTHORIZED'
  | 'OVER_REPORT'
  | 'IDEMPOTENCY_CONFLICT';

export class ProgressReportingError extends Error {
  constructor(
    public readonly code: ProgressReportingErrorCode,
    message: string,
    public readonly detail: unknown = null,
  ) {
    super(message);
    this.name = 'ProgressReportingError';
  }
}

const PROGRESS_REPORT_SELECT = {
  id: true,
  orderId: true,
  workOrderVersion: true,
  status: true,
  plannedQty: true,
  craftCode: true,
  craftName: true,
  orderItem: { select: { id: true, sequence: true } },
  order: {
    select: {
      id: true,
      orderNo: true,
      status: true,
      scheduledAt: true,
      workOrderVersion: true,
    },
  },
} satisfies Prisma.ProductionProgressStepSelect;

const MAX_QUANTITY = new Decimal('99999999999.999');

function quantity(value: number, label: string): Decimal {
  const parsed = new Decimal(value);
  if (
    !parsed.isFinite() ||
    parsed.isNegative() ||
    !parsed.isInteger() ||
    parsed.gt(MAX_QUANTITY)
  ) {
    throw new ProgressReportingError(
      'INVALID_INPUT',
      `${label}必须是有限非负整数`,
    );
  }
  return parsed;
}

function validateInput(input: ProgressReportInput) {
  if (!input.progressStepId.trim()) {
    throw new ProgressReportingError('INVALID_INPUT', '进度步骤参数缺失');
  }
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new ProgressReportingError(
      'INVALID_INPUT',
      '幂等键长度必须为 8–128 个字符',
    );
  }
  const completed = quantity(input.completedQty, '合格完成数');
  const defect = quantity(input.defectQty, '缺陷数');
  const rework = quantity(input.reworkQty, '返工数');
  if (completed.plus(defect).plus(rework).eq(0)) {
    throw new ProgressReportingError(
      'INVALID_INPUT',
      '合格、缺陷和返工数不能全为 0',
    );
  }
  return { idempotencyKey, completed, defect, rework };
}

function progressStepLockKey(progressStepId: string): string {
  return `print-shop-erp:production-progress-step:${progressStepId}`;
}

function idempotencyLockKey(idempotencyKey: string): string {
  return `print-shop-erp:production-progress-report-idempotency:${idempotencyKey}`;
}

function sameIdempotentRequest(
  report: {
    progressStepId: string;
    reporterId: string;
    completedQty: { toString(): string };
    defectQty: { toString(): string };
    reworkQty: { toString(): string };
  },
  input: ProgressReportInput,
  actor: ProgressReportActor,
): boolean {
  return (
    report.progressStepId === input.progressStepId &&
    report.reporterId === actor.id &&
    report.completedQty.toString() === String(input.completedQty) &&
    report.defectQty.toString() === String(input.defectQty) &&
    report.reworkQty.toString() === String(input.reworkQty)
  );
}

async function reportProductionProgressInTx(
  tx: Prisma.TransactionClient,
  input: ProgressReportInput,
  actor: ProgressReportActor,
  parsed: ReturnType<typeof validateInput>,
): Promise<ProgressReportTransactionResult> {
    const locator = await tx.productionProgressStep.findUnique({
      where: { id: input.progressStepId },
      select: { id: true, orderId: true },
    });
    if (!locator) {
      throw new ProgressReportingError(
        'PROGRESS_STEP_NOT_FOUND',
        '生产进度步骤不存在',
      );
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      locator.orderId,
    )}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${progressStepLockKey(
      input.progressStepId,
    )}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyLockKey(
      parsed.idempotencyKey,
    )}))`;

    const [step, account, existingReport] = await Promise.all([
      tx.productionProgressStep.findUnique({
        where: { id: input.progressStepId },
        select: PROGRESS_REPORT_SELECT,
      }),
      tx.user.findUnique({
        where: { id: actor.id },
        select: { id: true, role: true, isActive: true },
      }),
      tx.productionProgressReport.findUnique({
        where: { idempotencyKey: parsed.idempotencyKey },
        select: {
          id: true,
          progressStepId: true,
          reporterId: true,
          completedQty: true,
          defectQty: true,
          reworkQty: true,
          progressStep: {
            select: {
              status: true,
              orderId: true,
              order: { select: { status: true, scheduledAt: true } },
            },
          },
        },
      }),
    ]);
    if (!step) {
      throw new ProgressReportingError(
        'PROGRESS_STEP_NOT_FOUND',
        '生产进度步骤不存在',
      );
    }
    if (
      !account ||
      actor.role !== Role.WORKER ||
      account.role !== actor.role ||
      !account.isActive
    ) {
      throw new ProgressReportingError(
        'ACCOUNT_NOT_AUTHORIZED',
        '报工账号无效或已停用',
      );
    }

    if (existingReport) {
      if (!sameIdempotentRequest(existingReport, input, actor)) {
        throw new ProgressReportingError(
          'IDEMPOTENCY_CONFLICT',
          '同一幂等键已用于不同的报工请求',
        );
      }
      const aggregate = await tx.productionProgressReport.aggregate({
        where: { progressStepId: existingReport.progressStepId },
        _sum: { completedQty: true },
      });
      return {
        result: {
          reportId: existingReport.id,
          progressStepId: existingReport.progressStepId,
          orderId: existingReport.progressStep.orderId,
          progressStatus: existingReport.progressStep.status,
          orderStatus: existingReport.progressStep.order.status,
          completedAggregate:
            aggregate._sum.completedQty?.toString() ?? '0',
          idempotentReplay: true,
        },
      };
    }

    if (step.workOrderVersion !== step.order.workOrderVersion) {
      throw new ProgressReportingError(
        'PROGRESS_STEP_NOT_REPORTABLE',
        `该生产进度属于已作废的工单 v${step.workOrderVersion}`,
      );
    }

    if (
      step.status === ProductionOperationStatus.COMPLETED ||
      step.status === ProductionOperationStatus.CANCELLED
    ) {
      throw new ProgressReportingError(
        'PROGRESS_STEP_NOT_REPORTABLE',
        '该生产进度已终态，不能再追加报工',
      );
    }
    if (
      step.order.status !== OrderStatus.SCHEDULING &&
      step.order.status !== OrderStatus.IN_PRODUCTION &&
      step.order.status !== OrderStatus.RELEASED &&
      step.order.status !== OrderStatus.FOILING &&
      step.order.status !== OrderStatus.PACKING
    ) {
      throw new ProgressReportingError(
        'ORDER_NOT_REPORTABLE',
        `工单状态 ${step.order.status} 不允许报工`,
      );
    }

    const aggregate = await tx.productionProgressReport.aggregate({
      where: { progressStepId: step.id },
      _sum: { completedQty: true },
    });
    const alreadyCompleted = new Decimal(
      aggregate._sum.completedQty?.toString() ?? 0,
    );
    const completedAggregate = alreadyCompleted.plus(parsed.completed);
    const plannedQty = new Decimal(step.plannedQty.toString());
    if (completedAggregate.gt(plannedQty)) {
      throw new ProgressReportingError(
        'OVER_REPORT',
        `累计合格完成数 ${completedAggregate.toString()} 超过计划 ${plannedQty.toString()}`,
        {
          plannedQty: plannedQty.toString(),
          alreadyCompleted: alreadyCompleted.toString(),
          submittedCompleted: parsed.completed.toString(),
        },
      );
    }

    const reportedAt = await databaseNow(tx);
    const report = await tx.productionProgressReport.create({
      data: {
        progressStepId: step.id,
        reporterId: account.id,
        completedQty: parsed.completed.toString(),
        defectQty: parsed.defect.toString(),
        reworkQty: parsed.rework.toString(),
        idempotencyKey: parsed.idempotencyKey,
        reportedAt,
      },
      select: { id: true },
    });

    if (
      step.order.status === OrderStatus.RELEASED ||
      step.order.status === OrderStatus.FOILING ||
      step.order.status === OrderStatus.PACKING
    ) {
      try {
        await ensureFirstProductionScanClaimInTx(
          tx,
          {
            orderId: step.orderId,
            workOrderVersion: step.order.workOrderVersion,
            operationId: null,
            progressStepId: step.id,
            reporterId: account.id,
            idempotencyKey: parsed.idempotencyKey,
            orderStatus: step.order.status,
            scheduledAt: step.order.scheduledAt,
            claimedAt: reportedAt,
          },
          { source: 'REPORT' },
        );
      } catch (error) {
        if (error instanceof WorkOrderProgressError) {
          throw new ProgressReportingError(
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

    const progressStatus = completedAggregate.eq(plannedQty)
      ? ProductionOperationStatus.COMPLETED
      : ProductionOperationStatus.IN_PROGRESS;
    if (step.status !== progressStatus) {
      await tx.productionProgressStep.update({
        where: { id: step.id },
        data: { status: progressStatus },
      });
    }

    let orderStatus: OrderStatus = step.order.status;
    if (orderStatus === OrderStatus.SCHEDULING) {
      transitionOrder(orderStatus, OrderStatus.IN_PRODUCTION);
      await tx.order.update({
        where: { id: step.orderId },
        data: { status: OrderStatus.IN_PRODUCTION },
      });
      await tx.orderLog.create({
        data: {
          orderId: step.orderId,
          operatorId: account.id,
          action: 'STATUS_CHANGE',
          changedFields: {
            status: {
              before: OrderStatus.SCHEDULING,
              after: OrderStatus.IN_PRODUCTION,
            },
          },
          remark: `进度步骤 ${step.craftCode} 首次扫码报工`,
        },
      });
      orderStatus = OrderStatus.IN_PRODUCTION;
    }

    let notification: ProductionCompletionNotification | undefined;
    if (progressStatus === ProductionOperationStatus.COMPLETED) {
      const completion = await maybeCompleteProductionOrder(
        tx as unknown as ProductionCompletionTx,
        step.orderId,
        account.id,
        reportedAt,
      );
      if (completion.orderStatus) orderStatus = completion.orderStatus;
      notification = completion.notification;
    }

    return {
      result: {
        reportId: report.id,
        progressStepId: step.id,
        orderId: step.orderId,
        progressStatus,
        orderStatus,
        completedAggregate: completedAggregate.toString(),
        idempotentReplay: false,
      },
      ...(notification ? { notification } : {}),
    };
}

/**
 * Append one no-pay progress report. The verified session actor is the only
 * reporter identity; any active WORKER may report it because there is no
 * personnel-to-order matching for these steps.
 */
export async function reportProductionProgress(
  input: ProgressReportInput,
  actor: ProgressReportActor,
): Promise<ProgressReportResult> {
  const parsed = validateInput(input);
  const committed = await db.$transaction((tx) =>
    reportProductionProgressInTx(tx, input, actor, parsed),
  );
  await dispatchProductionCompletionNotification(committed.notification);
  return committed.result;
}
