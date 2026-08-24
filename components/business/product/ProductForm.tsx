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
import type { ProductMutationResult } from '@/actions/owner-products.types';
import type { ProductCategoryOption } from '@/lib/product';

type EditInitial = {
  code: string | null;
  categoryNodeId: string;
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
      categoryNodes: ProductCategoryOption[];
    }
  | {
      mode: 'edit';
      action: (
        prev: ProductMutationResult | null,
        fd: FormData,
      ) => Promise<ProductMutationResult>;
      initial: EditInitial;
      categoryNodes: ProductCategoryOption[];
    };

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const PRODUCT_FIELD_LABELS: Record<string, string> = {
  code: '产品编码',
  categoryNodeId: '分类',
  name: '产品名',
  specification: '规格',
  paperType: '纸张',
  baseUnitPrice: '内部销售/工厂直单基础单价',
  minOrderQty: '最小起订量',
};

export function ProductForm(props: Props) {
  const [state, formAction, pending] = useActionState<ProductMutationResult | null, FormData>(
    props.action,
    null,
  );
  const isCreate = props.mode === 'create';
  const initial = props.mode === 'edit' ? props.initial : undefined;

  const visibleState = pending ? null : state;
  const errs = visibleState?.status === 'invalid' ? visibleState.fieldErrors : {};
  const generalError = visibleState?.status === 'error' ? visibleState.message : null;
  const success = visibleState?.status === 'success';
  const summaryErrors = toProductErrorSummary(errs);
  const missingCategoryNodes = props.categoryNodes.length === 0;
  const defaultCategoryNodeId = initial?.categoryNodeId ?? props.categoryNodes[0]?.id ?? '';

  const priceDefault =
    initial?.baseUnitPrice === null || initial?.baseUnitPrice === undefined
      ? ''
      : String(initial.baseUnitPrice);

  return (
    <form
      action={formAction}
      aria-busy={pending}
      className="space-y-5"
      noValidate
    >
      <FormErrorSummary errors={summaryErrors} />

      {isCreate ? (
        <details
          className="rounded-lg border border-dashed p-3"
          open={Boolean(errs.code?.[0])}
        >
          <summary className="cursor-pointer text-sm text-muted-foreground">
            高级设置：自定义产品编码（通常无需填写）
          </summary>
          <div className="mt-3">
            <TextField
              id="code"
              label="自定义编码（选填）"
              hint="留空将自动生成，例如 PRD-000001。"
              disabled={pending}
              error={errs.code?.[0]}
            />
          </div>
        </details>
      ) : (
        <TextField
          id="code"
          label="产品编码"
          hint="用于内部 SKU / 快速搜索；大小写不敏感。"
          disabled={pending}
          error={errs.code?.[0]}
          defaultValue={initial?.code ?? ''}
        />
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="categoryNodeId">分类</Label>
          <Link
            href="/owner/product-categories/new"
            className="text-xs text-primary hover:underline"
          >
            新建分类
          </Link>
        </div>
        <select
          id="categoryNodeId"
          name="categoryNodeId"
          {...(errs.categoryNodeId?.[0]
            ? formMessageA11yProps('categoryNodeId', 'error')
            : {})}
          className={selectClass}
          defaultValue={defaultCategoryNodeId}
          disabled={pending || missingCategoryNodes}
        >
          {props.categoryNodes.map((node) => {
            const depth = Math.max(0, node.path.split('.').length - 2);
            const prefix = depth > 0 ? `${'· '.repeat(depth)}` : '';
            return (
              <option key={node.id} value={node.id}>
                {prefix}
                {node.name}
                {node.isActive ? '' : '（已停用）'}
              </option>
            );
          })}
        </select>
        {errs.categoryNodeId?.[0] ? (
          <FormMessage fieldId="categoryNodeId" tone="error">
            {errs.categoryNodeId[0]}
          </FormMessage>
        ) : null}
        {missingCategoryNodes ? (
          <ActionNotice
            tone="warning"
            title="缺少可用产品分类"
            description="请先创建并启用分类，再保存产品。"
          />
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
        label="内部销售/工厂直单基础单价（选填）"
        hint="最多 6 位整数、4 位小数。仅在内部销售或工厂直单没有适用阶梯价时使用；外部销售不读取此价格。"
        type="text"
        disabled={pending}
        error={errs.baseUnitPrice?.[0]}
        defaultValue={priceDefault}
      />

      <TextField
        id="minOrderQty"
        label="最小起订量（选填）"
        hint="正整数；空表示不限。低于起订量时不自动报价，特殊单需手工填价并说明原因。"
        type="number"
        min={1}
        step={1}
        disabled={pending}
        error={errs.minOrderQty?.[0]}
        defaultValue={initial?.minOrderQty != null ? String(initial.minOrderQty) : ''}
      />

      {generalError ? (
        <ActionNotice
          tone="error"
          title="产品保存失败"
          description={generalError}
        />
      ) : null}
      {success ? (
        <ActionNotice tone="success" title="产品已保存" />
      ) : null}

      <div className="flex gap-3">
        <PendingButton
          pending={pending}
          pendingLabel="正在保存产品…"
          disabled={missingCategoryNodes}
        >
          {isCreate ? '创建产品' : '保存修改'}
        </PendingButton>
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

function toProductErrorSummary(
  fieldErrors: Record<string, string[]>,
): FormErrorSummaryItem[] {
  return Object.entries(fieldErrors).flatMap(([fieldId, messages]) =>
    messages.map((message) => ({
      fieldId,
      label: PRODUCT_FIELD_LABELS[fieldId] ?? fieldId,
      message,
    })),
  );
}
