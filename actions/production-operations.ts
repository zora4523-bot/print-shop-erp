'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  OperationReportingError,
  reportProductionOperation,
} from '@/lib/production/operation-reporting';

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
  const actor = await requirePermission('task:report');
  const completedQty = formInteger(formData, 'completedQty');
  const defectQty = formInteger(formData, 'defectQty');
  const reworkQty = formInteger(formData, 'reworkQty');
  const idempotencyKey = formData.get('idempotencyKey');
  if (
    completedQty === null ||
    defectQty === null ||
    reworkQty === null ||
    typeof idempotencyKey !== 'string'
  ) {
    return { status: 'invalid', message: '报工数量或请求标识不合法' };
  }

  try {
    const result = await reportProductionOperation(
      {
        operationId,
        completedQty,
        defectQty,
        reworkQty,
        idempotencyKey,
      },
      actor,
    );
    revalidatePath('/worker/tasks');
    revalidatePath(`/worker/tasks/${operationId}`);
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
    if (error instanceof OperationReportingError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}
