'use client';

import { useActionState, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmOutsourceAmountAction } from '@/actions/outsource';
import type { OutsourceAmountMutationResult } from '@/actions/outsource.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { nextOutsourceIdempotencyKey } from './idempotency';
import { formatMoney } from '@/lib/dashboard/format';

export function OutsourceAmountForm({
  id,
  currentAmount,
  initialIdempotencyKey,
}: {
  id: string;
  currentAmount: string | null;
  initialIdempotencyKey: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(currentAmount ?? '');
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(
    initialIdempotencyKey,
  );
  const submitAmount = useCallback(
    async (
      previous: OutsourceAmountMutationResult | null,
      formData: FormData,
    ) => {
      const result = await confirmOutsourceAmountAction(id, previous, formData);
      setIdempotencyKey((current) =>
        nextOutsourceIdempotencyKey(
          current,
          result,
          () => window.crypto.randomUUID(),
        ),
      );
      if (result.status === 'success') {
        setAmount(result.amount);
        setReason('');
        router.refresh();
      }
      return result;
    },
    [id, router],
  );
  const [state, action, pending] = useActionState<
    OutsourceAmountMutationResult | null,
    FormData
  >(submitAmount, null);
  const errors = state?.status === 'invalid' ? state.fieldErrors : {};

  return (
    <form action={action} aria-busy={pending} className="space-y-3">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="outsource-amount">
            {currentAmount === null ? '确认金额（元）' : '更正金额（元）'}
          </Label>
          <Input
            id="outsource-amount"
            name="amount"
            value={amount}
            disabled={pending}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            min="0"
            max="9999999999.99"
            step="0.01"
            required
            aria-invalid={Boolean(errors.amount?.length)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="outsource-amount-reason">确认 / 更正原因</Label>
          <Input
            id="outsource-amount-reason"
            name="reason"
            value={reason}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
            required
            placeholder={
              currentAmount === null ? '例如：回货后按对账单确认' : '例如：外协厂最终对账更正'
            }
            aria-invalid={Boolean(errors.reason?.length)}
          />
        </div>
        <Button type="submit" disabled={pending} className="min-h-11">
          {pending ? '正在保存…' : currentAmount === null ? '确认金额' : '保存更正'}
        </Button>
      </div>
      {state?.status === 'invalid' ? (
        <p className="text-xs text-destructive" aria-live="polite">
          {Object.values(state.fieldErrors).flat().join('；')}
        </p>
      ) : null}
      {state?.status === 'error' ? (
        <p role="alert" className="text-xs text-destructive" aria-live="polite">
          {state.message}
        </p>
      ) : null}
      {state?.status === 'success' ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          已保存外协金额 {formatMoney(state.amount)}
        </p>
      ) : null}
    </form>
  );
}
