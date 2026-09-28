import { ChevronDown } from 'lucide-react';
import { CorrectRegistrationButton } from './CorrectRegistrationButton';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { formatMoney } from '@/lib/dashboard/format';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/auth/permissions';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import { StatusBadge } from '@/components/ui-business';
import { CompletionRegistrationForm } from './CompletionRegistrationForm';
import { ProductionWageForm } from './ProductionWageForm';

/** Admin-only: never pass internal wages into the sales detail model. */
export async function ProductionJobPanel({ orderId }: { orderId: string }) {
  const actor = await requirePermission('production:manage');
  if (actor.role !== 'ADMIN') return null;
  const jobs = await db.productionJob.findMany({ where: { orderId }, orderBy: [{ workOrderVersion: 'desc' }, { createdAt: 'asc' }], include: { wages: { include: { worker: { select: { displayName: true } } } } } });
  const workers = await db.user.findMany({ where: { role: 'WORKER' }, select: { id: true, displayName: true }, orderBy: { displayName: 'asc' } });
  return <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4" aria-label="生产安排与提成">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">生产安排与提成</h2><Link className="inline-flex min-h-11 items-center underline" href={`/orders/production?ids=${encodeURIComponent(orderId)}`}>安排生产师傅</Link></div>
    {jobs.map(job => {
      const currentWages = job.wages.filter(wage => wage.workDate.getTime() === job.workDate?.getTime());
      return <Disclosure key={job.id} className="min-w-0 rounded-lg border p-3" open={job.workOrderVersion === jobs[0]?.workOrderVersion || job.wages.some(wage => wage.amount === null)}>
      <DisclosureSummary className="min-h-11 cursor-pointer gap-2 py-2"><span className="min-w-0 flex-1 break-words">v{job.workOrderVersion} · {job.label} · {job.workerName} · {job.completedQty?.toString() ?? job.plannedQty.toString()} 个 <StatusBadge tone={job.status === 'COMPLETED' || job.status === 'CARRIED' ? 'success' : 'neutral'}>{job.status === 'COMPLETED' ? '已登记完成' : job.status === 'CARRIED' ? '沿用已产数量' : job.status === 'REQUESTED' ? '数量待审批' : job.status === 'CANCELLED' ? '已取消' : '生产中'}</StatusBadge>{job.manualPricing && ' · 改版生产'}{job.wages.some(wage => wage.amount === null) && ' · 待补录提成'}</span><ChevronDown aria-hidden className="size-4 shrink-0 transition-transform group-open:rotate-180" /></DisclosureSummary>
      <div className="space-y-4 pt-3">
        {['PENDING', 'REQUESTED'].includes(job.status) && <CompletionRegistrationForm job={{ id: job.id, revision: job.revision, workerName: job.workerName, quantity: job.plannedQty.toString(), requestedQty: job.requestedQty?.toString() ?? null, requestReason: job.requestReason, status: job.status }} admin today={todayShanghai()} />}
        {job.workDate && <p className="text-sm">实际生产日期：{job.workDate.toISOString().slice(0, 10)}</p>}
        {job.wages.map(wage => <p key={wage.id} className="text-sm">{wage.worker.displayName}：{wage.amount === null ? '待补录提成' : formatMoney(wage.amount)}{wage.settlementId ? ' · 已结算' : ''}</p>)}
        {job.status === 'COMPLETED' && !currentWages.some(wage => wage.settlementId) && <ProductionWageForm key={currentWages.map(wage => `${wage.id}:${wage.revision}`).join(',')} jobId={job.id} owner={{ id: job.workerId, name: job.workerName }} wages={currentWages.map(wage => ({ workerId: wage.workerId, name: wage.worker.displayName, amount: wage.amount?.toString() ?? '', revision: wage.revision }))} workers={workers.map(worker => ({ id: worker.id, name: worker.displayName }))} />}
        {job.status === 'COMPLETED' && !job.wages.some(wage => wage.settlementId) && <CorrectRegistrationButton jobId={job.id} revision={job.revision} quantity={job.completedQty?.toString() ?? '0'} />}
      </div>
    </Disclosure>; })}
  </section>;
}
