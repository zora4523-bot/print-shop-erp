'use client';

import { useActionState, useEffect } from 'react';
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
  eligibleWorkers,
}: {
  taskId: string;
  orderId: string;
  currentWorkerId: string | null;
  eligibleWorkers: SchedulingViewCandidate[];
}) {
  const router = useRouter();
  const bound = reassignProductionTaskAction.bind(null, taskId, orderId);
  const [state, action, pending] = useActionState<
    TaskMutationResult | null,
    FormData
  >(bound, null);

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
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <select
        name="workerId"
        defaultValue={currentWorkerId ?? ''}
        disabled={pending}
        className="min-w-56 rounded-md border bg-background px-3 py-2 text-sm"
        required
      >
        <option value="">选择师傅…</option>
        {eligibleWorkers.map((worker) => (
          <option key={worker.id} value={worker.id}>
            {worker.displayName}（
            {worker.workerType ? WORKER_TYPE_LABELS[worker.workerType] : '未配岗'}
            {worker.machineType
              ? ` · ${MACHINE_TYPE_LABELS[worker.machineType]}`
              : ''}
            ；待办 {worker.pendingTaskCount} / 进行中 {worker.inProgressTaskCount}）
          </option>
        ))}
      </select>
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
