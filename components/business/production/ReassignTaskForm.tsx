'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { reassignProductionTaskAction } from '@/actions/production';
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
}: {
  taskId: string;
  orderId: string;
  currentWorkerId: string | null;
  craftId: string;
  eligibleWorkers: SchedulingViewCandidate[];
}) {
  const router = useRouter();
  const bound = reassignProductionTaskAction.bind(null, taskId, orderId);
  const [state, action, pending] = useActionState<
    TaskMutationResult | null,
    FormData
  >(bound, null);
  const [workerId, setWorkerId] = useState(currentWorkerId ?? '');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (state?.status === 'success') router.refresh();
  }, [router, state]);

  if (eligibleWorkers.length === 0) {
    return (
      <span className="text-xs text-destructive">
        没有岗位/机型匹配的启用师傅
      </span>
    );
  }

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
    <form
      action={action}
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
        <WorkerOptions
          label="推荐师傅"
          workers={recommendedWorkers}
        />
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
