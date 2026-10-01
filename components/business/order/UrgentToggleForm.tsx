'use client';

import { useActionState } from 'react';
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
  const [state, action, pending] = useActionState<
    OrderMutationResult | null,
    FormData
  >(bound, null);
  const target = !currentValue;

  return (
    // `action={action}` (no arrow wrapper) keeps the native form action +
    // hidden $ACTION_ID in the SSR output, which is what actions/order.ts's
    // "zero-JS plain form" comment is describing. The target boolean rides
    // in the hidden field below — it is computed from the server-rendered
    // currentValue, so it stays correct with or without hydration.
    <form action={action} aria-busy={pending} className="flex items-center gap-2">
      <input type="hidden" name="isUrgent" value={String(target)} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
      >
        {pending
          ? '正在处理…'
          : currentValue
            ? '取消急单'
            : '标记为急单'}
      </Button>
      {state?.status === 'error' && (
        <span role="alert" className="text-xs text-destructive">{state.message}</span>
      )}
    </form>
  );
}
