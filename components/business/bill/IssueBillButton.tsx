'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { issueBillAction } from '@/actions/bill';
import type { BillMutationResult } from '@/actions/bill.types';

export function IssueBillButton({ billId }: { billId: string }) {
  const [state, action] = useActionState<BillMutationResult | null, void>(
    async () => issueBillAction(billId),
    null,
  );
  const [pending, startTransition] = useTransition();

  return (
    <form action={() => startTransition(() => action())} className="space-y-2">
      <Button type="submit" disabled={pending}>
        {pending ? '发单中…' : '发单给销售 / 客服'}
      </Button>
      {state?.status === 'success' ? (
        <p className="text-xs text-muted-foreground">已发单。</p>
      ) : null}
      {state?.status === 'error' ? (
        <p role="alert" className="text-xs text-destructive">{state.message}</p>
      ) : null}
    </form>
  );
}
