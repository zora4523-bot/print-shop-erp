'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { submitOrderAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';

export function SubmitOrderButton({ orderId }: { orderId: string }) {
  const [state, formAction, pending] = useActionState<OrderMutationResult | null, FormData>(
    async () => submitOrderAction(orderId),
    null,
  );
  const error = state?.status === 'error' ? state.message : null;

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <Button type="submit" disabled={pending}>
          {pending ? '提交中…' : '提交工单'}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
