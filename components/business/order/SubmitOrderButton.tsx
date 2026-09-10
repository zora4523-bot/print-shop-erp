'use client';

import { useActionState } from 'react';
import { formatMoney } from '@/lib/dashboard/format';
import { Button } from '@/components/ui/button';
import { submitOrderAction } from '@/actions/order';
import type { SubmitOrderMutationResult } from '@/actions/order.types';

export function SubmitOrderButton({ orderId }: { orderId: string }) {
  const [state, formAction, pending] = useActionState<
    SubmitOrderMutationResult | null,
    FormData
  >(
    async (previous) =>
      submitOrderAction(
        orderId,
        previous?.status === 'quote_changed' ? previous.quoteToken : null,
      ),
    null,
  );
  const error = state?.status === 'error' ? state.message : null;

  return (
    <div className="space-y-2">
      <form action={formAction} aria-busy={pending}>
        <Button type="submit" disabled={pending}>
          {pending
            ? '提交中…'
            : state?.status === 'quote_changed'
              ? '确认最新报价并提交'
              : '提交工单'}
        </Button>
      </form>
      {state?.status === 'quote_changed' ? (
        <div
          role="status"
          className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm"
        >
          <p className="font-medium">{state.message}</p>
          <p className="mt-1 tabular-nums">
            {state.quotedFeeCompleteness === 'EXCLUDES_MANUAL_ITEMS'
              ? '已知合计（不含待核价款）'
              : '最新合计'}
            ：{formatMoney(state.quotedFee)}
          </p>
        </div>
      ) : null}
      {state?.status === 'success' ? (
        <p role="status" className="text-sm text-success-foreground">
          工单已提交，正在刷新状态…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
