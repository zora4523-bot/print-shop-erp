'use client';

import { useActionState, useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { recordOutsourcePaymentAction } from '@/actions/outsource';
import type { OutsourcePaymentMutationResult } from '@/actions/outsource.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { nextOutsourceIdempotencyKey } from './idempotency';

type Props = {
  id: string;
  remainingAmount: string;
  initialIdempotencyKey: string;
};

export function OutsourcePaymentForm({
  id,
  remainingAmount,
  initialIdempotencyKey,
}: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(
    initialIdempotencyKey,
  );
  const submitPayment = useCallback(
    async (
      previous: OutsourcePaymentMutationResult | null,
      formData: FormData,
    ) => {
      const result = await recordOutsourcePaymentAction(id, previous, formData);
      setIdempotencyKey((current) =>
        nextOutsourceIdempotencyKey(
          current,
          result,
          () => window.crypto.randomUUID(),
        ),
      );
      if (result.status === 'success') {
        formRef.current?.reset();
        router.refresh();
      }
      return result;
    },
    [id, router],
  );
  const [state, action, pending] = useActionState<
    OutsourcePaymentMutationResult | null,
    FormData
  >(submitPayment, null);
  const errors = state?.status === 'invalid' ? state.fieldErrors : {};

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="outsource-payment-amount">本次付款金额（元）</Label>
          <Input
            id="outsource-payment-amount"
            name="amount"
            inputMode="decimal"
            placeholder={`最多 ${remainingAmount}`}
            className="font-sans tabular-nums"
            required
            aria-invalid={Boolean(errors.amount?.length)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="outsource-payment-paid-at">付款时间</Label>
          <Input
            id="outsource-payment-paid-at"
            type="datetime-local"
            name="paidAt"
            defaultValue={shanghaiDateTimeLocal(new Date())}
            required
            aria-invalid={Boolean(errors.paidAt?.length)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="outsource-payment-method">付款方式（选填）</Label>
          <Input
            id="outsource-payment-method"
            name="method"
            maxLength={32}
            placeholder="微信 / 支付宝 / 银行"
            aria-invalid={Boolean(errors.method?.length)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="outsource-payment-reference">付款流水号（选填）</Label>
          <Input
            id="outsource-payment-reference"
            name="reference"
            maxLength={64}
            aria-invalid={Boolean(errors.reference?.length)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="outsource-payment-remark">备注（选填）</Label>
          <Input
            id="outsource-payment-remark"
            name="remark"
            maxLength={200}
            placeholder="例如：首付款、第二笔尾款"
            aria-invalid={Boolean(errors.remark?.length)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="min-h-11">
          {pending ? '记录中…' : '记录外协付款'}
        </Button>
        {state?.status === 'success' ? (
          <span
            className="text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            已付 ¥ {state.newPaidAmount} / ¥ {state.totalAmount} ·{' '}
            {state.isFullyPaid
              ? '已结清'
              : `未付 ¥ ${state.remainingAmount}`}
          </span>
        ) : null}
      </div>

      {state?.status === 'invalid' ? (
        <p className="text-xs text-destructive" role="alert">
          {Object.values(state.fieldErrors).flat().join('；')}
        </p>
      ) : null}
      {state?.status === 'error' ? (
        <p className="text-xs text-destructive" role="alert">
          {state.message}
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
