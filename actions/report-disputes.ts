'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { createReportDispute, reviewReportDispute, ReportDisputeError, createReportDisputeSchema, reviewReportDisputeSchema } from '@/lib/production/report-dispute';
import type { ReportDisputeResult } from './report-disputes.types';

function refresh(result: { reportId: string; orderId: string; operationId: string }) {
  revalidatePath(`/worker/reports/${result.reportId}`);
  revalidatePath(`/worker/tasks/${result.operationId}`);
  revalidatePath('/worker/salary');
  revalidatePath(`/orders/${result.orderId}`);
}
export async function createReportDisputeAction(reportId: string, _previous: ReportDisputeResult | null, form: FormData): Promise<ReportDisputeResult> {
  const actor = await requirePermission('task:dispute:create');
  const parsed = createReportDisputeSchema.safeParse({ reportId, reason: form.get('reason') });
  if (!parsed.success) return { status: 'error', message: '问题说明需为 5–1000 个字，请修改后重试' };
  try {
    refresh(await createReportDispute(parsed.data, actor));
    return { status: 'success', message: '问题已提交' };
  } catch (error) {
    if (error instanceof ReportDisputeError) return { status: 'error', message: error.message };
    throw error;
  }
}
export async function reviewReportDisputeAction(disputeId: string, _previous: ReportDisputeResult | null, form: FormData): Promise<ReportDisputeResult> {
  const actor = await requirePermission('task:dispute:review');
  const parsed = reviewReportDisputeSchema.safeParse({ disputeId, decision: form.get('decision'), resolution: form.get('resolution') });
  if (!parsed.success) return { status: 'error', message: '请填写处理回复并选择处理结果' };
  try {
    refresh(await reviewReportDispute(parsed.data, actor));
    return { status: 'success', message: '处理回复已保存' };
  } catch (error) {
    if (error instanceof ReportDisputeError) return { status: 'error', message: error.message };
    throw error;
  }
}
