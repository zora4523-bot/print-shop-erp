import { formatMoney } from '@/lib/dashboard/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Role } from '@/generated/prisma/enums';
import { assertWorkerPortalActor } from '@/lib/production/worker-report-portal';
import { getWorkerCompletionJob } from '@/lib/production/worker-completion-detail';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import { PageHeader } from '@/components/ui-business';
import { CompletionRegistrationForm } from './CompletionRegistrationForm';

export async function WorkerCompletionDetail({ id, actor }: { id: string; actor: { id: string; role: Role } }) {
  await assertWorkerPortalActor(actor);
  const job = await getWorkerCompletionJob(id, actor.id);
  if (!job) notFound();
  const current = job.workOrderVersion === job.order.workOrderVersion;
  return <div className="min-w-0 space-y-5">
    <PageHeader size="worker" back={{ href: '/worker/tasks', label: '返回工序工单' }}
      title={job.order.customName || job.order.orderNo}
      subtitle={`${job.label} · 第 ${job.workOrderVersion} 版`} />
    <Link className="inline-flex min-h-11 items-center underline" href={`/worker/orders/${job.orderId}`}>查看工单与设计资料</Link>
    {job.order.remark && <p className="break-words">{job.order.remark}</p>}
    {current ? <CompletionRegistrationForm key={`${job.id}:${job.revision}`} job={{ id: job.id, revision: job.revision, workerName: job.workerName, quantity: job.plannedQty.toString(), requestedQty: job.requestedQty?.toString() ?? null, requestReason: job.requestReason, status: job.status }} admin={false} today={todayShanghai()} /> : <p>工单已改版，请打开当前生产任务。</p>}
    {job.wages.map(wage => <p key={wage.id}>本次提成：{wage.amount === null ? '待管理员补录' : formatMoney(wage.amount)}</p>)}
  </div>;
}
