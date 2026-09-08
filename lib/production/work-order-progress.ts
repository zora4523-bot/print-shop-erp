import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import {
  OrderStatus,
  PieceworkOperationType,
  ProductionOperationStatus,
  ProductionWorkOrderStage,
  Role,
} from '../../generated/prisma/enums';
import { databaseClockNow } from '../background-jobs/clock';
import { db } from '../db';
import { orderCascadeLockKey } from '../order/locks';
import { operationTypeForReporterAccount } from './reporter-operation-lane';

const MAX_QUANTITY = new Decimal('99999999999.999');
const CLAIMABLE_ORDER_STATUSES = new Set<OrderStatus>([
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
]);

export type WorkOrderProgressErrorCode =
  | 'INVALID_INPUT'
  | 'OPERATION_NOT_FOUND'
  | 'ORDER_NOT_RELEASED'
  | 'ACCOUNT_NOT_AUTHORIZED'
  | 'OVER_WORK_ORDER_PROGRESS'
  | 'IDEMPOTENCY_CONFLICT';

export class WorkOrderProgressError extends Error {
  constructor(
    public readonly code: WorkOrderProgressErrorCode,
    message: string,
    public readonly detail: unknown = null,
  ) {
    super(message);
    this.name = 'WorkOrderProgressError';
  }
}

export function workOrderStageForOperation(
  operationType: PieceworkOperationType,
): ProductionWorkOrderStage {
  return operationType === PieceworkOperationType.PACKING
    ? ProductionWorkOrderStage.PACKING
    : ProductionWorkOrderStage.FOILING;
}

export function parseWorkOrderProgressQuantity(
  value: number,
): Decimal {
  const parsed = new Decimal(value);
  if (
    !parsed.isFinite() ||
    parsed.isNegative() ||
    !parsed.isInteger() ||
    parsed.gt(MAX_QUANTITY)
  ) {
    throw new WorkOrderProgressError(
      'INVALID_INPUT',
      '工单进度数必须是有限非负整数',
    );
  }
  return parsed;
}

export type WorkOrderProgressCapacity = {
  orderTotal: Decimal;
  alreadyReported: Decimal;
  afterReport: Decimal;
};

/**
 * Callers must already hold orderCascadeLockKey(orderId). The migration repeats
 * the same lock and cap check so direct SQL cannot bypass the invariant.
 */
export async function assertWorkOrderProgressCapacityInTx(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    workOrderVersion: number;
    stage: ProductionWorkOrderStage;
    quantity: Decimal;
  },
): Promise<WorkOrderProgressCapacity> {
  const [items, progress, carried] = await Promise.all([
    tx.orderItem.aggregate({
      where: { orderId: input.orderId },
      _sum: { quantity: true },
    }),
    tx.productionWorkOrderProgress.aggregate({
      where: {
        orderId: input.orderId,
        workOrderVersion: input.workOrderVersion,
        stage: input.stage,
      },
      _sum: { workOrderProgressQuantity: true },
    }),
    tx.productionOperation.aggregate({
      where: { orderId: input.orderId, workOrderVersion: input.workOrderVersion,
        operationType: input.stage === ProductionWorkOrderStage.PACKING ? PieceworkOperationType.PACKING : { not: PieceworkOperationType.PACKING },
      },
      _sum: { carriedWorkOrderProgressQty: true },
    }),
  ]);
  const orderTotal = new Decimal(items._sum.quantity ?? 0);
  const alreadyReported = new Decimal(
    progress._sum.workOrderProgressQuantity?.toString() ?? 0,
  ).plus(carried._sum.carriedWorkOrderProgressQty?.toString() ?? 0);
  const afterReport = alreadyReported.plus(input.quantity);
  if (orderTotal.lte(0)) {
    throw new WorkOrderProgressError(
      'INVALID_INPUT',
      '工单没有可用的正数总数量，不能报进度',
    );
  }
  if (afterReport.gt(orderTotal)) {
    throw new WorkOrderProgressError(
      'OVER_WORK_ORDER_PROGRESS',
      `${input.stage === ProductionWorkOrderStage.FOILING ? '烫金' : '打包'}累计工单进度 ${afterReport.toString()} 超过工单总数量 ${orderTotal.toString()}`,
      {
        stage: input.stage,
        orderTotal: orderTotal.toString(),
        alreadyReported: alreadyReported.toString(),
        submitted: input.quantity.toString(),
      },
    );
  }
  return { orderTotal, alreadyReported, afterReport };
}

