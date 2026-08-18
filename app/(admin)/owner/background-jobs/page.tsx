import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { listBackgroundJobs } from '@/lib/background-jobs/repository';
import { getBackgroundJobHealth } from '@/lib/background-jobs/health';
import { backgroundJobOperatorAction } from '@/lib/background-jobs/operator-action';
import {
  cancelBackgroundJobAction,
  retryBackgroundJobAction,
} from '@/actions/background-jobs';
import { BackgroundJobStatus } from '@/generated/prisma/enums';
import { formatDateTimeShanghai } from '@/lib/format/dates';

export const metadata = { title: '后台任务 · 红包印刷 ERP' };
export const dynamic = 'force-dynamic';

export default async function BackgroundJobsPage() {
  await requirePermission('ops:jobs:manage');
  const [jobs, health] = await Promise.all([
    listBackgroundJobs(100),
    getBackgroundJobHealth(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="后台任务"
        subtitle="通知、定时结算和文件生成的持久化账本。普通失败任务可重试；导出失败请回工单列表重新发起。"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="轻任务待处理" value={health.pending.LIGHT} />
        <Metric label="重任务待处理" value={health.pending.HEAVY} />
        <Metric label="执行中" value={health.running} />
        <Metric label="24h 死信" value={health.deadLast24h} alert={health.deadLast24h > 0} />
      </div>

      <div className="rounded-xl border bg-card p-4 text-sm shadow-sm">
        <div className="font-medium">活跃 worker</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {health.activeWorkers.length ? health.activeWorkers.map((worker, index) => (
            <Badge key={`${worker.queue}-${index}`} variant="outline">
              {worker.queue} · {worker.version} · {formatDateTimeShanghai(worker.lastSeenAt)}
            </Badge>
          )) : <span className="text-destructive">未检测到 worker 心跳</span>}
        </div>
      </div>

      <div
        className="overflow-x-auto rounded-xl border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        role="region"
        aria-label="后台任务列表"
        tabIndex={0}
      >
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">创建时间</th>
              <th className="px-3 py-2 text-left">类型</th>
              <th className="px-3 py-2 text-left">队列</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-right">尝试</th>
              <th className="px-3 py-2 text-left">错误码</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {/* 全仓唯一一个零数据时只渲染表头的列表——其余列表页都有空态。 */}
            {jobs.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  暂无后台任务。通知、定时结算与文件生成的任务会落在这里。
                </td>
              </tr>
            ) : null}
            {jobs.map((job) => (
              <tr key={job.id}>
                <td className="px-3 py-2 text-xs">{formatDateTimeShanghai(job.createdAt)}</td>
                <td className="px-3 py-2 font-mono text-xs">{job.type}</td>
                <td className="px-3 py-2"><Badge variant="outline">{job.queue}</Badge></td>
                <td className="px-3 py-2"><JobStatus status={job.status} /></td>
                <td className="px-3 py-2 text-right font-mono text-xs">{job.attempts}/{job.maxAttempts}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{job.lastErrorCode ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  <JobOperation job={job} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JobOperation({ job }: {
  job: { id: string; type: string; status: BackgroundJobStatus };
}) {
  const operation = backgroundJobOperatorAction(job);
  if (operation === 'REQUEST_NEW_EXPORT') {
    return (
      <Link
        href="/orders"
        className={buttonVariants({ variant: 'outline', size: 'xs' })}
        aria-label="请在工单列表重新导出"
      >
        重新导出
      </Link>
    );
  }
  if (operation === 'RETRY') {
    return (
      <JobAction
        action={retryBackgroundJobAction}
        jobId={job.id}
        label="重试"
      />
    );
  }
  if (operation === 'CANCEL') {
    return (
      <JobAction
        action={cancelBackgroundJobAction}
        jobId={job.id}
        label="取消"
      />
    );
  }
  return '—';
}

function Metric({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${alert ? 'text-destructive' : ''}`}>{value}</div>
    </div>
  );
}

function JobStatus({ status }: { status: BackgroundJobStatus }) {
  const variant = status === BackgroundJobStatus.DEAD
    ? 'destructive'
    : status === BackgroundJobStatus.SUCCEEDED
      ? 'default'
      : 'outline';
  return <Badge variant={variant}>{status}</Badge>;
}

function JobAction({ action, jobId, label }: { action: (formData: FormData) => Promise<void>; jobId: string; label: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="jobId" value={jobId} />
      <Button variant="outline" size="xs" type="submit">{label}</Button>
    </form>
  );
}
