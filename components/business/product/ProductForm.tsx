'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ProductCategory } from '../../../generated/prisma/enums';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProductMutationResult } from '@/actions/owner-products.types';
import { PRODUCT_CATEGORY_LABELS } from '@/lib/auth/role-labels';

type EditInitial = {
  category: ProductCategory;
  name: string;
  specification: string | null;
  paperType: string | null;
  baseUnitPrice: unknown;
  minOrderQty: number | null;
  isActive: boolean;
};

type Props =
  | {
      mode: 'create';
      action: (
        prev: ProductMutationResult | null,
        fd: FormData,
      ) => Promise<ProductMutationResult>;
    }
  | {
      mode: 'edit';
      action: (
        prev: ProductMutationResult | null,
        fd: FormData,
      ) => Promise<ProductMutationResult>;
      initial: EditInitial;
    };

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const CATEGORY_OPTIONS = [
  ProductCategory.BLANK_STOCK,
  ProductCategory.GENERIC_STOCK,
  ProductCategory.CUSTOM_FLAT_FOIL,
  ProductCategory.COLOR_PRINT,
  ProductCategory.STOCK_FOIL_ADD,
  ProductCategory.BYO_MATERIAL,
] as const;

export function ProductForm(props: Props) {
  const [state, formAction, pending] = useActionState<ProductMutationResult | null, FormData>(
    props.action,
    null,
  );
  const isCreate = props.mode === 'create';
  const initial = props.mode === 'edit' ? props.initial : undefined;

  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success';

  const priceDefault =
    initial?.baseUnitPrice === null || initial?.baseUnitPrice === undefined
      ? ''
      : String(initial.baseUnitPrice);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <div className="space-y-2">
        <Label htmlFor="category">分类</Label>
        <select
          id="category"
          name="category"
          className={selectClass}
          defaultValue={initial?.category ?? CATEGORY_OPTIONS[0]}
          disabled={pending}
        >
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {PRODUCT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        {errs.category?.[0] ? (
          <p className="text-sm text-destructive">{errs.category[0]}</p>
        ) : null}
      </div>

      <TextField
        id="name"
        label="产品名"
        required
        disabled={pending}
        error={errs.name?.[0]}
        defaultValue={initial?.name}
      />

      <TextField
        id="specification"
        label="规格（选填）"
        hint="例如 100×200、中号、方形"
        disabled={pending}
        error={errs.specification?.[0]}
        defaultValue={initial?.specification ?? ''}
      />

      <TextField
        id="paperType"
        label="纸张（选填）"
        hint="例如 铜版纸、艺术纸"
        disabled={pending}
        error={errs.paperType?.[0]}
        defaultValue={initial?.paperType ?? ''}
      />

      <TextField
        id="baseUnitPrice"
        label="建议单价（选填）"
        hint="Decimal(10,4)：整数部分 ≤ 6 位，小数 ≤ 4 位。录单时作为建议价参考，不强制。"
        type="text"
        disabled={pending}
        error={errs.baseUnitPrice?.[0]}
        defaultValue={priceDefault}
      />

      <TextField
        id="minOrderQty"
        label="最小起订量（选填）"
        hint="正整数；空表示不限。"
        type="number"
        min={1}
        step={1}
        disabled={pending}
        error={errs.minOrderQty?.[0]}
        defaultValue={initial?.minOrderQty != null ? String(initial.minOrderQty) : ''}
      />

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-emerald-600">
          ✓ 已保存
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? '提交中…' : isCreate ? '创建产品' : '保存修改'}
        </Button>
        <Link href="/owner/products" className={buttonVariants({ variant: 'outline' })}>
          返回列表
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
  min,
  step,
  ...inputProps
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  type?: string;
  min?: number;
  step?: number;
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
        min={min}
        step={step}
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
