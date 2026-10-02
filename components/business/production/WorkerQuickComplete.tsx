'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useCompletionFeedback } from './WorkerCompletionFeedback';
import { registerProductionCompletionAction } from '@/actions/production-dispatch';

/**
 * 师傅一键完成（业主 2026-10-01）：生产了就是工单数量，不输入数量。
 * 登记即计薪，故先点「完成生产」再确认一次，防止列表误触。
 * 数量与计划不一致时走任务详情里的数量上报（原审批逻辑）。
 */
export function WorkerQuickComplete({ job }: { job: { id: string; revision: number; plannedQty: string } }) {
  const feedback = useCompletionFeedback();
  const [state, action, pending] = useActionState(async (previous: Awaited<ReturnType<typeof registerProductionCompletionAction>> | null, data: FormData) => {
    const result = await registerProductionCompletionAction(previous, data);
    if (result?.ok) feedback?.(result.message);
    return result;
  }, null);
  const [confirming, setConfirming] = useState(false);
  if (state?.ok && feedback) return null;
  if (state?.ok) return <p role="status" className="text-sm text-muted-foreground">{state.message}</p>;
  return <div className="space-y-2">
    {confirming ? <form action={action} aria-busy={pending} className="flex flex-wrap gap-2">
      <input type="hidden" name="jobId" value={job.id} /><input type="hidden" name="revision" value={job.revision} />
      <input type="hidden" name="quantity" value={job.plannedQty} /><input type="hidden" name="mode" value="COMPLETE" />
      <Button type="submit" className="min-h-11" disabled={pending}>{pending ? '正在登记…' : `确认完成 ${job.plannedQty} 个`}</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setConfirming(false)}>取消</Button>
    </form> : <Button type="button" className="min-h-11" onClick={() => setConfirming(true)}>完成生产</Button>}
    {state && !state.ok && <p role="status" className="text-sm text-destructive">{state.message}</p>}
  </div>;
}
