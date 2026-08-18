'use client';

import { useActionState, useCallback, useRef, useState } from 'react';
import { SalaryAdjustmentType } from '@/generated/prisma/enums';
import { addDailySalaryAdjustmentAction } from '@/actions/owner-salary';
import type { SalaryMutationResult } from '@/actions/owner-salary.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AddSalaryAdjustmentForm({
  dailySalaryId,
  disabled,
  initialIdempotencyKey,
}: {
  dailySalaryId: string;
  disabled: boolean;
  initialIdempotencyKey: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey);
  const submitAdjustment = useCallback(
    async (previous: SalaryMutationResult | null, formData: FormData) => {
      const result = await addDailySalaryAdjustmentAction(
        dailySalaryId,
        previous,
        formData,
      );
      if (result.status === 'success') {
        formRef.current?.reset();
        setIdempotencyKey(window.crypto.randomUUID());
      }
      return result;
    },
    [dailySalaryId],
  );
  const [state, action, pending] = useActionState<
    SalaryMutationResult | null,
    FormData
  >(submitAdjustment, null);

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-3 sm:grid-cols-[150px_150px_1fr_auto] sm:items-end"
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <label className="space-y-1 text-xs">
        <span className="text-muted-foreground">类型</span>
        <select
          name="type"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          disabled={disabled || pending}
          defaultValue={SalaryAdjustmentType.BONUS}
        >
          <option value={SalaryAdjustmentType.BONUS}>奖金（加）</option>
          <option value={SalaryAdjustmentType.DEDUCTION}>扣款（减）</option>
          <option value={SalaryAdjustmentType.CORRECTION}>差错修正（有符号）</option>
        </select>
      </label>
      <label className="space-y-1 text-xs">
        <span className="text-muted-foreground">金额（元）</span>
        <Input
          name="amount"
          inputMode="decimal"
          placeholder="例如 20 或 -5"
          disabled={disabled || pending}
          required
        />
      </label>
      <label className="space-y-1 text-xs">
        <span className="text-muted-foreground">原因（进入审计记录）</span>
        <Input
          name="reason"
          placeholder="例如：急单奖励 / 质量扣款"
          disabled={disabled || pending}
          required
          maxLength={200}
        />
      </label>
      <Button type="submit" disabled={disabled || pending}>
        {pending ? '保存中…' : '新增调整'}
      </Button>
      {disabled ? (
        <p className="text-xs text-muted-foreground sm:col-span-4">
          已发放记录已锁定；如确需修正，请先撤销发放。
        </p>
      ) : null}
      {state?.status === 'invalid' ? (
        <p className="text-xs text-destructive sm:col-span-4">
          {Object.values(state.fieldErrors).flat().join('；')}
        </p>
      ) : null}
      {state?.status === 'error' ? (
        <p className="text-xs text-destructive sm:col-span-4">{state.message}</p>
      ) : null}
      {state?.status === 'success' ? (
        <p className="text-xs text-success-foreground sm:col-span-4">调整已记账。</p>
      ) : null}
    </form>
  );
}
