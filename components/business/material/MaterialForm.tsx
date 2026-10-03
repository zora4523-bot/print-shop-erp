'use client';

import type { SupplementContext } from '@/lib/form-drafts/model';
import { SupplementFields } from '@/components/business/form-drafts/FormDraftControls';

import { useActionState, useRef } from 'react';
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
import type { MaterialMutationResult } from '@/actions/owner-materials.types';
import type { MaterialSummary } from '@/lib/material';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { NativeSelect } from '@/components/ui/native-select';

export type MaterialRouteBase =
  | '/owner/materials'
  | '/foreman/materials'
  | '/owner/rules/papers';

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

type CommonProps = {
  supplement?: SupplementContext | null;
  categoryScope?: MaterialSummary['category'];
  excludedCategories?: readonly MaterialSummary['category'][];
};

type Props = CommonProps &
  (
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
    }
  );

const CATEGORY_OPTIONS = [
  { value: 'PAPER', label: '纸张' },
  { value: 'FOIL', label: '烫金纸' },
  { value: 'BAG', label: '包装袋' },
  { value: 'FINISHED_STOCK', label: '成品库存' },
  { value: 'OTHER', label: '其他' },
] as const;


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
  const selectableCategories = CATEGORY_OPTIONS.filter(
    (option) => !props.excludedCategories?.includes(option.value),
  );

  return (
    <form
      action={formAction}
      onReset={(event) => event.preventDefault()}
      aria-busy={pending}
      className="space-y-5"
      noValidate
    >
      <SupplementFields context={props.supplement} />
      <input type="hidden" name="routeBase" value={props.routeBase} />

      <FormErrorSummary errors={summaryErrors} />

      {isCreate ? (
        <Disclosure
          className="rounded-lg border border-dashed p-3"
          open={Boolean(errs.code?.[0])}
        >
          <DisclosureSummary className="text-muted-foreground">
            自定义物料编码
          </DisclosureSummary>
          <div className="mt-3">
            <TextField
              id="code"
              label="自定义编码（选填）"
              hint="留空将自动生成，例如 MAT-000001。"
              disabled={pending}
              error={errs.code?.[0]}
            />
          </div>
        </Disclosure>
      ) : (
        <TextField
          id="code"
          label="物料编码"
          hint="大小写不敏感。"
          required
          disabled={pending}
          error={errs.code?.[0]}
          defaultValue={initial?.code ?? ''}
        />
      )}

      {initial ? (
        <PreservedBusinessTextField
          id="name"
          label="物料名称"
          fallback={
            props.categoryScope === 'PAPER' ? '未命名纸张' : '未命名物料'
          }
          required
          disabled={pending}
          error={errs.name?.[0]}
          rawValue={initial.name}
        />
      ) : (
        <TextField
          id="name"
          label="物料名称"
          required
          disabled={pending}
          error={errs.name?.[0]}
        />
      )}

      {props.categoryScope ? (
        <div className="space-y-2">
          <Label htmlFor="category">分类</Label>
          <input
            id="category"
            name="category"
            type="hidden"
            value={props.categoryScope}
          />
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            {CATEGORY_OPTIONS.find(
              (option) => option.value === props.categoryScope,
            )?.label ?? '未识别分类'}
          </p>
          {errs.category?.[0] ? (
            <FormMessage fieldId="category" tone="error">
              {errs.category[0]}
            </FormMessage>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="category">分类</Label>
          <NativeSelect
            id="category"
            name="category"
            {...(errs.category?.[0]
              ? formMessageA11yProps('category', 'error')
              : {})}
            defaultValue={
              initial?.category ?? selectableCategories[0]?.value ?? 'OTHER'
            }
            disabled={pending}
          >
            {selectableCategories.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          {errs.category?.[0] ? (
            <FormMessage fieldId="category" tone="error">
              {errs.category[0]}
            </FormMessage>
          ) : null}
        </div>
      )}

      {initial ? (
        <PreservedBusinessTextField
          id="specification"
          label="规格（选填）"
          fallback="未标注规格"
          hint="例如 250g A4、12cm、红色"
          disabled={pending}
          error={errs.specification?.[0]}
          rawValue={initial.specification ?? ''}
        />
      ) : (
        <TextField
          id="specification"
          label="规格（选填）"
          hint="例如 250g A4、12cm、红色"
          disabled={pending}
          error={errs.specification?.[0]}
        />
      )}

      {initial ? (
        <LockedUnitField unit={initial.unit} />
      ) : (
        <TextField
          id="unit"
          label="单位"
          required
          disabled={pending}
          error={errs.unit?.[0]}
          defaultValue="张"
        />
      )}

      <TextField
        id="safetyStock"
        label="安全库存（选填）"
        hint="低于该值时，库存看板会提醒。"
        disabled={pending}
        error={errs.safetyStock?.[0]}
        defaultValue={initial?.safetyStock != null ? String(initial.safetyStock) : ''}
      />

      <TextField
        id="averageCost"
        label="参考平均成本（手工维护，选填）"
        hint="用于库存金额估算；采购入库不会自动更新。"
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
      </div>
    </form>
  );
}

function LockedUnitField({ unit }: { unit: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="unit">单位</Label>
      <input type="hidden" name="unit" value={unit} />
      <Input
        id="unit"
        type="text"
        defaultValue={unit}
        disabled
        {...formMessageA11yProps('unit', 'hint')}
      />
      <FormMessage fieldId="unit" tone="hint" className="text-xs">
        计量单位决定库存与业务数量的含义，物料创建后不能修改。如需使用新单位，请新建物料。
      </FormMessage>
    </div>
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

function toMaterialErrorSummary(
  fieldErrors: Record<string, string[]>,
): FormErrorSummaryItem[] {
  return Object.entries(fieldErrors).flatMap(([fieldId, messages]) =>
    messages.map((message) => ({
      fieldId,
      label: MATERIAL_FIELD_LABELS[fieldId] ?? '表单内容',
      message,
    })),
  );
}
