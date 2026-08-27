'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createTaskDisputeAction } from '@/actions/task-disputes';
import type { TaskDisputeMutationResult } from '@/actions/task-disputes.types';
import type { WorkerTaskDisputeView } from '@/lib/production/task-dispute';
import { ProductionTaskDisputeStatus } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDateTimeShanghai } from '@/lib/format/dates';

export function TaskDisputePanel({
  taskId,
  disputes,
}: {
  taskId: string;
  disputes: WorkerTaskDisputeView[];
}) {
  const router = useRouter();
  const bound = createTaskDisputeAction.bind(null, taskId);
  const [state, action, pending] = useActionState<
    TaskDisputeMutationResult | null,
    FormData
  >(bound, null);
  const hasPending = disputes.some(
    (dispute) => dispute.status === ProductionTaskDisputeStatus.PENDING,
  );

  useEffect(() => {
    if (state?.status === 'success') {
      router.refresh();
    }
  }, [router, state]);

  const reasonError =
    state?.status === 'invalid' ? state.fieldErrors.reason?.[0] : null;

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 text-sm shadow-sm">
      <div>
        <h2 className="font-semibold">任务 / 计件异议</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          可反馈数量、质量、返工或计件金额问题。提交异议不会自动修改报工数量或工资。
        </p>
      </div>

      {hasPending ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          该任务已有一条待处理异议，管理员处理后可再次发起。
        </p>
      ) : (
        <form action={action} aria-busy={pending} className="space-y-2">
          <label htmlFor="task-dispute-reason" className="font-medium">
            异议原因
          </label>
          <textarea
            id="task-dispute-reason"
            name="reason"
            minLength={5}
            maxLength={1000}
            rows={4}
            required
            disabled={pending}
            aria-invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? 'task-dispute-reason-error' : undefined}
            placeholder="请说明具体任务、期望数量/金额和依据"
            className="w-full resize-y rounded-md border bg-background px-3 py-2"
          />
          {reasonError ? (
            <p id="task-dispute-reason-error" className="text-xs text-destructive">
              {reasonError}
            </p>
          ) : null}
          {state?.status === 'error' ? (
            <p role="alert" className="text-xs text-destructive">
              {state.message}
            </p>
          ) : null}
          {state?.status === 'success' ? (
            <p role="status" className="text-xs text-success-foreground">
              {state.message}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="min-h-11">
            {pending ? '提交中…' : '提交异议'}
          </Button>
        </form>
      )}

      <div>
        <h3 className="font-medium">历史异议（{disputes.length}）</h3>
        {disputes.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">暂无异议记录。</p>
        ) : (
          <ol className="mt-2 space-y-3">
            {disputes.map((dispute) => (
              <li key={dispute.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <TaskDisputeStatusBadge status={dispute.status} />
                  <time className="text-xs text-muted-foreground">
                    {formatDateTimeShanghai(dispute.createdAt)}
                  </time>
                </div>
                <p className="worker-wrap-anywhere mt-2 whitespace-pre-wrap">
                  {dispute.reason}
                </p>
                {dispute.resolution ? (
                  <div className="mt-2 rounded-md bg-muted/40 p-2 text-xs">
                    <p className="font-medium">管理员回复</p>
                    <p className="worker-wrap-anywhere mt-1 whitespace-pre-wrap">
                      {dispute.resolution}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {dispute.resolvedBy?.displayName ?? '管理员'} ·{' '}
                      {formatDateTimeShanghai(dispute.resolvedAt)}
                    </p>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

export function TaskDisputeStatusBadge({
  status,
}: {
  status: ProductionTaskDisputeStatus;
}) {
  const label =
    status === ProductionTaskDisputeStatus.PENDING
      ? '待处理'
      : status === ProductionTaskDisputeStatus.RESOLVED
        ? '已解决'
        : '已驳回';
  return (
    <Badge variant={status === ProductionTaskDisputeStatus.PENDING ? 'secondary' : 'outline'}>
      {label}
    </Badge>
  );
}
