'use server';

import { DATABASE_BUSY_MESSAGE, isDatabaseBusyError } from '@/lib/database-errors';
import { reportIdempotencyKey } from '@/lib/production/report-idempotency';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  OperationReportingError,
  reportProductionOperation,
} from '@/lib/production/operation-reporting';
import {
  ProgressReportingError,
  reportProductionProgress,
} from '@/lib/production/progress-reporting';
import {
  claimProductionOperationFromScan,
  WorkOrderProgressError,
} from '@/lib/production/work-order-progress';

export type ReportProductionOperationActionResult =
  | {
      status: 'success';
      reportId: string;
      operationId: string;
      orderId: string;
      amount: string;
      idempotentReplay: boolean;
    }
  | { status: 'invalid' | 'error'; message: string };

export type ReportProductionProgressActionResult =
  | {
      status: 'success';
      reportId: string;
      progressStepId: string;
      orderId: string;
      idempotentReplay: boolean;
    }
  | { status: 'invalid' | 'error'; message: string };

export type ClaimProductionOperationActionResult =
  | {
      status: 'success';
      claimId: string;
      claimedAt: string;
      idempotentReplay: boolean;
    }
  | { status: 'invalid' | 'error'; message: string };

function formInteger(formData: FormData, key: string): number | null {
  const raw = formData.get(key);
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Server-action boundary for the replacement scanner UI. Authorization is
 * deliberately the first operation; reporter identity always comes from the
 * verified session and is never accepted from FormData.
 */
export async function reportProductionOperationAction(
  operationId: string,
  _previous: ReportProductionOperationActionResult | null,
  formData: FormData,
): Promise<ReportProductionOperationActionResult> {
  let actor: Awaited<ReturnType<typeof requirePermission>>;
  try {
    actor = await requirePermission('task:report');
  } catch (error) {
    if (isDatabaseBusyError(error)) return { status: 'error', message: DATABASE_BUSY_MESSAGE };
    throw error;
  }
  const expectedRateKey = formData.get('expectedRateKey');
  const expectedPayrollRevision = formInteger(formData, 'expectedPayrollRevision');
  const completedQty = formInteger(formData, 'completedQty');
  const defectQty = formInteger(formData, 'defectQty');
  const reworkQty = formInteger(formData, 'reworkQty');
  const workOrderProgressQuantity = formInteger(
    formData,
    'workOrderProgressQuantity',
  );
  const idempotencyKey = formData.get('idempotencyKey');
  if (
    typeof expectedRateKey !== 'string' || !expectedRateKey ||
    expectedPayrollRevision === null ||
    completedQty === null ||
    defectQty === null ||
    reworkQty === null ||
    workOrderProgressQuantity === null ||
    (typeof idempotencyKey !== 'string' || (idempotencyKey.startsWith('batch:') && !/^batch:(0|[1-9]\d{0,8})$/.test(idempotencyKey)))
  ) {
    return { status: 'invalid', message: '报工数量或请求标识不合法' };
  }

  try {
    const result = await reportProductionOperation(
      {
        operationId,
        expectedPayrollRevision,
        expectedRateKey,
        completedQty,
        defectQty,
        reworkQty,
        workOrderProgressQuantity,
        idempotencyKey: reportIdempotencyKey({ key: idempotencyKey, kind: 'operation', targetId: operationId, reporterId: actor.id, completedQty, defectQty, reworkQty, workOrderProgressQuantity }),
      },
      actor,
    );
    revalidatePath('/worker/tasks');
    revalidatePath(`/worker/tasks/${operationId}`);
    revalidatePath('/worker/orders');
    revalidatePath(`/worker/orders/${result.orderId}`);
    revalidatePath('/worker/salary');
    revalidatePath(`/orders/${result.orderId}`);
    return {
      status: 'success',
      reportId: result.reportId,
      operationId: result.operationId,
      orderId: result.orderId,
      amount: result.amount,
      idempotentReplay: result.idempotentReplay,
    };
  } catch (error) {
    if (isDatabaseBusyError(error)) return { status: 'error', message: DATABASE_BUSY_MESSAGE };
    if (error instanceof OperationReportingError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

/**
 * Explicit scan claim. Merely opening a task page never invokes this action;
 * reporter identity still comes only from the authorized session.
 */
export async function claimProductionOperationAction(
  operationId: string,
  _previous: ClaimProductionOperationActionResult | null,
  formData: FormData,
): Promise<ClaimProductionOperationActionResult> {
  let actor: Awaited<ReturnType<typeof requirePermission>>;
  try {
    actor = await requirePermission('task:report');
  } catch (error) {
    if (isDatabaseBusyError(error)) return { status: 'error', message: DATABASE_BUSY_MESSAGE };
    throw error;
  }
  const idempotencyKey = formData.get('idempotencyKey');
  if (typeof idempotencyKey !== 'string') {
    return { status: 'invalid', message: '扫码认领请求标识不合法' };
  }

  try {
    const result = await claimProductionOperationFromScan(
      { operationId, idempotencyKey },
      actor,
    );
    revalidatePath('/worker/tasks');
    revalidatePath(`/worker/tasks/${operationId}`);
    return {
      status: 'success',
      claimId: result.claimId,
      claimedAt: result.claimedAt.toISOString(),
      idempotentReplay: result.idempotentReplay,
    };
  } catch (error) {
    if (isDatabaseBusyError(error)) return { status: 'error', message: DATABASE_BUSY_MESSAGE };
    if (error instanceof WorkOrderProgressError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

/** No-pay progress uses the same authenticated scanner boundary as piecework. */
export async function reportProductionProgressAction(
  progressStepId: string,
  _previous: ReportProductionProgressActionResult | null,
  formData: FormData,
): Promise<ReportProductionProgressActionResult> {
  let actor: Awaited<ReturnType<typeof requirePermission>>;
  try {
    actor = await requirePermission('task:report');
  } catch (error) {
    if (isDatabaseBusyError(error)) return { status: 'error', message: DATABASE_BUSY_MESSAGE };
    throw error;
  }
  const completedQty = formInteger(formData, 'completedQty');
  const defectQty = formInteger(formData, 'defectQty');
  const reworkQty = formInteger(formData, 'reworkQty');
  const idempotencyKey = formData.get('idempotencyKey');
  if (
    completedQty === null ||
    defectQty === null ||
    reworkQty === null ||
    (typeof idempotencyKey !== 'string' || (idempotencyKey.startsWith('batch:') && !/^batch:(0|[1-9]\d{0,8})$/.test(idempotencyKey)))
  ) {
    return { status: 'invalid', message: '报工数量或请求标识不合法' };
  }

  try {
    const result = await reportProductionProgress(
      {
        progressStepId,
        completedQty,
        defectQty,
        reworkQty,
        idempotencyKey: reportIdempotencyKey({ key: idempotencyKey, kind: 'progress', targetId: progressStepId, reporterId: actor.id, completedQty, defectQty, reworkQty }),
      },
      actor,
    );
    revalidatePath('/worker/tasks');
    revalidatePath(`/worker/tasks/${progressStepId}`);
    revalidatePath('/worker/orders');
    revalidatePath(`/worker/orders/${result.orderId}`);
    revalidatePath(`/orders/${result.orderId}`);
    return {
      status: 'success',
      reportId: result.reportId,
      progressStepId: result.progressStepId,
      orderId: result.orderId,
      idempotentReplay: result.idempotentReplay,
    };
  } catch (error) {
    if (isDatabaseBusyError(error)) return { status: 'error', message: DATABASE_BUSY_MESSAGE };
    if (error instanceof ProgressReportingError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}
