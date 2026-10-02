import { createHash } from 'node:crypto';
import { Role } from '../../generated/prisma/enums';
import { ProductionOperationMaterializationError } from '../production/operation-materialization-service';
import {
  AdminOrderWorkflowError,
  releaseFactoryOrder,
  settleFactoryOrder,
  type AdminWorkflowActor,
} from './admin-workflow';
import {
  createNextOrderPrintRequest,
  OrderPrintJobError,
} from './print-jobs';
import { InvalidOrderTransitionError } from './status-machine';
import { completeOrderProductionAtPlan, PlannedCompletionError } from '../production/planned-completion';

export const ADMIN_ORDER_BATCH_COMMANDS = [
  'RELEASE_AND_CREATE_PRINT',
  'CREATE_PRINT',
  'SETTLE',
  'COMPLETE_PRODUCTION',
] as const;

export type AdminOrderBatchCommand =
  (typeof ADMIN_ORDER_BATCH_COMMANDS)[number];

export type AdminOrderBatchItem = {
  orderId: string;
  expectedRevision: number;
  expectedWorkOrderVersion: number;
  requestJobId?: string;
};

export type AdminOrderBatchItemResult =
  | { orderId: string; status: 'success'; code: 'OK' }
  | { orderId: string; status: 'skipped'; code: string; message: string }
  | {
      orderId: string;
      status: 'failed';
      code: 'UNEXPECTED_ERROR';
      message: string;
    }
  | {
      orderId: string;
      status: 'not_attempted';
      code: 'ABORTED_AFTER_FAILURE';
      message: string;
    };

export type AdminOrderBatchResult = {
  command: AdminOrderBatchCommand;
  successCount: number;
  skippedCount: number;
  failedCount: number;
  notAttemptedCount: number;
  items: AdminOrderBatchItemResult[];
};

function operationKey(
  requestId: string,
  command: AdminOrderBatchCommand,
  orderId: string,
): string {
  const digest = createHash('sha256')
    .update(`${requestId}\0${command}\0${orderId}`)
    .digest('hex');
  return `admin-order-batch:${digest}`;
}

function assertInput(
  requestId: string,
  items: readonly AdminOrderBatchItem[],
  actor: AdminWorkflowActor,
): void {
  if (actor.role !== Role.ADMIN) {
    throw new AdminOrderWorkflowError('FORBIDDEN', '只有管理员可以批量处理工单');
  }
  if (requestId.trim().length < 8 || requestId.trim().length > 128) {
    throw new AdminOrderWorkflowError(
      'INVALID_INPUT',
      '批量操作请求标识长度必须为 8–128 个字符',
    );
  }
  if (items.length < 1 || items.length > 100) {
    throw new AdminOrderWorkflowError(
      'INVALID_INPUT',
      '一次批量操作必须包含 1–100 张工单',
    );
  }
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.orderId.trim() || ids.has(item.orderId)) {
      throw new AdminOrderWorkflowError(
        'INVALID_INPUT',
        ids.has(item.orderId) ? '批量工单不能重复' : '工单标识不合法',
      );
    }
    ids.add(item.orderId);
    if (
      !Number.isSafeInteger(item.expectedRevision) ||
      item.expectedRevision < 0 ||
      !Number.isSafeInteger(item.expectedWorkOrderVersion) ||
      item.expectedWorkOrderVersion < 1
    ) {
      throw new AdminOrderWorkflowError(
        'INVALID_INPUT',
        '批量工单版本不合法',
      );
    }
  }
}

