'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { recomputeDailySalaryAction } from '@/actions/owner-salary';
import type { RecomputeDailyResult } from '@/actions/owner-salary.types';

type Props = {
  defaultDate: string;
};

export function RecomputeDailyForm({ defaultDate }: Props) {
  const [state, action] = useActionState<RecomputeDailyResult | null, unknown>(
    recomputeDailySalaryAction,
    null,
  );
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => {
        const date = String(fd.get('date') ?? '');
        startTransition(() => action({ date }));
      }}
      className="flex items-center gap-3"
    >
      <Input
        type="date"
        name="date"
        defaultValue={defaultDate}
        className="max-w-[180px]"
      />
      <Button type="submit" disabled={pending}>
        {pending ? '重算中…' : '重算该日全员日薪'}
      </Button>
      {state?.status === 'success' ? (
        <span className="text-xs text-muted-foreground">
          {state.date} 已处理 {state.workerCount} 位师傅
        </span>
      ) : null}
      {state?.status === 'error' ? (
        <span className="text-xs text-destructive">{state.message}</span>
      ) : null}
      {state?.status === 'invalid' ? (
        <span className="text-xs text-destructive">
          {Object.values(state.fieldErrors).flat().join('；')}
        </span>
      ) : null}
    </form>
  );
}
