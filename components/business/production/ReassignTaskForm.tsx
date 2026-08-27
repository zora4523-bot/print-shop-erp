'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  reassignProductionTaskAction,
  releaseTaskToClaimPoolAction,
} from '@/actions/production';
import type { TaskMutationResult } from '@/actions/production.types';
import type { SchedulingViewCandidate } from '@/lib/production';
import { Button } from '@/components/ui/button';
import {
  MACHINE_TYPE_LABELS,
  WORKER_TYPE_LABELS,
} from '@/lib/auth/role-labels';

export function ReassignTaskForm({
  taskId,
  orderId,
  currentWorkerId,
  craftId,
  eligibleWorkers,
  selfClaimEnabled,
}: {
  taskId: string;
  orderId: string;
  currentWorkerId: string | null;
  craftId: string;
  eligibleWorkers: SchedulingViewCandidate[];
  selfClaimEnabled: boolean;
}) {
  const router = useRouter();
  const bound = reassignProductionTaskAction.bind(null, taskId, orderId);
  const [state, action, pending] = useActionState<
    TaskMutationResult | null,
    FormData
  >(bound, null);
  const [releaseState, releaseAction, releasePending] = useActionState<
    TaskMutationResult | null,
    FormData
  >(releaseTaskToClaimPoolAction, null);
  const [workerId, setWorkerId] = useState(currentWorkerId ?? '');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (state?.status === 'success' || releaseState?.status === 'success') {
      router.refresh();
    }
  }, [releaseState, router, state]);

  const validationError =
    state?.status === 'invalid'
      ? Object.values(state.fieldErrors).flat()[0]
      : null;
  const selectedWorker = eligibleWorkers.find(
    (worker) => worker.id === workerId,
  );
  const needsOverrideReason = Boolean(
    selectedWorker && !selectedWorker.craftCapabilityIds.includes(craftId),
  );
  const normalizedSearch = search.trim().toLocaleLowerCase('zh-CN');
  const visibleWorkers = eligibleWorkers.filter(
    (worker) =>
      worker.id === workerId ||
      normalizedSearch.length === 0 ||
      worker.displayName.toLocaleLowerCase('zh-CN').includes(normalizedSearch),
  );
  const recommendedWorkers = visibleWorkers.filter((worker) =>
    worker.craftCapabilityIds.includes(craftId),
  );
  const overrideWorkers = visibleWorkers.filter(
    (worker) => !worker.craftCapabilityIds.includes(craftId),
  );
  return (
    <div className="grid min-w-0 gap-2">
      {eligibleWorkers.length === 0 ? (
        <span className="text-right text-xs text-destructive">
          {selfClaimEnabled
            ? '没有岗位/机型匹配的启用师傅；可显式释放到抢单池。'
            : '没有岗位/机型匹配的启用师傅；自由抢单当前已关闭，请先补齐师傅能力配置。'}
        </span>
      ) : (
        <form
          action={action}
          aria-busy={pending}
          className="flex min-w-0 flex-wrap items-end justify-end gap-2"
        >
          <label className="min-w-48 flex-1 text-left text-xs">
            <span className="sr-only">搜索改派师傅</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索师傅姓名"
              disabled={pending}
              className="min-h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>
          <select
            name="workerId"
            value={workerId}
            onChange={(event) => setWorkerId(event.target.value)}
            disabled={pending}
            className="min-w-56 rounded-md border bg-background px-3 py-2 text-sm"
            required
          >
            <option value="">选择师傅…</option>
            <WorkerOptions label="推荐师傅" workers={recommendedWorkers} />
            <WorkerOptions
              label="其他可分配（需说明）"
              workers={overrideWorkers}
            />
          </select>
          {needsOverrideReason ? (
            <label className="w-full text-left text-xs font-medium text-warning-foreground">
              非推荐派工原因
              <textarea
                name="overrideReason"
                required
                maxLength={200}
                rows={2}
                disabled={pending}
                placeholder="例如：临时支援，已确认本人可完成"
                className="mt-1 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
          ) : (
            <input type="hidden" name="overrideReason" value="" />
          )}
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? '改派中…' : '确认改派'}
          </Button>
          {state?.status === 'error' ? (
            <span role="alert" className="w-full text-right text-xs text-destructive">
              {state.message}
            </span>
          ) : null}
          {validationError ? (
            <span role="alert" className="w-full text-right text-xs text-destructive">
              {validationError}
            </span>
          ) : null}
        </form>
      )}

      {selfClaimEnabled ? (
        <form
          action={releaseAction}
          aria-busy={releasePending}
          className="flex min-w-0 flex-wrap justify-end gap-2"
        >
          <input type="hidden" name="taskId" value={taskId} />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={releasePending}
          >
            {releasePending ? '释放中…' : '释放到抢单池'}
          </Button>
          {releaseState?.status === 'error' ? (
            <span
              role="alert"
              className="w-full text-right text-xs text-destructive"
            >
              {releaseState.message}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function WorkerOptions({
  label,
  workers,
}: {
  label: string;
  workers: SchedulingViewCandidate[];
}) {
  if (workers.length === 0) return null;
  return (
    <optgroup label={label}>
      {workers.map((worker) => (
        <option key={worker.id} value={worker.id}>
          {worker.displayName}（
          {worker.workerType
            ? WORKER_TYPE_LABELS[worker.workerType]
            : '未配岗'}
          {worker.machineCapabilities.length > 0
            ? ` · ${worker.machineCapabilities
                .map((machine) => MACHINE_TYPE_LABELS[machine])
                .join('/')}`
            : ''}
          ；待办 {worker.pendingTaskCount} / 进行中{' '}
          {worker.inProgressTaskCount}）
        </option>
      ))}
    </optgroup>
  );
}
