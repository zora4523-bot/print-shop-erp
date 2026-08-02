'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MaterialMutationResult } from '@/actions/owner-materials.types';
import type { MaterialSummary } from '@/lib/material';

type MaterialRouteBase = '/owner/materials' | '/foreman/materials';

type EditInitial = Pick<
  MaterialSummary,
  | 'code'
  | 'name'
  | 'category'
  | 'specification'
  | 'unit'
> & {
  safetyStock: string | null;
  averageCost: string | null;
};

type Props =
  | {
      mode: 'create';
      action: (
        prev: MaterialMutationResult | null,
        fd: FormData,
      ) => Promise<MaterialMutationResult>;
      routeBase: MaterialRouteBase;
    }
  | {
      mode: 'edit';
      action: (
        prev: MaterialMutationResult | null,
        fd: FormData,
      ) => Promise<MaterialMutationResult>;
      initial: EditInitial;
      routeBase: MaterialRouteBase;
    };

const CATEGORY_OPTIONS = [
  { value: 'PAPER', label: '纸张' },
  { value: 'FOIL', label: '烫金纸' },
  { value: 'BAG', label: '包装袋' },
  { value: 'FINISHED_STOCK', label: '成品库存' },
  { value: 'OTHER', label: '其他' },
] as const;

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function MaterialForm(props: Props) {
  const [state, formAction, pending] = useActionState<
    MaterialMutationResult | null,
    FormData
  >(props.action, null);

  const isCreate = props.mode === 'create';
  const initial = props.mode === 'edit' ? props.initial : undefined;
  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success';

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="routeBase" value={props.routeBase} />

      {isCreate ? (
        <details
          className="rounded-lg border border-dashed p-3"
          open={Boolean(errs.code?.[0])}
        >
          <summary className="cursor-pointer text-sm text-muted-foreground">
            高级设置：自定义物料编码（通常无需填写）
          </summary>
          <div className="mt-3">
            <TextField
              id="code"
              label="自定义编码（选填）"
              hint="留空将自动生成，例如 MAT-000001。"
              disabled={pending}
              error={errs.code?.[0]}
            />
          </div>
        </details>
      ) : (
        <TextField
          id="code"
          label="物料编码"
          hint="大小写不敏感；修改前请确认对库存对接的影响。"
          required
          disabled={pending}
          error={errs.code?.[0]}
          defaultValue={initial?.code ?? ''}
        />
      )}

      <TextField
        id="name"
        label="物料名称"
        required
        disabled={pending}
        error={errs.name?.[0]}
        defaultValue={initial?.name ?? ''}
      />

      <div className="space-y-2">
        <Label htmlFor="category">分类</Label>
        <select
          id="category"
          name="category"
          className={selectClass}
          defaultValue={initial?.category ?? 'PAPER'}
          disabled={pending}
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {errs.category?.[0] ? (
          <p className="text-sm text-destructive">{errs.category[0]}</p>
        ) : null}
      </div>

      <TextField
        id="specification"
        label="规格（选填）"
        hint="例如 250g A4、12cm、红色"
        disabled={pending}
        error={errs.specification?.[0]}
        defaultValue={initial?.specification ?? ''}
      />

      <TextField
        id="unit"
        label="单位"
        required
        disabled={pending}
        error={errs.unit?.[0]}
        defaultValue={initial?.unit ?? '张'}
      />

      <TextField
        id="safetyStock"
        label="安全库存（选填）"
        hint="Decimal(12,2)，低于该值会在库存看板提示。"
        disabled={pending}
        error={errs.safetyStock?.[0]}
        defaultValue={initial?.safetyStock != null ? String(initial.safetyStock) : ''}
      />

      <TextField
        id="averageCost"
        label="参考平均成本（手工维护，选填）"
        hint="Decimal(10,4)，仅用于库存金额估算；采购入库不会自动改写。"
        disabled={pending}
        error={errs.averageCost?.[0]}
        defaultValue={initial?.averageCost != null ? String(initial.averageCost) : ''}
      />

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
          {pending ? '提交中…' : isCreate ? '创建物料' : '保存修改'}
        </Button>
        <Link href={props.routeBase} className={buttonVariants({ variant: 'outline' })}>
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
