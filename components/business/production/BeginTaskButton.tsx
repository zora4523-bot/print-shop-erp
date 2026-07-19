'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { beginTaskAction } from '@/actions/production';
import type { TaskMutationResult } from '@/actions/production.types';

type Props = { taskId: string };

export function BeginTaskButton({ taskId }: Props) {
  const boundAction = beginTaskAction.bind(null, taskId);
  const [state, formAction] = useActionState<TaskMutationResult | null, void>(
    async () => boundAction(),
    null,
  );
  const [pending, startTransition] = useTransition();

  return (
    <form action={() => startTransition(() => formAction())}>
      <Button
        type="submit"
        disabled={pending}
        size="lg"
        className="min-h-11 w-full bg-foreground text-background hover:bg-foreground/80"
      >
        {pending ? '开始中…' : '开始生产'}
      </Button>
      {state?.status === 'error' ? (
        <p aria-live="polite" className="mt-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
