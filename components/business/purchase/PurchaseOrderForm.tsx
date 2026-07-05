'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { PurchaseMutationResult } from '@/actions/owner-purchases.types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SupplierPartyOption } from '@/lib/party';

export type PurchaseMaterialOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
};

type Props = {
  action: (
    prev: PurchaseMutationResult | null,
    fd: FormData,
  ) => Promise<PurchaseMutationResult>;
  suppliers: SupplierPartyOption[];
  materials: PurchaseMaterialOption[];
};

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function PurchaseOrderForm({ action, suppliers, materials }: Props) {
  const [state, formAction, pending] = useActionState<
    PurchaseMutationResult | null,
    FormData
  >(action, null);

  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="supplierPartyId">供应商</Label>
          <select
            id="supplierPartyId"
            name="supplierPartyId"
            className={selectClass}
            disabled={pending}
            defaultValue=""
          >
            <option value="">请选择供应商</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.code} · {supplier.shortName ?? supplier.name}
              </option>
            ))}
          </select>
          {errs.supplierPartyId?.[0] ? (
            <p className="text-sm text-destructive">{errs.supplierPartyId[0]}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="materialId">物料</Label>
          <select
            id="materialId"
            name="materialId"
            className={selectClass}
            disabled={pending}
            defaultValue=""
          >
            <option value="">请选择物料</option>
            {materials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.code} · {material.name}（{material.unit}）
              </option>
            ))}
          </select>
          {errs.materialId?.[0] ? (
            <p className="text-sm text-destructive">{errs.materialId[0]}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <TextField
          id="quantity"
          label="采购数量"
          disabled={pending}
          error={errs.quantity?.[0]}
        />
        <TextField
          id="unitCost"
          label="单位成本（选填）"
          disabled={pending}
          error={errs.unitCost?.[0]}
        />
        <TextField
          id="expectedDate"
          label="预计到货日（选填）"
          type="date"
          disabled={pending}
          error={errs.expectedDate?.[0]}
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

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? '提交中…' : '创建采购单'}
        </Button>
        <Link href="/owner/purchases" className={buttonVariants({ variant: 'outline' })}>
          返回列表
        </Link>
      </div>
    </form>
  );
}

function TextField({
  id,
  label,
  error,
  type = 'text',
  disabled,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type={type}
        disabled={disabled}
        aria-invalid={Boolean(error)}
      />
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
