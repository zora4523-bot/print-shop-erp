import { ChevronDown } from 'lucide-react';
import { CorrectRegistrationButton } from './CorrectRegistrationButton';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { formatMoney } from '@/lib/dashboard/format';
import Link from 'next/link';
import { getAdminProductionDetail } from '@/lib/production/admin-production-detail';
import { ProductionFactReviewForm } from './ProductionFactReviewForm';
import { requirePermission } from '@/lib/auth/permissions';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import { StatusBadge } from '@/components/ui-business';
import { CompletionRegistrationForm } from './CompletionRegistrationForm';
import { ProductionWageForm } from './ProductionWageForm';

/** Admin-only: never pass internal wages into the sales detail model. */
export async function ProductionJobPanel({ orderId }: { orderId: string }) {
  const actor = await requirePermission('production:manage');
  if (actor.role !== 'ADMIN') return null;
  const { jobs, workers } = await getAdminProductionDetail(orderId, actor);
  return <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4" aria-label="生产安排与提成">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">生产安排与提成</h2><Link className="inline-flex min-h-11 items-center underline" href={`/orders/production?ids=${encodeURIComponent(orderId)}`}>安排生产师傅</Link></div>
    {jobs.map(job => {
      const currentWages = job.wages.filter(wage => wage.workDate.getTime() === job.workDate?.getTime());
      const settledDay = !!job.workDate && job.settledWorkDates.includes(job.workDate.toISOString().slice(0, 10));
      const needsReview = !!job.factReview && ['OPEN', 'CONFLICT'].includes(job.factReview.status);
      const resolution = (job.factReview?.evidence as { resolution?: string } | undefined)?.resolution;
      const laterJobs = jobs.filter(next => next.workOrderVersion > job.workOrderVersion && next.status === 'COMPLETED');
      const snapshot = job.snapshot as { items?: Array<{ id: string; name: string; quantity: number }>; productionQuantities?: Record<string, string>; requestedItemQuantities?: Record<string, string> | null };
      // A pending request prefills the worker's requested per-item split, not the plan.
      const requestedItems = job.status === 'REQUESTED' ? snapshot.requestedItemQuantities ?? null : null;
      return <Disclosure key={job.id} id={`production-job-${job.id}`} tabIndex={-1} className="min-w-0 rounded-lg border p-3" open={job.status === 'REQUESTED' || needsReview || job.workOrderVersion === jobs[0]?.workOrderVersion || job.wages.some(wage => wage.amount === null)}>
      <DisclosureSummary className="min-h-11 cursor-pointer gap-2 py-2"><span className="min-w-0 flex-1 break-words">v{job.workOrderVersion} · {job.label} · {job.workerName} · {job.completedQty?.toString() ?? job.plannedQty.toString()} 个 <StatusBadge tone={job.status === 'COMPLETED' || job.status === 'CARRIED' ? 'success' : 'neutral'}>{job.status === 'COMPLETED' ? '已登记完成' : job.status === 'CARRIED' ? '沿用已产数量' : job.status === 'REQUESTED' ? '数量待审批' : job.status === 'CANCELLED' ? '已取消' : '生产中'}</StatusBadge>{job.manualPricing && ' · 改版生产'}{job.wages.some(wage => wage.amount === null) && ' · 待补录提成'}</span><ChevronDown aria-hidden className="size-4 shrink-0 transition-transform group-open:rotate-180" /></DisclosureSummary>
      <div className="space-y-4 pt-3">
        {needsReview && <p role="status" className="text-sm text-warning-foreground">历史生产待核对：{job.factReview!.reason}</p>}
        {job.factReview?.status === 'UNPRODUCED' && job.factReview.jobRevision === job.revision && <p className="text-sm">已核实未生产：{job.factReview.reason}</p>}
        {((['PENDING', 'REQUESTED'].includes(job.status) && !job.historical) || (job.historical && needsReview)) && <CompletionRegistrationForm key={`${job.id}:${job.revision}:${job.factReview?.revision}`} job={{ id: job.id, revision: job.revision, workerName: job.workerName,
          quantity: job.plannedQty.toString(), requestedQty: job.requestedQty?.toString() ?? null, requestReason: job.requestReason, status: job.status,
          workDate: job.workDate?.toISOString().slice(0, 10), historical: job.historical, reviewRevision: job.factReview?.revision, settledWorkDates: job.settledWorkDates, hasLaterProduction: laterJobs.length > 0,
          items: snapshot.items?.map(item => ({ id: item.id, name: item.name, quantity: requestedItems?.[item.id] ?? snapshot.productionQuantities?.[item.id] ?? String(item.quantity) })),
        }} admin today={todayShanghai()} />}
        {resolution === 'CONTINUED' && <p className="text-sm">资料改版前的生产已由新版原师傅继续承接，实际完成后登记一次。</p>}
        {resolution === 'INCLUDED_LATER' && <p className="text-sm">已核实计入后续登记，未新增产量或工资。</p>}
        {['PENDING', 'CANCELLED'].includes(job.status) && !job.requestedQty && !['CONTINUED', 'INCLUDED_LATER'].includes(resolution ?? '') && <ProductionFactReviewForm key={`verify:${job.revision}:${job.factReview?.revision}`} jobId={job.id} jobRevision={job.revision} reviewRevision={job.factReview?.revision ?? -1} mode="UNPRODUCED" />}
        {job.historical && (!job.factReview || job.factReview.status === 'UNPRODUCED') && ['PENDING', 'REQUESTED', 'CANCELLED'].includes(job.status) && <ProductionFactReviewForm key={`open:${job.factReview?.revision}`} jobId={job.id} jobRevision={job.revision} reviewRevision={job.factReview?.revision ?? -1} mode="OPEN" />}
        {job.historical && needsReview && laterJobs.length > 0 && <ProductionFactReviewForm key={`included:${job.factReview?.revision}`} jobId={job.id} jobRevision={job.revision} reviewRevision={job.factReview!.revision} mode="INCLUDED_LATER"
          quantity={job.requestedQty?.toString() ?? job.plannedQty.toString()} quantityLocked={!!job.requestedQty} workDate={job.workDate?.toISOString().slice(0, 10)} laterJobs={laterJobs.filter(next => next.workerId === job.workerId).map(next => ({ id: next.id, label: `v${next.workOrderVersion} · ${next.workerName} · ${next.completedQty} 个 · ${next.workDate?.toISOString().slice(0, 10)}` }))} />}
        {job.factReview?.status === 'WAGES_DUE' && <div className="space-y-3"><p role="status" className="text-sm text-warning-foreground">实际生产已核定，原日工资已结算，本次工资待补发。</p><ProductionFactReviewForm jobId={job.id} jobRevision={job.revision} reviewRevision={job.factReview.revision} mode="DISMISS_WAGE" /></div>}
        {job.workDate && <p className="text-sm">实际生产日期：{job.workDate.toISOString().slice(0, 10)}</p>}
        {job.wages.map(wage => <p key={wage.id} className="text-sm">{wage.worker.displayName}：{wage.amount === null ? '待补录提成' : formatMoney(wage.amount)}{wage.settlementId ? ' · 已结算' : ''}</p>)}
        {job.status === 'COMPLETED' && !settledDay && !currentWages.some(wage => wage.settlementId) && <ProductionWageForm key={currentWages.map(wage => `${wage.id}:${wage.revision}`).join(',')} jobId={job.id} owner={{ id: job.workerId, name: job.workerName }} wages={currentWages.map(wage => ({ workerId: wage.workerId, name: wage.worker.displayName, amount: wage.amount?.toString() ?? '', revision: wage.revision }))} workers={workers.map(worker => ({ id: worker.id, name: worker.displayName }))} />}
        {job.status === 'COMPLETED' && !job.historical && !settledDay && !job.wages.some(wage => wage.settlementId) && <CorrectRegistrationButton jobId={job.id} revision={job.revision} quantity={job.completedQty?.toString() ?? '0'} />}
      </div>
    </Disclosure>; })}
  </section>;
}
