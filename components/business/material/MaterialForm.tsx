'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { buttonVariants } from '@/components/ui/button';
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

const MATERIAL_FIELD_LABELS: Record<string, string> = {
  code: '物料编码',
  name: '物料名称',
  category: '分类',
  specification: '规格',
  unit: '单位',
  safetyStock: '安全库存',
  averageCost: '参考平均成本',
};

export function MaterialForm(props: Props) {
  const [state, formAction, pending] = useActionState<
    MaterialMutationResult | null,
    FormData
  >(props.action, null);

  const isCreate = props.mode === 'create';
  const initial = props.mode === 'edit' ? props.initial : undefined;
  // 提交中的旧结果先卸载，确保连续两次相同结果仍会作为新的 live region
  // 播报，也不会让已失效的字段错误继续关联输入。
  const visibleState = pending ? null : state;
  const errs = visibleState?.status === 'invalid' ? visibleState.fieldErrors : {};
  const generalError = visibleState?.status === 'error' ? visibleState.message : null;
  const success = visibleState?.status === 'success';
  const summaryErrors = toMaterialErrorSummary(errs);

  return (
    <form
      action={formAction}
      aria-busy={pending}
      className="space-y-5"
      noValidate
    >
      <input type="hidden" name="routeBase" value={props.routeBase} />

      <FormErrorSummary errors={summaryErrors} />

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
          {...(errs.category?.[0]
            ? formMessageA11yProps('category', 'error')
            : {})}
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
          <FormMessage fieldId="category" tone="error">
            {errs.category[0]}
          </FormMessage>
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
        <ActionNotice
          tone="error"
          title="物料保存失败"
          description={generalError}
        />
      ) : null}
      {success ? (
        <ActionNotice tone="success" title="物料已保存" />
      ) : null}

      <div className="flex flex-wrap gap-3">
        <PendingButton pending={pending} pendingLabel="正在保存物料…">
          {isCreate ? '创建物料' : '保存修改'}
        </PendingButton>
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
        {...(error
          ? formMessageA11yProps(id, 'error')
          : hint
            ? formMessageA11yProps(id, 'hint')
            : {})}
        {...inputProps}
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

function toMaterialErrorSummary(
  fieldErrors: Record<string, string[]>,
): FormErrorSummaryItem[] {
  return Object.entries(fieldErrors).flatMap(([fieldId, messages]) =>
    messages.map((message) => ({
      fieldId,
      label: MATERIAL_FIELD_LABELS[fieldId] ?? fieldId,
      message,
    })),
  );
}
