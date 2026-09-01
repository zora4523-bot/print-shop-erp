'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateOrderAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';

// E-lean edit form. Single status-agnostic component; the `fieldset`
// prop controls which fields are enabled. No RHF (no array), no Zod on
// the client — FormData + server-side validation is enough here, and
// a plain form gives zero-JS fallback for free.

export type EditableFieldset = 'FULL' | 'SHIPPING_ONLY';

export type EditOrderInitialValues = {
  customName: string | null;
  customerRef: string | null;
  receiverAddress: string | null;
  expressCode: string | null;
  packageRequirement: string | null;
  remark: string | null;
  // YYYY-MM-DD（页面层从 Date 转好）
  promisedDate: string | null;
  isUrgent: boolean;
};

type Props = {
  orderId: string;
  expectedEditVersion: number;
  fieldset: EditableFieldset;
  initial: EditOrderInitialValues;
};

const FULL_ONLY_FIELDS: ReadonlySet<string> = new Set([
  'customName',
  'customerRef',
  'isUrgent',
]);

export function EditOrderForm({
  orderId,
  expectedEditVersion,
  fieldset,
  initial,
}: Props) {
  const boundAction = updateOrderAction.bind(null, orderId);
  const [state, formAction, pending] = useActionState<
    OrderMutationResult | null,
    FormData
  >(boundAction, null);

  const isShippingOnly = fieldset === 'SHIPPING_ONLY';

  return (
    <form action={formAction} aria-busy={pending} className="space-y-6">
      <input
        type="hidden"
        name="expectedEditVersion"
        value={expectedEditVersion}
      />
      {isShippingOnly && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
          工单已进入排产 / 生产，仅可修改收货信息与备注。
        </div>
      )}

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">基本信息</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            name="customName"
            label="工单名称"
            full
            disabled={
              pending ||
              (FULL_ONLY_FIELDS.has('customName') && isShippingOnly)
            }
            initial={initial.customName}
            errors={fieldErrors(state, 'customName')}
          />
          <Field
            name="customerRef"
            label="客户名称/简称（选填）"
            disabled={
              pending ||
              (FULL_ONLY_FIELDS.has('customerRef') && isShippingOnly)
            }
            initial={initial.customerRef}
            errors={fieldErrors(state, 'customerRef')}
          />
          <Field
            name="expressCode"
            label="快递代码"
            disabled={pending}
            initial={initial.expressCode}
            errors={fieldErrors(state, 'expressCode')}
          />
          <Field
            name="receiverAddress"
            label="收货信息"
            full
            multiline
            required
            disabled={pending}
            initial={initial.receiverAddress}
            errors={fieldErrors(state, 'receiverAddress')}
          />
          <Field
            name="packageRequirement"
            label="包装要求"
            full
            disabled={pending}
            initial={initial.packageRequirement}
            errors={fieldErrors(state, 'packageRequirement')}
          />
          <Field
            name="remark"
            label="工单备注"
            full
            multiline
            disabled={pending}
            initial={initial.remark}
            errors={fieldErrors(state, 'remark')}
          />
          {!isShippingOnly && (
            <Field
              name="promisedDate"
              label="承诺交期"
              type="date"
              disabled={pending}
              initial={initial.promisedDate}
              errors={fieldErrors(state, 'promisedDate')}
            />
          )}
          {!isShippingOnly && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 sm:col-span-2 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
              <Checkbox
                id="isUrgent"
                name="isUrgent"
                value="on"
                defaultChecked={initial.isUrgent}
                disabled={pending}
                aria-label="标记为急单"
              />
              <span className="text-sm">标记为急单</span>
              <input type="hidden" name="isUrgent" value="false" />
            </label>
          )}
        </div>
      </section>

      {state?.status === 'error' && (
        <p role="alert" className="text-sm text-destructive">{state.message}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? '保存中…' : '保存'}
        </Button>
        <Link
          href={`/orders/${orderId}`}
          className={buttonVariants({ variant: 'outline' })}
        >
          取消
        </Link>
      </div>
    </form>
  );
}

function fieldErrors(state: OrderMutationResult | null, name: string): string[] {
  if (!state || state.status !== 'invalid') return [];
  return state.fieldErrors[name] ?? [];
}

function Field({
  name,
  label,
  initial,
  errors,
  full,
  multiline,
  required,
  disabled,
  type = 'text',
}: {
  name: string;
  label: string;
  initial: string | null;
  errors: string[];
  full?: boolean;
  multiline?: boolean;
  required?: boolean;
  disabled?: boolean;
  type?: string;
}) {
  const hasError = errors.length > 0;
  const errorId = `${name}-error`;
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <Label htmlFor={name} className="text-sm text-muted-foreground">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </Label>
      {multiline ? (
        <textarea
          id={name}
          name={name}
          disabled={disabled}
          required={required}
          aria-required={required ? true : undefined}
          defaultValue={initial ?? ''}
          aria-invalid={hasError}
          aria-describedby={hasError ? errorId : undefined}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
          rows={3}
        />
      ) : (
        <Input
          id={name}
          name={name}
          type={type}
          disabled={disabled}
          required={required}
          aria-required={required ? true : undefined}
          defaultValue={initial ?? ''}
          aria-invalid={hasError}
          aria-describedby={hasError ? errorId : undefined}
          className="mt-1"
        />
      )}
      {hasError && (
        // 不用 role="alert"：逐字段错误靠 aria-describedby 与控件关联，
        // 用户聚焦到该字段时读屏器自然读出来。标 alert 会在每次校验时
        // 抢播报。
        <p id={errorId} className="mt-1 text-xs text-destructive">
          {errors[0]}
        </p>
      )}
    </div>
  );
}
