'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { setOrderUrgentAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';

// Inline "set / unset urgent" toggle for the detail page. Posts
// isUrgent directly rather than flipping client-side so the server is
// the source of truth and concurrent updates can't double-flip.

type Props = {
  orderId: string;
  currentValue: boolean;
};

export function UrgentToggleForm({ orderId, currentValue }: Props) {
  const bound = setOrderUrgentAction.bind(null, orderId);
  const [state, action] = useActionState<OrderMutationResult | null, FormData>(
    bound,
    null,
  );
  const [pending, startTransition] = useTransition();
  const target = !currentValue;

  return (
    <form
      action={(formData) => {
        // Strip client state: always send the target boolean computed
        // from server-rendered currentValue, not whatever the browser
        // picks up from the hidden field default.
        formData.set('isUrgent', String(target));
        startTransition(() => action(formData));
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="isUrgent" value={String(target)} />
      <Button
        type="submit"
        size="sm"
        variant={currentValue ? 'outline' : 'destructive'}
        disabled={pending}
      >
        {pending
          ? '处理中…'
          : currentValue
            ? '取消急单'
            : '标记为急单'}
      </Button>
      {state?.status === 'error' && (
        <span className="text-xs text-destructive">{state.message}</span>
      )}
    </form>
  );
}
