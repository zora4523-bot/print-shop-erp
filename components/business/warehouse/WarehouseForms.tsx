'use client';

import { useActionState, useState } from 'react';
import {
  createWarehouseAction,
  createWarehouseLocationAction,
} from '@/actions/owner-warehouses';
import type { WarehouseMutationResult } from '@/actions/owner-warehouses.types';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ActionNotice,
  FormErrorSummary,
  FormMessage,
  PendingButton,
  formMessageA11yProps,
  type FormErrorSummaryItem,
} from '@/components/ui-business';

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
  const visibleState = pending ? null : state;
  const errs = visibleState?.status === 'invalid' ? visibleState.fieldErrors : {};
  const error = visibleState?.status === 'error' ? visibleState.message : null;
  const success =
    visibleState?.status === 'success'
      ? (visibleState.message ?? '仓库已创建')
      : null;
  const summaryErrors = toWarehouseErrorSummary(errs);

  return (
    <form
      id="warehouse-create-form"
      action={formAction}
      onReset={(event) => event.preventDefault()}
      aria-busy={pending}
      className="space-y-4 rounded-xl border bg-card p-6 shadow-sm"
    >
      <h2 className="text-base font-semibold">新增仓库</h2>
      <FormErrorSummary errors={summaryErrors} />
      <TextField
        id="warehouse-name"
        name="name"
        label="仓库名称"
        error={errs.name?.[0]}
        disabled={pending}
      />
      <Disclosure className="rounded-lg border border-dashed p-3" open={Boolean(errs.code?.[0])}>
        <DisclosureSummary className="text-muted-foreground">
          高级设置：自定义仓库编码（通常无需填写）
        </DisclosureSummary>
        <div className="mt-3">
          <TextField
            id="warehouse-code"
            name="code"
            label="自定义编码（选填）"
            hint="留空将自动生成，例如 WH-000001。"
            error={errs.code?.[0]}
            disabled={pending}
          />
        </div>
      </Disclosure>
      {error ? (
        <ActionNotice
          tone="error"
          title="仓库创建失败"
          description={error}
        />
      ) : null}
      {success ? <ActionNotice tone="success" title={success} /> : null}
      <PendingButton pending={pending} pendingLabel="正在创建仓库…">
        创建仓库
      </PendingButton>
    </form>
  );
}

function LocationCreateForm({ warehouses }: { warehouses: WarehouseFormOption[] }) {
  const [warehouseId, setWarehouseId] = useState('');
  const [state, formAction, pending] = useActionState<
    WarehouseMutationResult | null,
    FormData
  >(createWarehouseLocationAction, null);
  const visibleState = pending ? null : state;
  const errs = visibleState?.status === 'invalid' ? visibleState.fieldErrors : {};
  const error = visibleState?.status === 'error' ? visibleState.message : null;
  const success =
    visibleState?.status === 'success'
      ? (visibleState.message ?? '库位已创建')
      : null;
  const missingWarehouses = warehouses.length === 0;
  const summaryErrors = toLocationErrorSummary(errs);

  return (
    <form
      id="location-create-form"
      action={formAction}
      onReset={(event) => event.preventDefault()}
      aria-busy={pending}
      className="space-y-4 rounded-xl border bg-card p-6 shadow-sm"
    >
      <h2 className="text-base font-semibold">新增库位</h2>
      <FormErrorSummary errors={summaryErrors} />
      <div className="space-y-2">
        <Label htmlFor="location-warehouse">所属仓库</Label>
        <select
          id="location-warehouse"
          name="warehouseId"
          {...(errs.warehouseId?.[0]
            ? formMessageA11yProps('location-warehouse', 'error')
            : {})}
          className={selectClass}
          disabled={pending || missingWarehouses}
          value={warehouseId}
          onChange={(event) => setWarehouseId(event.target.value)}
        >
          <option value="">请选择仓库</option>
          {warehouseId && !warehouses.some((warehouse) => warehouse.id === warehouseId) ? <option value={warehouseId}>原仓库已停用，请重新选择</option> : null}
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.code} · {warehouse.name}
            </option>
          ))}
        </select>
        {errs.warehouseId?.[0] ? (
          <FormMessage fieldId="location-warehouse" tone="error">
            {errs.warehouseId[0]}
          </FormMessage>
        ) : null}
        {missingWarehouses ? (
          <ActionNotice
            tone="warning"
            title="缺少启用仓库"
            description="请先在左侧创建仓库，再新增库位。"
          />
        ) : null}
      </div>
      <TextField
        id="location-name"
        name="name"
        label="库位名称"
        error={errs.name?.[0]}
        disabled={pending}
      />
      <Disclosure className="rounded-lg border border-dashed p-3" open={Boolean(errs.code?.[0])}>
        <DisclosureSummary className="text-muted-foreground">
          高级设置：自定义库位编码（通常无需填写）
        </DisclosureSummary>
        <div className="mt-3">
          <TextField
            id="location-code"
            name="code"
            label="自定义编码（选填）"
            hint="留空将自动生成，例如 LOC-000001。"
            error={errs.code?.[0]}
            disabled={pending}
          />
        </div>
      </Disclosure>
      {error ? (
        <ActionNotice
          tone="error"
          title="库位创建失败"
          description={error}
        />
      ) : null}
      {success ? <ActionNotice tone="success" title={success} /> : null}
      <PendingButton
        pending={pending}
        pendingLabel="正在创建库位…"
        disabled={missingWarehouses}
      >
        创建库位
      </PendingButton>
    </form>
  );
}

function TextField({
  id,
  name,
  label,
  hint,
  error,
  disabled,
}: {
  id: string;
  name: string;
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
        name={name}
        disabled={disabled}
        {...(error
          ? formMessageA11yProps(id, 'error')
          : hint
            ? formMessageA11yProps(id, 'hint')
            : {})}
      />
      {error ? (
        <FormMessage fieldId={id} tone="error">
          {error}
        </FormMessage>
      ) : hint ? (
        <FormMessage fieldId={id} tone="hint" className="text-xs">
          {hint}
        </FormMessage>
      ) : null}
    </div>
  );
}

function toWarehouseErrorSummary(
  fieldErrors: Record<string, string[]>,
): FormErrorSummaryItem[] {
  const targets: Record<string, { fieldId: string; label: string }> = {
    name: { fieldId: 'warehouse-name', label: '仓库名称' },
    code: { fieldId: 'warehouse-code', label: '仓库编码' },
  };
  return toErrorSummary(fieldErrors, targets, 'warehouse-create-form');
}

function toLocationErrorSummary(
  fieldErrors: Record<string, string[]>,
): FormErrorSummaryItem[] {
  const targets: Record<string, { fieldId: string; label: string }> = {
    warehouseId: { fieldId: 'location-warehouse', label: '所属仓库' },
    name: { fieldId: 'location-name', label: '库位名称' },
    code: { fieldId: 'location-code', label: '库位编码' },
  };
  return toErrorSummary(fieldErrors, targets, 'location-create-form');
}

function toErrorSummary(
  fieldErrors: Record<string, string[]>,
  targets: Record<string, { fieldId: string; label: string }>,
  fallbackFieldId: string,
): FormErrorSummaryItem[] {
  return Object.entries(fieldErrors).flatMap(([field, messages]) => {
    const target = targets[field] ?? { fieldId: fallbackFieldId, label: field };
    return messages.map((message) => ({ ...target, message }));
  });
}
