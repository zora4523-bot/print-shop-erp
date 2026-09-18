'use client';

import { useActionState } from 'react';
import { createReportDisputeAction, reviewReportDisputeAction } from '@/actions/report-disputes';
import type { ReportDisputeResult } from '@/actions/report-disputes.types';
import { Button } from '@/components/ui/button';

export function ReportDisputeForm({ reportId }: { reportId: string }) {
  const [state, action, pending] = useActionState<ReportDisputeResult | null, FormData>(createReportDisputeAction.bind(null, reportId), null);
  return <form action={action} aria-busy={pending} className="space-y-3">
    <label className="block space-y-2"><span>问题说明</span>
      <textarea name="reason" required minLength={5} maxLength={1000} rows={3} disabled={pending} className="w-full rounded-lg border bg-background p-3" placeholder="说明数量或提成金额的问题（5–1000 个字）" />
    </label>
    <p className="text-sm text-muted-foreground">提交后由管理员核对，不直接更改报工或工资。</p>
    {state && <p role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p>}
    <Button disabled={pending || state?.status === 'success'} type="submit">{pending ? '提交中…' : '提交问题'}</Button>
  </form>;
}
export function ReportDisputeReviewForm({ disputeId }: { disputeId: string }) {
  const [state, action, pending] = useActionState<ReportDisputeResult | null, FormData>(reviewReportDisputeAction.bind(null, disputeId), null);
  return <form action={action} aria-busy={pending} className="space-y-3">
    <label className="block space-y-2"><span>处理回复</span><textarea name="resolution" required minLength={2} maxLength={1000} rows={3} disabled={pending} className="w-full rounded-lg border bg-background p-3" /></label>
    <p className="text-sm text-muted-foreground">保存回复不会调整报工数量或工资。</p>
    {state && <p role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" name="decision" value="RESOLVED" disabled={pending}>确认已解决</Button><Button type="submit" name="decision" value="REJECTED" variant="outline" disabled={pending}>驳回问题</Button></div>
  </form>;
}
