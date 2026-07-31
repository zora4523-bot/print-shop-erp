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
  const defaultPaidAt = shanghaiDateTimeLocal(new Date());

  return (
    <form
      action={(fd) => startTransition(() => action(fd))}
      className="space-y-2"
    >
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>本次收款金额</span>
          <Input
            type="text"
            name="amount"
            inputMode="decimal"
            placeholder={`最多 ${remainingAmount}`}
            className="font-sans tabular-nums"
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>收款时间</span>
          <Input
            type="datetime-local"
            name="paidAt"
            defaultValue={defaultPaidAt}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>收款方式</span>
          <Input name="paymentMethod" maxLength={32} placeholder="微信 / 支付宝 / 银行" />
        </label>
        <label className="space-y-1 text-sm">
          <span>流水号</span>
          <Input name="referenceNo" maxLength={64} />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span>备注</span>
          <Input name="remark" maxLength={200} placeholder="例如：首付款、第二笔尾款" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="min-h-11">
          {pending ? '录入中…' : '录入付款流水'}
        </Button>
        {state?.status === 'success' ? (
          <span className="text-xs text-muted-foreground">
            已付 ¥{state.newPaidAmount} / ¥{state.totalAmount} ·{' '}
            {state.billStatus === 'FULLY_PAID' ? '结清' : '部分结清'}
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

function shanghaiDateTimeLocal(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}
