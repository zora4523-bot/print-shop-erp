'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { claimTaskFormAction } from '@/actions/production';
import type { TaskMutationResult } from '@/actions/production.types';
import { Button } from '@/components/ui/button';

export function ClaimTaskButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    TaskMutationResult | null,
    FormData
  >(claimTaskFormAction, null);

  useEffect(() => {
    if (state?.status === 'success') router.refresh();
  }, [router, state]);

  return (
    <form action={formAction} aria-busy={pending}>
      <input type="hidden" name="taskId" value={taskId} />
      <Button
        type="submit"
        size="lg"
        className="min-h-12 w-full"
        disabled={pending || state?.status === 'success'}
      >
        {pending
          ? '抢单中…'
          : state?.status === 'success'
            ? '已抢到'
            : '抢下这个任务'}
      </Button>
      {state?.status === 'error' ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
