'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import { cancelPieceworkPlanAction, reviewPieceworkCancellationAction } from '@/actions/owner-piecework-cancellation';
import type { PieceworkCancellationReview } from '@/lib/salary/piecework-cancellation-input';
import type { PieceworkActionResult } from '@/actions/owner-piecework-rules.types';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ActionNotice, DisabledReason, PendingButton } from '@/components/ui-business';

export function CancelPieceworkPlan({ workerId, targetId, hasDraft = false, onSuccess }: { workerId: string | null; targetId: string; hasDraft?: boolean; onSuccess?: (message: string) => void }) {
  const id = useId();
  const [review, setReview] = useState<PieceworkCancellationReview | null>(null);
  const [clientRequestId, setClientRequestId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, startReview] = useTransition();
  const [state, action, pending] = useActionState(async (_previous: (PieceworkActionResult & { requestId: string }) | null, form: FormData) => {
    const result = await cancelPieceworkPlanAction(null, form);
    if (result.status === 'success') onSuccess?.(result.message);
    return { ...result, requestId: String(form.get('clientRequestId')) };
  }, null);
  const currentError = state?.status === 'error' && state.requestId === clientRequestId ? state.message : null;
  function prepare() {
    startReview(async () => {
      const result = await reviewPieceworkCancellationAction(workerId, targetId);
      if (result.status === 'error') { setError(result.message); setReview(null); return; }
      setError(null); setReview(result.review); setClientRequestId(crypto.randomUUID());
    });
  }
  return <div className="mt-4 space-y-3">
    {!review ? <Button type="button" variant="destructive" disabled={loading} onClick={prepare}>{loading ? '正在核对…' : '取消调价计划'}</Button> : <form action={action} onReset={(event) => event.preventDefault()} aria-label="取消调价计划复核" aria-busy={pending} className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <h3 className="font-medium">取消第 {review.target.version} 版调价计划</h3>
      <p className="text-sm">第 {review.target.version} 版：待生效 → 已取消</p>
      <p className="text-sm">原生效时段：{formatDateTimeShanghai(new Date(review.target.effectiveFrom))} 起{review.target.effectiveTo ? `，至 ${formatDateTimeShanghai(new Date(review.target.effectiveTo))}` : ''}</p>
      <p className="text-sm">{review.predecessor ? `恢复第 ${review.predecessor.version} 版工价，其结束时间从 ${formatDateTimeShanghai(new Date(review.target.effectiveFrom))} 调整为${review.target.effectiveTo ? ` ${formatDateTimeShanghai(new Date(review.target.effectiveTo))}` : '未设结束时间'}` : workerId ? '该时段恢复使用统一工价；如当时尚未配置统一工价，将无法报工' : '取消后该时段无法报工，请新建调价草稿并发布工价'}</p>
      {review.successor ? <p className="text-sm">第 {review.successor.version} 版仍按原计划于 {formatDateTimeShanghai(new Date(review.successor.effectiveFrom))} 生效。新工价只能安排在其后；如需提前调整，请先核对后续计划。</p> : null}
      <p className="text-sm">已有工资保持不变。{hasDraft && '现有调价草稿继续保留。'}</p>
      <input type="hidden" name="review" value={JSON.stringify(review)} />
      <input type="hidden" name="clientRequestId" value={clientRequestId} />
      <Label htmlFor={`${id}-reason`}>取消原因（2 至 500 字）</Label>
      <Textarea id={`${id}-reason`} name="reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={2} maxLength={500} required disabled={pending} />
      {currentError ? <ActionNotice tone="error" title="取消未完成" description={currentError} /> : null}
      <div className="flex flex-wrap gap-3">
        {reason.trim().length < 2 && !pending ? <DisabledReason cause="prerequisite" reason="取消原因至少 2 个字。"><PendingButton pending={false} variant="destructive" disabled>取消调价计划</PendingButton></DisabledReason>
          : <PendingButton pending={pending} pendingLabel="正在取消调价计划…" variant="destructive">取消调价计划</PendingButton>}
        <Button type="button" variant="outline" disabled={pending} onClick={() => setReview(null)}>返回</Button>
        {currentError ? <Button type="button" variant="outline" disabled={pending || loading} onClick={prepare}>重新核对计划</Button> : null}
      </div>
    </form>}
    {error ? <ActionNotice tone="error" title="无法取消此计划" description={error} /> : null}
  </div>;
}
