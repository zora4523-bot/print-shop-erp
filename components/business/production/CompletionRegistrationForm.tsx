'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { registerProductionCompletionAction } from '@/actions/production-dispatch';

export function CompletionRegistrationForm({ job, admin, today }: { job: { id: string; revision: number; workerName: string; quantity: string; requestedQty: string | null; requestReason: string | null; status: string }; admin: boolean; today: string }) {
  const [state, action, pending] = useActionState(registerProductionCompletionAction, null);
  const approval = job.status === 'REQUESTED';
  if (approval && !admin) return <p role="status">数量待审批：{job.requestedQty} 个</p>;
  if (!['PENDING', 'REQUESTED'].includes(job.status)) return <p>{job.status === 'CANCELLED' ? '该次生产已取消' : '已登记完成'}</p>;
  return <form action={action} aria-busy={pending} className="space-y-3">
    <input type="hidden" name="jobId" value={job.id} /><input type="hidden" name="revision" value={job.revision} />
    <p className="text-sm">生产师傅：{job.workerName} · 计划 {job.quantity} 个</p>
    {approval && <p className="text-sm">申请 {job.requestedQty} 个 · {job.requestReason}</p>}
    <div className="space-y-1"><label htmlFor={`${job.id}-quantity`}>{approval ? '核定数量' : '完成数量'}</label><Input id={`${job.id}-quantity`} className="min-h-11" name="quantity" readOnly={approval} type="number" min="1" step="1" max="9999999999" required defaultValue={job.requestedQty ?? job.quantity} /></div>
    {admin && !approval && <div className="space-y-1"><label htmlFor={`${job.id}-date`}>实际生产日期</label><Input id={`${job.id}-date`} className="min-h-11" name="workDate" type="date" max={today} required defaultValue={today} /></div>}
    <div className="space-y-1"><label htmlFor={`${job.id}-reason`}>{admin ? '核定或补登记说明' : '数量修改原因（修改数量时必填）'}</label><Input id={`${job.id}-reason`} className="min-h-11" name="reason" maxLength={500} required={admin} /></div>
    <div className="flex flex-wrap gap-2"><Button type="submit" name="mode" value={approval ? 'APPROVE' : admin ? 'BACKFILL' : 'COMPLETE'} className="min-h-11" disabled={pending || state?.ok}>{pending ? '正在登记…' : approval ? '批准并登记完成' : admin ? '补登记完成' : '登记完成'}</Button>{approval && <Button type="submit" name="mode" value="REJECT" variant="outline" className="min-h-11" disabled={pending || state?.ok}>驳回数量申请</Button>}</div>
    {state && <p role="status" className={state.ok ? 'text-muted-foreground' : 'text-destructive'}>{state.message}</p>}
  </form>;
}
