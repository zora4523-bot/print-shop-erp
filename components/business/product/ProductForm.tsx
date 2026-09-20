'use client';

import Link from 'next/link';
import { useActionState, useRef } from 'react';
import { buttonVariants } from '@/components/ui/button';
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
import type { ProductMutationResult } from '@/actions/owner-products.types';
import type { ProductCategoryOption } from '@/lib/product';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

type EditInitial = {
  code: string | null;
  categoryNodeId: string;
  name: string;
  specification: string | null;
  paperType: string | null;
};

export type ProductRouteBase = typeof RULE_CENTER_HREFS.stockSkus;

type CommonProps = {
  routeBase?: ProductRouteBase;
  categoryManagementHref?: string;
  identityReadOnly?: boolean;
};

type Props = CommonProps &
  (
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
    }
  );

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const PRODUCT_FIELD_LABELS: Record<string, string> = {
  code: '组合编码',
  categoryNodeId: '分类',
  name: '组合名称',
  specification: '规格',
  paperType: '纸张',
};

export function ProductForm(props: Props) {
  const [state, formAction, pending] = useActionState<ProductMutationResult | null, FormData>(
    props.action,
    null,
  );
  const isCreate = props.mode === 'create';
  const identityReadOnly = !isCreate && props.identityReadOnly;
  const initial = props.mode === 'edit' ? props.initial : undefined;

  const visibleState = pending ? null : state;
  const errs = visibleState?.status === 'invalid' ? visibleState.fieldErrors : {};
  const generalError = visibleState?.status === 'error' ? visibleState.message : null;
  const success = visibleState?.status === 'success';
  const summaryErrors = toProductErrorSummary(errs);
  const missingCategoryNodes = props.categoryNodes.length === 0;
  const defaultCategoryNodeId = initial?.categoryNodeId ?? props.categoryNodes[0]?.id ?? '';
  const routeBase = props.routeBase ?? RULE_CENTER_HREFS.stockSkus;
  const categoryManagementHref =
    props.categoryManagementHref ?? RULE_CENTER_HREFS.productCategories;

  return (
    <form
      action={formAction}
      aria-busy={pending}
      className="space-y-5"
      noValidate
    >
      <FormErrorSummary errors={summaryErrors} />

      {identityReadOnly && initial ? (
        <div className="space-y-3">
          {([
            ['code', '组合编码', initial.code],
            ['categoryNodeId', '产品结构分类', props.categoryNodes.find((node) => node.id === initial.categoryNodeId)?.name],
            ['specification', '规格', initial.specification],
            ['paperType', '纸张', initial.paperType],
          ] as const).map(([key, label, value]) => <div key={key}>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="admin-wrap-anywhere text-sm">{externalPriceBusinessText(value ?? '') || '未填写'}</p>
            <input type="hidden" name={key} value={initial[key] ?? ''} />
          </div>)}
          <Link href="/owner/rules/papers" className="text-sm text-primary underline">到纸张页管理空白封适用规格</Link>
        </div>
      ) : <>
      {isCreate ? (
        <Disclosure
          className="rounded-lg border border-dashed p-3"
          open={Boolean(errs.code?.[0])}
        >
          <DisclosureSummary className="text-muted-foreground">
            自定义组合编码
          </DisclosureSummary>
          <div className="mt-3">
            <TextField
              id="code"
              label="自定义编码（选填）"
              hint="留空将自动生成，例如 PRD-000001。"
              disabled={pending}
              error={errs.code?.[0]}
            />
          </div>
        </Disclosure>
      ) : (
        <TextField
          id="code"
          label="组合编码"
          hint="大小写不敏感。"
          disabled={pending}
          error={errs.code?.[0]}
          defaultValue={initial?.code ?? ''}
        />
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="categoryNodeId">
            产品结构分类
          </Label>
          <Link
            href={`${categoryManagementHref}/new`}
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
                {externalPriceBusinessText(node.name) || '未命名分类'}
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

      </>}

      {initial ? (
        <PreservedBusinessTextField
          id="name"
          label="组合名称"
          fallback="未命名组合"
          required
          disabled={pending}
          error={errs.name?.[0]}
          rawValue={initial.name}
        />
      ) : (
        <TextField
          id="name"
          label="组合名称"
          required
          disabled={pending}
          error={errs.name?.[0]}
        />
      )}

      {!identityReadOnly && <>
      {initial ? (
        <PreservedBusinessTextField
          id="specification"
          label="规格（选填）"
          fallback="未标注规格"
          hint="例如 100×200、中号、方形"
          disabled={pending}
          error={errs.specification?.[0]}
          rawValue={initial.specification ?? ''}
        />
      ) : (
        <TextField
          id="specification"
          label="规格（选填）"
          hint="例如 100×200、中号、方形"
          disabled={pending}
          error={errs.specification?.[0]}
        />
      )}

      {initial ? (
        <PreservedBusinessTextField
          id="paperType"
          label="纸张（选填）"
          fallback="未标注纸张"
          hint="例如 铜版纸、艺术纸"
          disabled={pending}
          error={errs.paperType?.[0]}
          rawValue={initial.paperType ?? ''}
        />
      ) : (
        <TextField
          id="paperType"
          label="纸张（选填）"
          hint="例如 铜版纸、艺术纸"
          disabled={pending}
          error={errs.paperType?.[0]}
        />
      )}

      </>}

      {generalError ? (
        <ActionNotice
          tone="error"
          title="组合保存失败"
          description={generalError}
        />
      ) : null}
      {success ? (
        <ActionNotice tone="success" title="组合已保存" />
      ) : null}

      <div className="flex gap-3">
        <PendingButton
          pending={pending}
          pendingLabel="正在保存组合…"
          disabled={missingCategoryNodes}
        >
          {isCreate ? '创建组合' : '保存修改'}
        </PendingButton>
        <Link href={routeBase} className={buttonVariants({ variant: 'outline' })}>
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

function PreservedBusinessTextField({
  id,
  label,
  hint,
  error,
  rawValue,
  fallback,
  ...inputProps
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  rawValue: string;
  fallback: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const submittedValueRef = useRef<HTMLInputElement>(null);
  const businessValue = externalPriceBusinessText(rawValue);
  const visibleValue = businessValue || (rawValue.trim() ? fallback : '');

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <input
        ref={submittedValueRef}
        type="hidden"
        name={id}
        defaultValue={rawValue}
      />
      <Input
        id={id}
        type="text"
        defaultValue={visibleValue}
        onInput={(event) => {
          if (submittedValueRef.current) {
            submittedValueRef.current.value = event.currentTarget.value;
          }
        }}
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
      label: PRODUCT_FIELD_LABELS[fieldId] ?? '表单内容',
      message,
    })),
  );
}
