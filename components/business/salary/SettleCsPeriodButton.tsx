'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { settleCsPeriodAction } from '@/actions/owner-salary';
import type { SettleCsPeriodResult } from '@/actions/owner-salary.types';

export function SettleCsPeriodButton({ periodId }: { periodId: string }) {
  const [state, action] = useActionState<SettleCsPeriodResult | null, void>(
    async () => settleCsPeriodAction(periodId),
    null,
  );
  const [pending, startTransition] = useTransition();

  return (
    <form action={() => startTransition(() => action())} className="space-y-2">
      <Button type="submit" disabled={pending}>
        {pending ? '结算中…' : '立即结算'}
      </Button>
      {state?.status === 'success' ? (
        <p className="text-xs text-muted-foreground">
          已结算 · 业绩 {state.totalSales} × 档位 {state.tierRate} = 提成 ¥
          {state.commissionAmount} · 周期总收入 ¥ {state.totalIncome}
          {state.nextPeriodId ? ' · 下一周期已开启' : ''}
        </p>
      ) : null}
      {state?.status === 'error' ? (
        <p className="text-xs text-destructive">{state.message}</p>
      ) : null}
    </form>
  );
}
