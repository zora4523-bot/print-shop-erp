'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cancelOrderAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';

export function CancelOrderForm({ orderId }: { orderId: string }) {
  const bound = cancelOrderAction.bind(null, orderId);
  const [state, formAction, pending] = useActionState<OrderMutationResult | null, FormData>(
    bound,
    null,
  );
  const error = state?.status === 'error' ? state.message : null;
  const fieldError =
    state?.status === 'invalid' ? state.fieldErrors.reason?.[0] : undefined;

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <div className="space-y-2">
        <Label htmlFor="cancel-reason">取消原因（选填）</Label>
        <textarea
          id="cancel-reason"
          name="reason"
          maxLength={500}
          rows={3}
          disabled={pending}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {fieldError ? (
          <p className="text-sm text-destructive">{fieldError}</p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? '取消中…' : '取消工单'}
      </Button>
    </form>
  );
}
