import { formatMoney } from '@/lib/dashboard/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import type { Role } from '@/generated/prisma/enums';
import { assertWorkerPortalActor } from '@/lib/production/worker-report-portal';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import { CompletionRegistrationForm } from './CompletionRegistrationForm';

export async function WorkerCompletionDetail({ id, actor }: { id: string; actor: { id: string; role: Role } }) {
  await assertWorkerPortalActor(actor);
  const job = await db.productionJob.findFirst({ where: { id, workerId: actor.id }, include: { order: { select: { id: true, orderNo: true, customName: true, workOrderVersion: true, remark: true } }, wages: { where: { workerId: actor.id } } } });
  if (!job) notFound();
  const current = job.workOrderVersion === job.order.workOrderVersion;
  return <div className="min-w-0 space-y-5"><header><h1 className="break-words text-xl font-semibold">{job.order.customName || job.order.orderNo}</h1><p>{job.label} · v{job.workOrderVersion}</p></header>
    <Link className="inline-flex min-h-11 items-center underline" href={`/worker/orders/${job.orderId}`}>查看工单与设计资料</Link>
    {job.order.remark && <p className="break-words">{job.order.remark}</p>}
    {current ? <CompletionRegistrationForm key={`${job.id}:${job.revision}`} job={{ id: job.id, revision: job.revision, workerName: job.workerName, quantity: job.plannedQty.toString(), requestedQty: job.requestedQty?.toString() ?? null, requestReason: job.requestReason, status: job.status }} admin={false} today={todayShanghai()} /> : <p>工单已改版，请打开当前生产任务。</p>}
    {job.wages.map(wage => <p key={wage.id}>本次提成：{wage.amount === null ? '待管理员补录' : formatMoney(wage.amount)}</p>)}
    <Link className="inline-flex min-h-11 items-center underline" href="/worker/tasks">返回生产工单</Link>
  </div>;
}
