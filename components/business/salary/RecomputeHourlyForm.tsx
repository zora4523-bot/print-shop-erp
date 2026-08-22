'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { recomputeHourlyPayrollAction } from '@/actions/owner-salary';
import type { RecomputeHourlyResult } from '@/actions/owner-salary.types';

type Props = {
  defaultMonth: string;
  // 上海日历的本月。纯浏览器层提示，真闸口在 lib/salary/hourly-aggregate.ts
  // 的 assertNotFutureSalaryMonth。
  maxMonth: string;
};

export function RecomputeHourlyForm({ defaultMonth, maxMonth }: Props) {
  const [state, action] = useActionState<RecomputeHourlyResult | null, unknown>(
    recomputeHourlyPayrollAction,
    null,
  );
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => {
        const month = String(fd.get('month') ?? '');
        startTransition(() => action({ month }));
      }}
      className="space-y-2"
    >
      <div className="flex items-center gap-3">
        <Input
          type="month"
          name="month"
          aria-label="重算月份"
          defaultValue={defaultMonth}
          max={maxMonth}
          className="max-w-[180px]"
        />
        <Button type="submit" disabled={pending}>
          {pending ? '重算中…' : '重算该月全员时薪工月结'}
        </Button>
      </div>
      {state?.status === 'success' ? (
        <p className="text-xs text-muted-foreground">
          {state.month} 已处理 {state.workerCount} 位时薪工
          {state.errorCount > 0 ? ` · ${state.errorCount} 个失败` : ''}
        </p>
      ) : null}
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
