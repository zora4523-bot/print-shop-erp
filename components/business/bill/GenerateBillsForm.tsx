'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { generateBillsAction } from '@/actions/bill';
import type { GenerateBillsResult } from '@/actions/bill.types';

type Props = {
  defaultPeriod: string;
};

export function GenerateBillsForm({ defaultPeriod }: Props) {
  const [state, action] = useActionState<GenerateBillsResult | null, unknown>(
    generateBillsAction,
    null,
  );
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => {
        const period = String(fd.get('period') ?? '');
        startTransition(() => action({ period }));
      }}
      className="space-y-2"
    >
      <div className="flex items-center gap-3">
        <Input
          type="month"
          name="period"
          defaultValue={defaultPeriod}
          className="max-w-[180px]"
        />
        <Button type="submit" disabled={pending}>
          {pending ? '生成中…' : '生成 / 追加月账单'}
        </Button>
        {state?.status === 'success' ? (
          <span className="text-xs text-muted-foreground">
            {state.period} 已生成 {state.generatedCount} 条
            {state.errorCount > 0 ? ` · ${state.errorCount} 个失败` : ''}
          </span>
        ) : null}
      </div>
      {state?.status === 'success' && state.errors.length > 0 ? (
        <ul className="text-xs text-destructive space-y-1">
          {state.errors.map((e) => (
            <li key={e.salesUserId}>
              {e.salesUserId}: {e.message}
            </li>
          ))}
        </ul>
      ) : null}
      {state?.status === 'error' ? (
        <p className="text-xs text-destructive">{state.message}</p>
      ) : null}
      {state?.status === 'invalid' ? (
        <p className="text-xs text-destructive">
          {Object.values(state.fieldErrors).flat().join('；')}
        </p>
      ) : null}
    </form>
  );
}