export async function appendWorkOrderProgressInTx(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    workOrderVersion: number;
    operationId: string;
    sourceReportId: string;
    reporterId: string;
    stage: ProductionWorkOrderStage;
    quantity: Decimal;
    idempotencyKey: string;
    reportedAt: Date;
  },
): Promise<string> {
  const row = await tx.productionWorkOrderProgress.create({
    data: {
      orderId: input.orderId,
      workOrderVersion: input.workOrderVersion,
      operationId: input.operationId,
      sourceReportId: input.sourceReportId,
      reporterId: input.reporterId,
      stage: input.stage,
      workOrderProgressQuantity: input.quantity.toString(),
      idempotencyKey: input.idempotencyKey,
      reportedAt: input.reportedAt,
    },
    select: { id: true },
  });
  return row.id;
}

type ScanClaimContext = {
  orderId: string;
  workOrderVersion: number;
  operationId: string | null;
  progressStepId: string | null;
  reporterId: string;
  idempotencyKey: string;
  orderStatus: OrderStatus;
  scheduledAt: Date | null;
  claimedAt: Date;
};

function sameClaimRequest(
  existing: {
    orderId: string;
    workOrderVersion: number;
    operationId: string | null;
    progressStepId: string | null;
    reporterId: string;
    idempotencyKey: string;
  },
  input: ScanClaimContext,
): boolean {
  return (
    existing.orderId === input.orderId &&
    existing.workOrderVersion === input.workOrderVersion &&
    existing.operationId === input.operationId &&
    existing.progressStepId === input.progressStepId &&
    existing.reporterId === input.reporterId &&
    existing.idempotencyKey === input.idempotencyKey
  );
}

/**
 * Persist the first valid post-release scanner fact. A later scanner never
 * overwrites the first claimant; same-key retries must describe the same scan.
 */
export async function ensureFirstProductionScanClaimInTx(
  tx: Prisma.TransactionClient,
  input: ScanClaimContext,
  options: { source?: 'EXPLICIT_SCAN' | 'REPORT' } = {},
): Promise<{
  claimId: string;
  claimedAt: Date;
  idempotentReplay: boolean;
}> {
  if (
    !CLAIMABLE_ORDER_STATUSES.has(input.orderStatus) ||
    input.scheduledAt === null
  ) {
    throw new WorkOrderProgressError(
      'ORDER_NOT_RELEASED',
      '只有已下发且仍在生产中的工单可以扫码认领',
    );
  }
  if (input.claimedAt.getTime() < input.scheduledAt.getTime()) {
    throw new WorkOrderProgressError(
      'ORDER_NOT_RELEASED',
      '扫码认领时间不能早于工单下发时间',
    );
  }

  const [sameKey, firstForOrder] = await Promise.all([
    tx.productionScanClaim.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: {
        id: true,
        orderId: true,
        workOrderVersion: true,
        operationId: true,
        progressStepId: true,
        reporterId: true,
        idempotencyKey: true,
        claimedAt: true,
      },
    }),
    tx.productionScanClaim.findUnique({
      where: {
        orderId_workOrderVersion: {
          orderId: input.orderId,
          workOrderVersion: input.workOrderVersion,
        },
      },
      select: {
        id: true,
        orderId: true,
        workOrderVersion: true,
        operationId: true,
        progressStepId: true,
        reporterId: true,
        idempotencyKey: true,
        claimedAt: true,
      },
    }),
  ]);
  if (sameKey) {
    if (!sameClaimRequest(sameKey, input)) {
      throw new WorkOrderProgressError(
        'IDEMPOTENCY_CONFLICT',
        '同一幂等键已用于不同的扫码认领',
      );
    }
    return {
      claimId: sameKey.id,
      claimedAt: sameKey.claimedAt,
      idempotentReplay: true,
    };
  }
  if (firstForOrder) {
    if (options.source !== 'REPORT') {
      // The only valid explicit-scan replay is the same persisted key handled
      // above. Returning success for a fresh key would leave that key free for
      // a different order and break the global idempotency-key contract.
      throw new WorkOrderProgressError(
        'IDEMPOTENCY_CONFLICT',
        '该工单版本已由其他扫码认领标识处理',
      );
    }
    return {
      claimId: firstForOrder.id,
      claimedAt: firstForOrder.claimedAt,
      idempotentReplay: true,
    };
  }

  const created = await tx.productionScanClaim.create({
    data: {
      orderId: input.orderId,
      workOrderVersion: input.workOrderVersion,
      operationId: input.operationId,
      progressStepId: input.progressStepId,
      reporterId: input.reporterId,
      idempotencyKey: input.idempotencyKey,
      claimedAt: input.claimedAt,
    },
    select: { id: true, claimedAt: true },
  });
  return {
    claimId: created.id,
    claimedAt: created.claimedAt,
    idempotentReplay: false,
  };
}

