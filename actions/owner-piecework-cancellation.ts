'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { cancelPieceworkSchedule, reviewPieceworkCancellation, requirePieceworkCancellationEnabled } from '@/lib/salary/piecework-cancellation';
import { pieceworkCancellationSchema, type PieceworkCancellationReview } from '@/lib/salary/piecework-cancellation-input';
import { PieceworkPriceBookAdminError } from '@/lib/salary/piecework-price-book-admin';
import type { PieceworkActionResult } from './owner-piecework-rules.types';

export async function reviewPieceworkCancellationAction(workerId: string | null, targetId: string): Promise<{ status: 'success'; review: PieceworkCancellationReview } | { status: 'error'; message: string }> {
  const actor = await requirePermission('salary:rule:manage');
  try {
    requirePieceworkCancellationEnabled();
    if ((workerId !== null && (typeof workerId !== 'string' || !workerId || workerId.length > 64)) || typeof targetId !== 'string' || !targetId || targetId.length > 64) return { status: 'error', message: '计划信息不完整，请重新打开工价页面' };
    return { status: 'success', review: await reviewPieceworkCancellation(workerId, targetId, actor) };
  } catch (error) {
    if (error instanceof PieceworkPriceBookAdminError) return { status: 'error', message: error.message };
    throw error;
  }
}

export async function cancelPieceworkPlanAction(_previous: PieceworkActionResult | null, form: FormData): Promise<PieceworkActionResult> {
  const actor = await requirePermission('salary:rule:manage');
  try {
    requirePieceworkCancellationEnabled();
    const rawReview = form.get('review');
    if (typeof rawReview !== 'string' || rawReview.length > 10_000) return { status: 'error', message: '计划信息不完整，请重新核对' };
    let review: unknown;
    try { review = JSON.parse(rawReview); } catch { return { status: 'error', message: '计划信息不完整，请重新核对' }; }
    const parsed = pieceworkCancellationSchema.safeParse({ clientRequestId: form.get('clientRequestId'), reason: form.get('reason'), review });
    if (!parsed.success) return { status: 'error', message: '请重新核对计划，取消原因需填写 2 至 500 字' };
    const result = await cancelPieceworkSchedule(parsed.data, actor);
    revalidatePath('/owner/rules/employee-pay');
    revalidatePath('/owner/rules');
    revalidatePath('/owner/accounts/[id]', 'page');
    revalidatePath('/worker/tasks', 'layout');
    return { status: 'success', message: result.replayed ? '该调价计划此前已取消' : '调价计划已取消' };
  } catch (error) {
    if (error instanceof PieceworkPriceBookAdminError) return { status: 'error', message: error.message };
    throw error;
  }
}
