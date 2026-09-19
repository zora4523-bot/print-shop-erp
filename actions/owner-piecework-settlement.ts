'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { appendReceipt, safeReturnTo } from '@/lib/admin/receipt';
import { requirePermission } from '@/lib/auth/permissions';
import { parseStrictYmd } from '@/lib/auth/schemas';
import {
  lockPieceworkSettlement,
  lockPieceworkSettlementsForDate,
  markPieceworkSettlementPaid,
  PieceworkSettlementError,
} from '@/lib/salary/piecework-settlement';

export type PieceworkSettlementMutationResult =
  | { status: 'success'; message: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

function safeOwnerReturnTo(value: FormDataEntryValue | null): string {
  return safeReturnTo(value, '/owner/salary/piecework');
}

export async function lockPieceworkSettlementAction(
  reporterId: string,
  workDate: string,
  _previous: PieceworkSettlementMutationResult | null,
  formData: FormData,
): Promise<PieceworkSettlementMutationResult> {
  const actor = await requirePermission('salary:rule:manage');
  if (!reporterId.trim() || !parseStrictYmd(workDate)) {
    return {
      status: 'invalid',
      fieldErrors: { _: ['报工人或结算日期无效'] },
    };
  }
  try {
    const receipt = await lockPieceworkSettlement({
      reporterId,
      workDate,
      actor,
    });
    revalidatePath('/owner/salary');
    revalidatePath('/owner/salary/piecework');
    revalidatePath('/worker/salary');
    redirect(
      appendReceipt(safeOwnerReturnTo(formData.get('returnTo')), {
        locked: receipt.reporterName,
      }),
    );
  } catch (error) {
    if (error instanceof PieceworkSettlementError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

export async function lockPieceworkSettlementDayAction(
  _previous: PieceworkSettlementMutationResult | null,
  formData: FormData,
): Promise<PieceworkSettlementMutationResult> {
  const actor = await requirePermission('salary:rule:manage');
  const workDate = formData.get('workDate');
  if (typeof workDate !== 'string' || !parseStrictYmd(workDate)) {
    return {
      status: 'invalid',
      fieldErrors: { workDate: ['请选择合法的结算日期'] },
    };
  }
  try {
    const result = await lockPieceworkSettlementsForDate({
      workDate,
      actor,
    });
    if (result.errors.length > 0) {
      return {
        status: 'error',
        message: result.errors
          .map((entry) => `${entry.reporterName}：${entry.message}`)
          .join('；'),
      };
    }
    revalidatePath('/owner/salary');
    revalidatePath('/owner/salary/piecework');
    revalidatePath('/worker/salary');
    redirect(
      appendReceipt(safeOwnerReturnTo(formData.get('returnTo')), {
        lockedCount: String(result.settled.length),
      }),
    );
  } catch (error) {
    if (error instanceof PieceworkSettlementError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

export async function markPieceworkSettlementPaidAction(
  settlementId: string,
  _previous: PieceworkSettlementMutationResult | null,
  formData: FormData,
): Promise<PieceworkSettlementMutationResult> {
  const actor = await requirePermission('salary:view:all');
  try {
    const receipt = await markPieceworkSettlementPaid({
      settlementId,
      actor,
    });
    revalidatePath('/owner/salary');
    revalidatePath('/owner/salary/piecework');
    revalidatePath(`/owner/salary/piecework/${settlementId}`);
    revalidatePath('/worker/salary');
    revalidatePath(`/worker/salary/${settlementId}`);
    redirect(
      appendReceipt(safeOwnerReturnTo(formData.get('returnTo')), {
        paid: receipt.reporterName,
      }),
    );
  } catch (error) {
    if (error instanceof PieceworkSettlementError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}
