'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { recordBillPaymentAction } from '@/actions/bill';
import type { RecordBillPaymentResult } from '@/actions/bill.types';

type Props = {
  billId: string;
  remainingAmount: string;
};

export function RecordPaymentForm({ billId, remainingAmount }: Props) {
  const bound = recordBillPaymentAction.bind(null, billId);
  const [state, action] = useActionState<RecordBillPaymentResult | null, FormData>(
    bound,
    null,
  );
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => startTransition(() => action(fd))}
      className="space-y-2"
    >
      <div className="flex items-center gap-3">
        <Input
          type="text"
          name="amount"
          inputMode="decimal"
          placeholder={`最多 ${remainingAmount}`}
          className="max-w-[180px] font-sans tabular-nums"
        />
        <Button type="submit" disabled={pending}>
          {pending ? '录入中…' : '录入付款'}
        </Button>
        {state?.status === 'success' ? (
          <span className="text-xs text-muted-foreground">
            已付 ¥{state.newPaidAmount} / ¥{state.totalAmount} ·{' '}
            {state.billStatus === 'FULLY_PAID' ? '结清' : '部分结清'}
            {state.csAccumulated ? ' · 客服业绩已累计' : ''}
          </span>
        ) : null}
      </div>
      {state?.status === 'error' ? (
        <p className="text-xs text-destructive">{state.message}</p>
      ) : null}
      {state?.status === 'invalid' ? (
        <p className="text-xs text-destructive">
          {Object.values(state.fieldErrors).flat().join('；')}
        </p>
      ) : null}
    </form>
  );
}
