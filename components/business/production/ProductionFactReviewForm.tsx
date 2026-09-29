'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { reviewProductionFactAction } from '@/actions/production-dispatch';

export function ProductionFactReviewForm({ jobId, jobRevision, reviewRevision, mode, laterJobs = [], quantity, quantityLocked, workDate }: {
  jobId: string; jobRevision: number; reviewRevision: number; mode: 'UNPRODUCED' | 'OPEN' | 'DISMISS_WAGE' | 'INCLUDED_LATER';
  laterJobs?: Array<{ id: string; label: string }>; quantity?: string; quantityLocked?: boolean; workDate?: string;
}) {
  const [state, action, pending] = useActionState(reviewProductionFactAction, null);
  const prefix = `${jobId}-${mode}`;
  return <form action={action} aria-busy={pending} className="space-y-3 rounded-lg border p-3">
    <input type="hidden" name="jobId" value={jobId} /><input type="hidden" name="jobRevision" value={jobRevision} />
    <input type="hidden" name="reviewRevision" value={reviewRevision} /><input type="hidden" name="mode" value={mode} />
    <p className="text-sm">{mode === 'UNPRODUCED' ? '修改实物或取消前，请核实原任务是否已生产。尚在生产时不可勾选未生产，也不可把部分产量登记为任务完成。' : mode === 'OPEN' ? '保留待核对记录，核实原生产日期、数量及工资后处理。' : mode === 'INCLUDED_LATER' ? '仅用于旧产量已经包含在后续同一师傅、同一日期的登记中，不新增产量或工资。只包含部分或登记日期不同，请保留核对，不能当作额外生产。' : '仅关闭有证据证明无需补发的工资义务；原生产事实和冲突证据继续保留。'}</p>
    {mode === 'INCLUDED_LATER' && <>
      <label className="block space-y-1" htmlFor={`${prefix}-related`}><span>关联后续生产登记</span><select id={`${prefix}-related`} name="relatedJobId" required className="min-h-11 w-full rounded-md border bg-background px-3"><option value="">请选择已核对的登记</option>{laterJobs.map(job => <option key={job.id} value={job.id}>{job.label}</option>)}</select></label>
      <label className="block space-y-1" htmlFor={`${prefix}-quantity`}><span>全部已包含的实际数量</span><Input id={`${prefix}-quantity`} name="quantity" type="number" min="1" step="1" required readOnly={quantityLocked} defaultValue={quantity} /></label>
      <label className="block space-y-1" htmlFor={`${prefix}-date`}><span>原实际生产日期</span><Input id={`${prefix}-date`} name="workDate" type="date" required readOnly={!!workDate} defaultValue={workDate} /></label>
      <label className="flex min-h-11 items-start gap-1"><Checkbox className="-ml-3" name="confirmedIncluded" value="on" required /><span className="py-3">已核实旧产量与原师傅原日工资义务均包含在关联登记中</span></label>
    </>}
    <label className="block space-y-1" htmlFor={`${prefix}-reason`}><span>核对依据</span><Input id={`${prefix}-reason`} name="reason" maxLength={500} required className="min-h-11" /></label>
    {mode === 'UNPRODUCED' && <label className="flex min-h-11 items-start gap-1"><Checkbox className="-ml-3" name="notActuallyProduced" value="on" required /><span className="py-3">已核实该次任务没有实际生产</span></label>}
    <Button type="submit" variant="outline" className="min-h-11" disabled={pending || state?.ok}>{pending ? '正在保存…' : mode === 'UNPRODUCED' ? '记录未生产依据' : mode === 'OPEN' ? '建立历史核对记录' : mode === 'INCLUDED_LATER' ? '确认已计入后续登记' : '据证关闭待补工资'}</Button>
    {state && <p role="status" className={state.ok ? 'text-muted-foreground' : 'text-destructive'}>{state.message}</p>}
  </form>;
}
