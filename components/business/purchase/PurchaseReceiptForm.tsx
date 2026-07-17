'use client';

import { useActionState, useCallback, useState } from 'react';
import type { PurchaseMutationResult } from '@/actions/owner-purchases.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WarehouseLocationOption } from '@/lib/warehouse';

type Props = {
  action: (
    prev: PurchaseMutationResult | null,
    fd: FormData,
  ) => Promise<PurchaseMutationResult>;
  purchaseOrderItemId: string;
  unit: string;
  defaultUnitCost: string | null;
  remainingQuantity: string;
  locationOptions: WarehouseLocationOption[];
  initialIdempotencyKey: string;
};

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function PurchaseReceiptForm({
  action,
  purchaseOrderItemId,
  unit,
  defaultUnitCost,
  remainingQuantity,
  locationOptions,
  initialIdempotencyKey,
}: Props) {
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey);
  const submitReceipt = useCallback(
    async (prev: PurchaseMutationResult | null, formData: FormData) => {
      const result = await action(prev, formData);
      if (result.status === 'success') {
        setIdempotencyKey(window.crypto.randomUUID());
      }
      return result;
    },
    [action],
  );
  const [state, formAction, pending] = useActionState<
    PurchaseMutationResult | null,
    FormData
  >(submitReceipt, null);

  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success' ? state.message : null;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="purchaseOrderItemId" value={purchaseOrderItemId} />
      <div className="space-y-2">
        <Label htmlFor={`location-${purchaseOrderItemId}`}>收货库位</Label>
        <select
          id={`location-${purchaseOrderItemId}`}
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
        <TextField
          id={`receipt-quantity-${purchaseOrderItemId}`}
          name="quantity"
          label={`本次收货数量（${unit}）`}
          hint={`剩余 ${remainingQuantity} ${unit}`}
          disabled={pending}
          error={errs.quantity?.[0]}
        />
        <TextField
          id={`receipt-unit-cost-${purchaseOrderItemId}`}
          name="unitCost"
          label="单位成本（选填）"
          disabled={pending}
          error={errs.unitCost?.[0]}
          defaultValue={defaultUnitCost ?? ''}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`receipt-remark-${purchaseOrderItemId}`}>备注（选填）</Label>
        <textarea
          id={`receipt-remark-${purchaseOrderItemId}`}
          name="remark"
          rows={2}
          disabled={pending}
          aria-invalid={Boolean(errs.remark?.[0])}
          className="min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
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
        <p role="status" className="text-sm text-success">
          ✓ {success}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? '提交中…' : '确认收货过账'}
      </Button>
    </form>
  );
}

function TextField({
  id,
  name,
  label,
  hint,
  error,
  defaultValue,
  disabled,
}: {
  id: string;
  name: string;
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
        name={name}
        defaultValue={defaultValue}
        disabled={disabled}
        aria-invalid={Boolean(error)}
      />
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
