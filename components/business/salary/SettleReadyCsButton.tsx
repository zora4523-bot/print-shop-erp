'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { settleReadyCsPeriodsAction } from '@/actions/owner-salary';
import type { SettleReadyCsResult } from '@/actions/owner-salary.types';

export function SettleReadyCsButton() {
  const [state, action] = useActionState<SettleReadyCsResult | null, void>(
    async () => settleReadyCsPeriodsAction(),
    null,
  );
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3">
      <form action={() => startTransition(() => action())}>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? '扫描结算中…' : '扫描并结算已到期周期'}
        </Button>
      </form>
      {state?.status === 'success' ? (
        <span className="text-xs text-muted-foreground">
          已结算 {state.settledCount} 个周期
        </span>
      ) : null}
      {state?.status === 'error' ? (
        <span className="text-xs text-destructive">{state.message}</span>
      ) : null}
    </div>
  );
}
