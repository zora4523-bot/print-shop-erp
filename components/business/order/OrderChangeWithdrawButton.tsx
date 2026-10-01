'use client';

import { useActionState } from 'react';
import { withdrawOrderChangeRequestAction } from '@/actions/order';
import type { WithdrawOrderChangeRequestMutationResult } from '@/actions/order.types';
import { Button } from '@/components/ui/button';

export function OrderChangeWithdrawButton({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState<
    WithdrawOrderChangeRequestMutationResult | null,
    FormData
  >(withdrawOrderChangeRequestAction, null);

  if (state?.status === 'success') {
    return <p className="text-xs text-muted-foreground">申请已撤回</p>;
  }
  const error =
    state?.status === 'error'
      ? state.message
      : state?.status === 'invalid'
        ? Object.values(state.fieldErrors).flat()[0]
        : null;

  return (
    <form action={action} aria-busy={pending} className="mt-3 border-t pt-3">
      <input type="hidden" name="requestId" value={requestId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? '正在撤回…' : '撤回申请'}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
