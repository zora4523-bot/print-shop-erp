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
      className="space-y-2"
    >
      <div className="flex items-center gap-3">
        <Input
          type="date"
          name="date"
          aria-label="重算日期"
          defaultValue={defaultDate}
          className="max-w-[180px]"
        />
        <Button type="submit" disabled={pending}>
          {pending ? '重算中…' : '重算该日全员日薪'}
        </Button>
        {state?.status === 'success' ? (
          <span className="text-xs text-muted-foreground">
            {state.date} 已处理 {state.workerCount} 位师傅
            {state.errorCount > 0 ? ` · ${state.errorCount} 个失败` : ''}
          </span>
        ) : null}
      </div>
      {state?.status === 'success' && state.errors.length > 0 ? (
        // role="alert"：汇总行是 role="status"，读屏器只会念到「已处理 N
        // 位 · M 个失败」，念不到具体是谁失败了。
        <ul role="alert" className="text-xs text-destructive space-y-1">
          {state.errors.map((e) => (
            <li key={e.workerId}>
              {e.workerName}：{e.message}
            </li>
          ))}
        </ul>
      ) : null}
      {state?.status === 'error' ? (
        <p role="alert" className="text-xs text-destructive">{state.message}</p>
      ) : null}
      {state?.status === 'invalid' ? (
        <p className="text-xs text-destructive">
          {Object.values(state.fieldErrors).flat().join('；')}
        </p>
      ) : null}
    </form>
  );
}
