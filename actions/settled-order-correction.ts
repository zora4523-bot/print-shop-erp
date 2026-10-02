'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { correctSettledOrderSchema } from '@/lib/auth/schemas';
import { collectFieldErrors } from '@/lib/admin/action-helpers';
import { AgentMonthlyBillingError } from '@/lib/agent-monthly-billing/errors';
import { OrderPricingRevisionError } from '@/lib/order/pricing-revision';
import { correctSettledOrder, SettledOrderCorrectionError } from '@/lib/order/settled-correction';
import type { SettledOrderCorrectionMutationResult } from './settled-order-correction.types';

/** 已结算工单在月账单确认前的结算更正（业主 2026-10-01）。 */
export async function correctSettledOrderAction(
  raw: unknown,
): Promise<SettledOrderCorrectionMutationResult> {
  const actor = await requirePermission('order:price:confirm');
  const parsed = correctSettledOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }
  try {
    const result = await correctSettledOrder(parsed.data, actor);
    revalidatePath('/orders');
    revalidatePath(`/orders/${parsed.data.orderId}`);
    revalidatePath('/owner/agent-bills');
    revalidatePath('/owner/agent-bills/unbilled');
    revalidatePath('/sales/bills');
    if (result.draftBillId) revalidatePath(`/owner/agent-bills/${result.draftBillId}`);
    return {
      status: 'success',
      settledFee: result.settledFee,
      message: result.draftBillId
        ? `已更正，结算金额 ${result.settledFee} 元，草稿账单已按新金额更新`
        : `已更正，结算金额 ${result.settledFee} 元`,
    };
  } catch (error) {
    if (
      error instanceof SettledOrderCorrectionError ||
      error instanceof OrderPricingRevisionError ||
      error instanceof AgentMonthlyBillingError
    ) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}
