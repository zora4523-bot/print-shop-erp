'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { finishOrderAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';

// SHIPPED → FINISHED 终态收尾。无额外字段。
export function FinishOrderButton({ orderId }: { orderId: string }) {
  const [state, action] = useActionState<OrderMutationResult | null, void>(
    async () => finishOrderAction(orderId),
    null,
  );
  const [pending, startTransition] = useTransition();

  return (
    <form action={() => startTransition(() => action())} className="space-y-2">
      <Button type="submit" disabled={pending}>
        {pending ? '处理中…' : '确认完工'}
      </Button>
      {state?.status === 'error' ? (
        <p className="text-xs text-destructive">{state.message}</p>
      ) : null}
    </form>
  );
}
