'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { AdjustmentType } from '../../../generated/prisma/enums';
import type { PriceMutationResult } from '@/actions/owner-prices.types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ADJUSTMENT_TYPE_LABELS } from '@/lib/price-labels';

type PriceAdjustmentInitial = {
  name: string;
  adjustmentType: AdjustmentType;
  amount: string;
  triggerCondition: string;
};

type Props =
  | {
      mode: 'create';
      action: (
        prev: PriceMutationResult | null,
        fd: FormData,
      ) => Promise<PriceMutationResult>;
    }
  | {
      mode: 'edit';
      action: (
        prev: PriceMutationResult | null,
        fd: FormData,
      ) => Promise<PriceMutationResult>;
      initial: PriceAdjustmentInitial;
    };

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function PriceAdjustmentForm(props: Props) {
  const [state, formAction, pending] = useActionState<
    PriceMutationResult | null,
    FormData
  >(props.action, null);

  const initial = props.mode === 'edit' ? props.initial : undefined;
  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success';

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <TextField
        id="name"
        label="规则名称"
        required
        disabled={pending}
        error={errs.name?.[0]}
        defaultValue={initial?.name ?? ''}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="adjustmentType">加价类型</Label>
          <select
            id="adjustmentType"
            name="adjustmentType"
            className={selectClass}
            defaultValue={initial?.adjustmentType ?? AdjustmentType.PER_ORDER}
            disabled={pending}
          >
            {Object.values(AdjustmentType).map((type) => (
              <option key={type} value={type}>
                {ADJUSTMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          {errs.adjustmentType?.[0] ? (
            <p className="text-sm text-destructive">{errs.adjustmentType[0]}</p>
          ) : null}
        </div>

        <TextField
          id="amount"
          label="加价金额"
          hint="Decimal(10,4)。"
          required
          disabled={pending}
          error={errs.amount?.[0]}
          defaultValue={initial?.amount ?? ''}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="triggerCondition">触发条件（JSON object，可选）</Label>
        <textarea
          id="triggerCondition"
          name="triggerCondition"
          rows={6}
          disabled={pending}
          aria-invalid={Boolean(errs.triggerCondition?.[0])}
          aria-describedby={
            errs.triggerCondition?.[0] ? 'triggerCondition-error' : 'triggerCondition-hint'
          }
          defaultValue={initial?.triggerCondition ?? ''}
          className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {errs.triggerCondition?.[0] ? (
          <p id="triggerCondition-error" className="text-sm text-destructive">
            {errs.triggerCondition[0]}
          </p>
        ) : (
          <p id="triggerCondition-hint" className="text-xs text-muted-foreground">
            例如 {'{"craft":"foil"}'}；留空表示不限制。
          </p>
        )}
      </div>

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success">
          ✓ 已保存
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? '提交中…' : props.mode === 'create' ? '创建加价规则' : '保存修改'}
        </Button>
        <Link href="/owner/prices" className={buttonVariants({ variant: 'outline' })}>
          返回价格字典
        </Link>
      </div>
    </form>
  );
}

function TextField({
  id,
  label,
  hint,
  error,
  type = 'text',
  ...inputProps
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  defaultValue?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type={type}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...inputProps}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
