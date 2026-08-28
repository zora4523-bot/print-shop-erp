'use client';

import { useActionState } from 'react';
import { ProductCategory } from '../../../generated/prisma/enums';
import type { ProductCategoryNodeMutationResult } from '@/actions/owner-product-categories.types';
import { Button, buttonVariants } from '@/components/ui/button';
import { PendingLink } from '@/components/ui-business';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PRODUCT_CATEGORY_LABELS } from '@/lib/auth/role-labels';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

type CategoryInitial = {
  name: string;
  legacyCategory: ProductCategory;
  sortOrder: number;
};

// 上级分类选项：label 由页面层按层级缩进好（树内部的 ltree 路径不
// 暴露给用户）。
export type ParentCategoryOption = { id: string; label: string };

export type ProductCategoryRouteBase =
  typeof RULE_CENTER_HREFS.productCategories;

type Props = {
  routeBase?: ProductCategoryRouteBase;
} &
  (
    | {
      mode: 'create';
      action: (
        prev: ProductCategoryNodeMutationResult | null,
        fd: FormData,
      ) => Promise<ProductCategoryNodeMutationResult>;
      parentOptions: ParentCategoryOption[];
    }
  | {
      mode: 'edit';
      action: (
        prev: ProductCategoryNodeMutationResult | null,
        fd: FormData,
      ) => Promise<ProductCategoryNodeMutationResult>;
      initial: CategoryInitial;
      }
  );

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const RETIRED_PRODUCT_CATEGORIES: ReadonlySet<ProductCategory> = new Set([
  ProductCategory.GENERIC_STOCK,
  ProductCategory.STOCK_FOIL_ADD,
  ProductCategory.BYO_MATERIAL,
]);

export function ProductCategoryForm(props: Props) {
  const [state, formAction, pending] = useActionState<
    ProductCategoryNodeMutationResult | null,
    FormData
  >(props.action, null);

  const initial = props.mode === 'edit' ? props.initial : undefined;
  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success';
  const routeBase = props.routeBase ?? RULE_CENTER_HREFS.productCategories;
  const categoryOptions = Object.values(ProductCategory).filter(
    (category) =>
      !RETIRED_PRODUCT_CATEGORIES.has(category) ||
      category === initial?.legacyCategory,
  );

  return (
    <form action={formAction} aria-busy={pending} className="space-y-5" noValidate>
      {props.mode === 'create' ? (
        <div className="space-y-2">
          <Label htmlFor="parentId">上级分类</Label>
          <select
            id="parentId"
            name="parentId"
            className={selectClass}
            defaultValue=""
            disabled={pending}
          >
            <option value="">（顶级分类）</option>
            {props.parentOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            不选则创建为顶级分类；层级创建后不可移动。
          </p>
          {errs.parentId?.[0] ? (
            <p className="text-sm text-destructive">{errs.parentId[0]}</p>
          ) : null}
        </div>
      ) : null}

      <TextField
        id="name"
        label="分类名"
        required
        disabled={pending}
        error={errs.name?.[0]}
        defaultValue={initial?.name ?? ''}
      />

      <div className="space-y-2">
        <Label htmlFor="legacyCategory">适用计价方式</Label>
        <select
          id="legacyCategory"
          name="legacyCategory"
          className={selectClass}
          defaultValue={initial?.legacyCategory ?? ProductCategory.BLANK_STOCK}
          disabled={pending}
        >
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {PRODUCT_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        {errs.legacyCategory?.[0] ? (
          <p className="text-sm text-destructive">{errs.legacyCategory[0]}</p>
        ) : null}
      </div>

      <TextField
        id="sortOrder"
        label="排序"
        hint="正整数。"
        type="number"
        min={1}
        step={1}
        required
        disabled={pending}
        error={errs.sortOrder?.[0]}
        defaultValue={initial ? String(initial.sortOrder) : '10'}
      />

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
        <Button type="submit" disabled={pending}>
          {pending ? '提交中…' : props.mode === 'create' ? '创建分类' : '保存修改'}
        </Button>
        <PendingLink
          href={routeBase}
          pending={pending}
          className={buttonVariants({ variant: 'outline' })}
        >
          返回列表
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
