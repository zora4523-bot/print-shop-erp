'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MaterialMutationResult } from '@/actions/owner-materials.types';
import type { WarehouseLocationOption } from '@/lib/warehouse';
import { TX_REASON_OPTIONS } from '@/lib/material-labels';

type Props = {
  action: (
    prev: MaterialMutationResult | null,
    fd: FormData,
  ) => Promise<MaterialMutationResult>;
  unit: string;
  locationOptions: WarehouseLocationOption[];
};

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function StockTransactionForm({ action, unit, locationOptions }: Props) {
  const [state, formAction, pending] = useActionState<
    MaterialMutationResult | null,
    FormData
  >(action, null);
  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success' ? state.message ?? '库存已更新' : null;
  // 外层不再用 key 强制重挂载（那会连成功提示一起清掉），改成成功后
  // 只 reset 原生表单字段，useActionState 的 state 得以保留并渲染。
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.status === 'success') formRef.current?.reset();
  }, [state]);
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [reasonType, setReasonType] = useState<'PRODUCTION_USE' | 'RETURN' | 'OTHER'>('RETURN');
  const reasonOptions = TX_REASON_OPTIONS.filter((option) =>
    direction === 'IN'
      ? option.value === 'RETURN' || option.value === 'OTHER'
      : option.value === 'PRODUCTION_USE' || option.value === 'OTHER',
  );

  return (
    <form ref={formRef} action={formAction} className="space-y-4" noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="direction">方向</Label>
          <select
            id="direction"
            name="direction"
            className={selectClass}
            value={direction}
            onChange={(event) => {
              const next = event.target.value === 'OUT' ? 'OUT' : 'IN';
              setDirection(next);
              setReasonType(next === 'IN' ? 'RETURN' : 'PRODUCTION_USE');
            }}
            disabled={pending}
          >
            <option value="IN">入库</option>
            <option value="OUT">出库</option>
          </select>
          {errs.direction?.[0] ? (
            <p className="text-sm text-destructive">{errs.direction[0]}</p>
          ) : null}
        </div>
        <TextField
          id="quantity"
          label={`数量（${unit}）`}
          disabled={pending}
          error={errs.quantity?.[0]}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="locationId">库位</Label>
        <select
          id="locationId"
          name="locationId"
          className={selectClass}
          defaultValue=""
          disabled={pending}
        >
          <option value="">默认库位</option>
          {locationOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.warehouseName} / {option.name}
              {option.isDefault ? '（默认）' : ''}
            </option>
          ))}
        </select>
        {errs.locationId?.[0] ? (
          <p className="text-sm text-destructive">{errs.locationId[0]}</p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="reasonType">原因</Label>
          <select
            id="reasonType"
            name="reasonType"
            className={selectClass}
            value={reasonType}
            onChange={(event) =>
              setReasonType(event.target.value as typeof reasonType)
            }
            disabled={pending}
          >
            {reasonOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {errs.reasonType?.[0] ? (
            <p className="text-sm text-destructive">{errs.reasonType[0]}</p>
          ) : null}
        </div>
        <TextField
          id="unitCost"
          label="单位成本（选填）"
          hint="每单位进价，如 0.12；入库时建议填写。"
          disabled={pending}
          error={errs.unitCost?.[0]}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="remark">备注（选填）</Label>
        <textarea
          id="remark"
          name="remark"
          rows={3}
          disabled={pending}
          aria-invalid={Boolean(errs.remark?.[0])}
          className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {errs.remark?.[0] ? (
          <p className="text-sm text-destructive">{errs.remark[0]}</p>
        ) : null}
      </div>

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success-foreground">
          ✓ {success}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? '提交中…' : '提交出入库'}
      </Button>
    </form>
  );
}

function TextField({
  id,
  label,
  hint,
  error,
  defaultValue,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  defaultValue?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        defaultValue={defaultValue}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
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
