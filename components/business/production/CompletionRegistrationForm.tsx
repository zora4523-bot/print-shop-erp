'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { registerProductionCompletionAction } from '@/actions/production-dispatch';
import { WorkerQuickComplete } from './WorkerQuickComplete';
import { ChevronDown } from 'lucide-react';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';

type RegistrationJob = {
  id: string; revision: number; workerName: string; quantity: string; requestedQty: string | null; requestReason: string | null; status: string;
  workDate?: string | null; historical?: boolean; reviewRevision?: number; settledWorkDates?: string[];
  hasLaterProduction?: boolean;
  items?: Array<{ id: string; name: string; quantity: string }>;
};
export function CompletionRegistrationForm({ job, admin, today }: { job: RegistrationJob; admin: boolean; today: string }) {
  const [state, action, pending] = useActionState(registerProductionCompletionAction, null);
  const [day, setDay] = useState(job.workDate ?? today);
  const approval = job.status === 'REQUESTED' || !!(job.historical && job.requestedQty);
  const recovery = admin && job.historical;
  if (approval && !admin) return <p role="status">数量待审批：{job.requestedQty} 个</p>;
  if (!['PENDING', 'REQUESTED'].includes(job.status) && !(recovery && job.status === 'CANCELLED')) return <p>{job.status === 'CANCELLED' ? '该次生产已取消' : '已登记完成'}</p>;
  // 师傅默认一键完成（按计划数量）；数量不一致才展开上报，仍走原审批（业主 2026-10-01）。
  if (!admin) return <div className="space-y-4">
    <p className="text-sm">生产师傅：{job.workerName} · 计划 {job.quantity} 个</p>
    <WorkerQuickComplete job={{ id: job.id, revision: job.revision, plannedQty: job.quantity }} />
    <Disclosure className="rounded-lg border p-3">
      <DisclosureSummary className="gap-2"><span className="min-w-0 flex-1">实际数量与计划不一致？上报数量</span><ChevronDown aria-hidden className="size-4 shrink-0 transition-transform group-open:rotate-180" /></DisclosureSummary>
      <form action={action} aria-busy={pending} className="space-y-3 pt-2">
        <input type="hidden" name="jobId" value={job.id} /><input type="hidden" name="revision" value={job.revision} />
        <div className="space-y-1"><label htmlFor={`${job.id}-quantity`}>实际完成数量</label><Input id={`${job.id}-quantity`} className="min-h-11" name="quantity" type="number" min="1" step="1" max="9999999999" required defaultValue={job.quantity} /></div>
        <div className="space-y-1"><label htmlFor={`${job.id}-reason`}>数量修改原因</label><Input id={`${job.id}-reason`} className="min-h-11" name="reason" maxLength={500} required /></div>
        <Button type="submit" name="mode" value="COMPLETE" variant="outline" className="min-h-11" disabled={pending || state?.ok}>{pending ? '正在提交…' : '提交数量审批'}</Button>
        {state && <p role="status" className={state.ok ? 'text-muted-foreground' : 'text-destructive'}>{state.message}</p>}
      </form>
    </Disclosure>
  </div>;
  return <form action={action} aria-busy={pending} className="space-y-3">
    <input type="hidden" name="jobId" value={job.id} /><input type="hidden" name="revision" value={job.revision} />
    {recovery && <input type="hidden" name="reviewRevision" value={job.reviewRevision} />}
    <p className="text-sm">生产师傅：{job.workerName} · 计划 {job.quantity} 个</p>
    {approval && <p className="text-sm">申请 {job.requestedQty} 个 · {job.requestReason}</p>}
    <div className="space-y-1"><label htmlFor={`${job.id}-quantity`}>{approval ? '核定数量' : '完成数量'}</label><Input id={`${job.id}-quantity`} className="min-h-11" name="quantity" type="number" min="1" step="1" max="9999999999" required defaultValue={job.requestedQty ?? job.quantity} /></div>
    <div className="space-y-1"><label htmlFor={`${job.id}-date`}>实际生产日期</label><Input id={`${job.id}-date`} className="min-h-11" name="workDate" type="date" max={today} required readOnly={!!job.workDate} value={day} onChange={event => setDay(event.target.value)} /></div>
    {job.items && job.items.length > 1 && <fieldset className="space-y-2"><legend>逐款实际数量</legend>{job.items.map(item => <label key={item.id} className="block space-y-1" htmlFor={`${job.id}-item-${item.id}`}><span>{item.name}</span><Input id={`${job.id}-item-${item.id}`} name={`itemQuantity:${item.id}`} type="number" min="0" step="1" required defaultValue={item.quantity} className="min-h-11" /></label>)}</fieldset>}
    <div className="space-y-1"><label htmlFor={`${job.id}-reason`}>核定或补登记说明</label><Input id={`${job.id}-reason`} className="min-h-11" name="reason" maxLength={500} required /></div>
    {job.settledWorkDates?.includes(day) && <label className="flex min-h-11 items-start gap-1 text-sm"><Checkbox className="-ml-3" name="confirmedSettledDay" value="on" /><span className="py-3">原日工资已结算，仅登记实际生产及待补工资；登记后不能撤销生产事实。</span></label>}
    {recovery && job.hasLaterProduction && <p className="text-sm text-warning-foreground">若同一批实物已在其他日期登记，请保留核对；不能勾选额外生产或声明未生产。</p>}
    {recovery && job.hasLaterProduction && <label className="flex min-h-11 items-start gap-1 text-sm"><Checkbox className="-ml-3" name="confirmedAdditionalProduction" value="on" /><span className="py-3">已核实这是额外实际生产，未包含在后续登记内；按原师傅原日计薪，保留后续任务与工资。</span></label>}
    {approval && <label className="flex min-h-11 items-start gap-1 text-sm"><Checkbox className="-ml-3" name="notActuallyProduced" value="on" /><span className="py-3">驳回前已核实没有实际生产；已做但数量有误，请核定正确数量。</span></label>}
    <div className="flex flex-wrap gap-2"><Button type="submit" name="mode" value={recovery ? 'RECOVER' : approval ? 'APPROVE' : 'BACKFILL'} className="min-h-11" disabled={pending || state?.ok}>{pending ? '正在登记…' : recovery ? '核定历史生产' : approval ? '核定并登记完成' : '补登记完成'}</Button>{approval && <Button type="submit" name="mode" value="REJECT" variant="outline" className="min-h-11" disabled={pending || state?.ok}>驳回数量申请</Button>}</div>
    {state && <p role="status" className={state.ok ? 'text-muted-foreground' : 'text-destructive'}>{state.message}</p>}
  </form>;
}
