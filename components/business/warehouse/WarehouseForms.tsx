'use client';

import { useActionState } from 'react';
import {
  createWarehouseAction,
  createWarehouseLocationAction,
} from '@/actions/owner-warehouses';
import type { WarehouseMutationResult } from '@/actions/owner-warehouses.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type WarehouseFormOption = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type Props = {
  warehouses: WarehouseFormOption[];
};
const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function WarehouseForms({ warehouses }: Props) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <WarehouseCreateForm />
      <LocationCreateForm warehouses={warehouses.filter((item) => item.isActive)} />
    </div>
  );
}

function WarehouseCreateForm() {
  const [state, formAction, pending] = useActionState<
    WarehouseMutationResult | null,
    FormData
  >(createWarehouseAction, null);
  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const error = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success' ? state.message ?? null : null;

  return (
    <form action={formAction} className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
      <h2 className="text-base font-semibold">新增仓库</h2>
      <TextField id="name" label="仓库名称" error={errs.name?.[0]} disabled={pending} />
      <details className="rounded-lg border border-dashed p-3" open={Boolean(errs.code?.[0])}>
        <summary className="cursor-pointer text-sm text-muted-foreground">
          高级设置：自定义仓库编码（通常无需填写）
        </summary>
        <div className="mt-3">
          <TextField
            id="code"
            label="自定义编码（选填）"
            hint="留空将自动生成，例如 WH-000001。"
            error={errs.code?.[0]}
            disabled={pending}
          />
        </div>
      </details>
      <ActionFeedback error={error} success={success} />
      <Button type="submit" disabled={pending}>
        {pending ? '提交中…' : '创建仓库'}
      </Button>
    </form>
  );
}

function LocationCreateForm({ warehouses }: { warehouses: WarehouseFormOption[] }) {
  const [state, formAction, pending] = useActionState<
    WarehouseMutationResult | null,
    FormData
  >(createWarehouseLocationAction, null);
  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const error = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success' ? state.message ?? null : null;
  const missingWarehouses = warehouses.length === 0;

  return (
    <form action={formAction} className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
      <h2 className="text-base font-semibold">新增库位</h2>
      <div className="space-y-2">
        <Label htmlFor="warehouseId">所属仓库</Label>
        <select
          id="warehouseId"
          name="warehouseId"
          className={selectClass}
          disabled={pending || missingWarehouses}
          defaultValue=""
        >
          <option value="">请选择仓库</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.code} · {warehouse.name}
            </option>
          ))}
        </select>
        {errs.warehouseId?.[0] ? (
          <p className="text-sm text-destructive">{errs.warehouseId[0]}</p>
        ) : null}
        {missingWarehouses ? (
          <p role="alert" className="text-sm text-warning-foreground">
            暂无启用仓库，请先在左侧创建仓库。
          </p>
        ) : null}
      </div>
      <TextField id="name" label="库位名称" error={errs.name?.[0]} disabled={pending} />
      <details className="rounded-lg border border-dashed p-3" open={Boolean(errs.code?.[0])}>
        <summary className="cursor-pointer text-sm text-muted-foreground">
          高级设置：自定义库位编码（通常无需填写）
        </summary>
        <div className="mt-3">
          <TextField
            id="code"
            label="自定义编码（选填）"
            hint="留空将自动生成，例如 LOC-000001。"
            error={errs.code?.[0]}
            disabled={pending}
          />
        </div>
      </details>
      <ActionFeedback error={error} success={success} />
      <Button type="submit" disabled={pending || missingWarehouses}>
        {pending ? '提交中…' : '创建库位'}
      </Button>
    </form>
  );
}

function TextField({
  id,
  label,
  hint,
  error,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
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

function ActionFeedback({
  error,
  success,
}: {
  error: string | null;
  success: string | null;
}) {
  return (
    <>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success">
          ✓ {success}
        </p>
      ) : null}
    </>
  );
}