function skipped(
  orderId: string,
  error: unknown,
): AdminOrderBatchItemResult | null {
  if (
    error instanceof AdminOrderWorkflowError ||
    error instanceof OrderPrintJobError ||
    error instanceof ProductionOperationMaterializationError ||
    error instanceof PlannedCompletionError
  ) {
    return {
      orderId,
      status: 'skipped',
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof InvalidOrderTransitionError) {
    return {
      orderId,
      status: 'skipped',
      code: 'INVALID_STATUS',
      message: error.message,
    };
  }
  return null;
}

/**
 * Batch is intentionally a sequence of independent single-order commands.
 * One ineligible row must not roll back successful rows, while every row still
 * executes the exact same transaction, lock order, preflight and audit path as
 * its corresponding row action.
 */
export async function runAdminOrderBatch(
  input: {
    requestId: string;
    command: AdminOrderBatchCommand;
    items: readonly AdminOrderBatchItem[];
  },
  actor: AdminWorkflowActor,
): Promise<AdminOrderBatchResult> {
  assertInput(input.requestId, input.items, actor);
  const results: AdminOrderBatchItemResult[] = [];

  for (const [itemIndex, item] of input.items.entries()) {
    const idempotencyKey = operationKey(
      input.requestId.trim(),
      input.command,
      item.orderId,
    );
    try {
      switch (input.command) {
        case 'RELEASE_AND_CREATE_PRINT':
          await releaseFactoryOrder(
            {
              orderId: item.orderId,
              expectedRevision: item.expectedRevision,
              expectedWorkOrderVersion: item.expectedWorkOrderVersion,
              printIdempotencyKey: idempotencyKey,
            },
            actor,
          );
          break;
        case 'CREATE_PRINT':
          await createNextOrderPrintRequest(
            {
              orderId: item.orderId,
              workOrderVersion: item.expectedWorkOrderVersion,
              reason: '管理端批量创建打印任务',
              idempotencyKey,
            },
            actor,
          );
          break;
        case 'COMPLETE_PRODUCTION':
          // 业主 2026-10-01：按计划数量代师傅登记完成并计提成，逐单一个事务。
          await completeOrderProductionAtPlan(
            {
              orderId: item.orderId,
              expectedRevision: item.expectedRevision,
              expectedWorkOrderVersion: item.expectedWorkOrderVersion,
            },
            actor,
          );
          break;
        case 'SETTLE':
          await settleFactoryOrder(
            {
              orderId: item.orderId,
              expectedRevision: item.expectedRevision,
              expectedWorkOrderVersion: item.expectedWorkOrderVersion,
            },
            actor,
          );
          break;
      }
      results.push({ orderId: item.orderId, status: 'success', code: 'OK' });
    } catch (error) {
      const businessSkip = skipped(item.orderId, error);
      if (businessSkip) {
        results.push(businessSkip);
        continue;
      }

      // A row command can fail after earlier independent transactions already
      // committed. Preserve those facts, fail closed for the remaining rows,
      // and emit the original exception only to server logs/monitoring. The UI
      // receives a generic "result unknown" status and must refresh before the
      // operator decides whether to retry.
      console.error('[admin-order-batch] unexpected item failure', {
        requestId: input.requestId.trim(),
        command: input.command,
        orderId: item.orderId,
        completedItemCount: results.length,
        error,
      });
      results.push({
        orderId: item.orderId,
        status: 'failed',
        code: 'UNEXPECTED_ERROR',
        message: '系统异常，该工单的处理结果未知；请刷新后核对',
      });
      for (const remaining of input.items.slice(itemIndex + 1)) {
        results.push({
          orderId: remaining.orderId,
          status: 'not_attempted',
          code: 'ABORTED_AFTER_FAILURE',
          message: '前序工单发生系统异常，本次未继续处理',
        });
      }
      break;
    }
  }

  const successCount = results.filter((item) => item.status === 'success').length;
  const skippedCount = results.filter((item) => item.status === 'skipped').length;
  const failedCount = results.filter((item) => item.status === 'failed').length;
  const notAttemptedCount = results.filter(
    (item) => item.status === 'not_attempted',
  ).length;
  return {
    command: input.command,
    successCount,
    skippedCount,
    failedCount,
    notAttemptedCount,
    items: results,
  };
}
