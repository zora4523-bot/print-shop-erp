'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { beginTaskFormAction } from '@/actions/production';
import type { TaskMutationResult } from '@/actions/production.types';

type Props = { taskId: string };

export function BeginTaskButton({ taskId }: Props) {
  // A Server Action reference (not a client closure) handed straight to
  // <form action> is what keeps the zero-JS submit path — 师傅在车间弱网
  // 下点「开始生产」时 hydration 可能还没完成。taskId 走 hidden field，
  // 服务端渲染的值，有没有 hydration 都正确。See DECISIONS.md 2026-08-17.
  const [state, formAction, pending] = useActionState<
    TaskMutationResult | null,
    FormData
  >(beginTaskFormAction, null);

  return (
    <form action={formAction} aria-busy={pending}>
      <input type="hidden" name="taskId" value={taskId} />
      <Button
        type="submit"
        disabled={pending}
        size="lg"
        className="min-h-[52px] w-full bg-foreground text-background hover:bg-foreground/80"
      >
        {pending ? '开始中…' : '开始生产'}
      </Button>
      {state?.status === 'error' ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