export type ClaimProductionOperationInput = {
  operationId: string;
  idempotencyKey: string;
};

export type ClaimProductionOperationActor = { id: string; role: Role };

function claimIdempotencyLockKey(idempotencyKey: string): string {
  return `print-shop-erp:production-scan-claim:${idempotencyKey}`;
}

/** Explicit scanner claim boundary; opening a page does not call this. */
export async function claimProductionOperationFromScan(
  input: ClaimProductionOperationInput,
  actor: ClaimProductionOperationActor,
) {
  const operationId = input.operationId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (
    !operationId ||
    idempotencyKey.length < 8 ||
    idempotencyKey.length > 128
  ) {
    throw new WorkOrderProgressError(
      'INVALID_INPUT',
      '扫码认领参数不合法',
    );
  }

  return db.$transaction(async (tx) => {
    const locator = await tx.productionOperation.findUnique({
      where: { id: operationId },
      select: { id: true, orderId: true },
    });
    if (!locator) {
      throw new WorkOrderProgressError(
        'OPERATION_NOT_FOUND',
        '生产工序不存在',
      );
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      locator.orderId,
    )}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${claimIdempotencyLockKey(
      idempotencyKey,
    )}))`;

    const [operation, account] = await Promise.all([
      tx.productionOperation.findUnique({
        where: { id: operationId },
        select: {
          id: true,
          orderId: true,
          workOrderVersion: true,
          operationType: true,
          status: true,
          order: {
            select: {
              status: true,
              scheduledAt: true,
              workOrderVersion: true,
            },
          },
        },
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
    ]);
    if (!operation) {
      throw new WorkOrderProgressError(
        'OPERATION_NOT_FOUND',
        '生产工序不存在',
      );
    }
    if (
      !account ||
      actor.role !== Role.WORKER ||
      account.role !== actor.role ||
      !account.isActive
    ) {
      throw new WorkOrderProgressError(
        'ACCOUNT_NOT_AUTHORIZED',
        '扫码认领账号无效或已停用',
      );
    }
    if (
      operation.workOrderVersion !== operation.order.workOrderVersion ||
      (operation.status !== ProductionOperationStatus.PENDING &&
        operation.status !== ProductionOperationStatus.IN_PROGRESS)
    ) {
      throw new WorkOrderProgressError(
        'ORDER_NOT_RELEASED',
        '只能认领当前工单版本中尚未完成的工序',
      );
    }
    if (
      operationTypeForReporterAccount(account) !== operation.operationType
    ) {
      throw new WorkOrderProgressError(
        'ACCOUNT_NOT_AUTHORIZED',
        '当前账号的固定工序岗位与该工序不符',
      );
    }
    const claimedAt = await databaseClockNow(tx);
    return ensureFirstProductionScanClaimInTx(
      tx,
      {
        orderId: operation.orderId,
        workOrderVersion: operation.workOrderVersion,
        operationId: operation.id,
        progressStepId: null,
        reporterId: account.id,
        idempotencyKey,
        orderStatus: operation.order.status,
        scheduledAt: operation.order.scheduledAt,
        claimedAt,
      },
      { source: 'EXPLICIT_SCAN' },
    );
  });
}
