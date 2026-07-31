'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { setOrderSfCollectAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';

type Props = {
  orderId: string;
  currentValue: boolean;
};

export function SfCollectToggleForm({ orderId, currentValue }: Props) {
  const bound = setOrderSfCollectAction.bind(null, orderId);
  const [state, action] = useActionState<OrderMutationResult | null, FormData>(
    bound,
    null,
  );
  const [pending, startTransition] = useTransition();
  const target = !currentValue;

  return (
    <form
      action={(formData) => {
        formData.set('isSfCollect', String(target));
        startTransition(() => action(formData));
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="isSfCollect" value={String(target)} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending
          ? '处理中…'
          : currentValue
            ? '取消顺丰到付'
            : '标记顺丰到付'}
      </Button>
      {state?.status === 'error' ? (
        <span role="alert" className="text-xs text-destructive">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
