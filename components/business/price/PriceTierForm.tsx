'use client';

import { useActionState } from 'react';
import type { PriceMutationResult } from '@/actions/owner-prices.types';
import { Button, buttonVariants } from '@/components/ui/button';
import { PendingLink } from '@/components/ui-business';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProductOption } from '@/lib/product';

type PriceTierInitial = {
  productId: string;
  minQty: string;
  unitPrice: string;
  effectiveFrom: string;
  effectiveTo: string;
};

type Props =
  | {
      mode: 'create';
      action: (
        prev: PriceMutationResult | null,
        fd: FormData,
      ) => Promise<PriceMutationResult>;
      products: ProductOption[];
    }
  | {
      mode: 'edit';
      action: (
        prev: PriceMutationResult | null,
        fd: FormData,
      ) => Promise<PriceMutationResult>;
      initial: PriceTierInitial;
      products: ProductOption[];
    };

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

function productLabel(product: ProductOption): string {
  const code = product.code ? `${product.code} · ` : '';
  const inactive = product.isActive ? '' : '（已停用）';
  return `${code}${product.name} · ${product.categoryNode.name}${inactive}`;
}

export function PriceTierForm(props: Props) {
  const [state, formAction, pending] = useActionState<
    PriceMutationResult | null,
    FormData
  >(props.action, null);

  const initial = props.mode === 'edit' ? props.initial : undefined;
  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success';
  const missingProducts = props.products.length === 0;
  const defaultProductId = initial?.productId ?? props.products[0]?.id ?? '';

  return (
    <form action={formAction} aria-busy={pending} className="space-y-5" noValidate>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="productId">产品</Label>
          <PendingLink
            href="/owner/products/new"
            pending={pending}
            className="text-xs text-primary hover:underline"
          >
            新建产品
          </PendingLink>
        </div>
        <select
          id="productId"
          name="productId"
          className={selectClass}
          defaultValue={defaultProductId}
          disabled={pending || missingProducts}
        >
          {missingProducts ? <option value="">暂无可用产品</option> : null}
          {props.products.map((product) => (
            <option key={product.id} value={product.id}>
              {productLabel(product)}
            </option>
          ))}
        </select>
        {errs.productId?.[0] ? (
          <p className="text-sm text-destructive">{errs.productId[0]}</p>
        ) : null}
        {missingProducts ? (
          <p className="text-sm text-muted-foreground">
            请先创建并启用至少一个产品，再维护价格阶梯。
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          id="minQty"
          label="起订量"
          type="number"
          min={1}
          step={1}
          required
          disabled={pending}
          error={errs.minQty?.[0]}
          defaultValue={initial?.minQty ?? '1'}
        />
        <TextField
          id="unitPrice"
          label="单价"
          hint="最多 6 位整数、4 位小数。"
          required
          disabled={pending}
          error={errs.unitPrice?.[0]}
          defaultValue={initial?.unitPrice ?? ''}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          id="effectiveFrom"
          label="有效起始日期"
          type="date"
          required
          disabled={pending}
          error={errs.effectiveFrom?.[0]}
          defaultValue={initial?.effectiveFrom ?? ''}
        />
        <TextField
          id="effectiveTo"
          label="有效截止日期（不含）"
          type="date"
          disabled={pending}
          error={errs.effectiveTo?.[0]}
          defaultValue={initial?.effectiveTo ?? ''}
        />
      </div>

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success-foreground">
          ✓ 已保存
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending || missingProducts}>
          {pending ? '提交中…' : props.mode === 'create' ? '创建价格阶梯' : '保存修改'}
        </Button>
        <PendingLink
          href="/owner/prices"
          pending={pending}
          className={buttonVariants({ variant: 'outline' })}
        >
          返回报价管理
        </PendingLink>
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
