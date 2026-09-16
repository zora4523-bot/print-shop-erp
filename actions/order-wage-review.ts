'use server';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { reviewOrderWages, wageReviewSchema, WageReviewError } from '@/lib/salary/order-wage-review';
import type { PieceworkActionResult } from './owner-piecework-rules.types';
export async function reviewOrderWagesAction(_previous: PieceworkActionResult | null, form: FormData): Promise<PieceworkActionResult> {
  const actor = await requirePermission('salary:rule:manage');
  const anchors = form.getAll('anchorId'); const amounts = form.getAll('amount');
  const parsed = wageReviewSchema.safeParse({ operationId: form.get('operationId'), revision: form.get('revision'), reason: form.get('reason'), targets: anchors.map((anchorId, i) => ({ anchorId, amount: amounts[i] })) });
  if (!parsed.success) return { status: 'error', message: '请填写有效工资金额和至少两字的核定原因' };
  try {
    const result = await reviewOrderWages(parsed.data, actor);
    revalidatePath(`/orders/${result.orderId}`); revalidatePath('/owner/salary/piecework'); revalidatePath('/worker/salary');
    return { status: 'success', message: '提成已核定' };
  } catch (error) {
    if (error instanceof WageReviewError) return { status: 'error', message: error.message };
    throw error;
  }
}
