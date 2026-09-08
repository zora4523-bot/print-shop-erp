'use client';

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  ActionNotice,
  ConfirmActionController, ConfirmActionDialog,
  FormErrorSummary,
  FormMessage,
  formMessageA11yProps,
  type FormErrorSummaryItem,
} from '@/components/ui-business';
import type { MaterialMutationResult } from '@/actions/owner-materials.types';
import type { WarehouseLocationOption } from '@/lib/warehouse';
import { TX_REASON_OPTIONS } from '@/lib/material-labels';

type Props = {
  action: (
    prev: MaterialMutationResult | null,
    fd: FormData,
  ) => Promise<MaterialMutationResult>;
  unit: string;
  locationOptions: WarehouseLocationOption[];
};

export type StockTransactionPreview = {
  direction: 'IN' | 'OUT';
  locationLabel: string;
  quantity: string;
  unit: string;
  unitCost: string;
  reasonLabel: string;
};

export function stockTransactionImpactItems(
  preview: StockTransactionPreview,
): string[] {
  return [
    `方向：${preview.direction === 'IN' ? '入库' : '出库'}`,
    '物料：当前详情页物料',
    `库位：${preview.locationLabel}`,
    `数量：${preview.quantity} ${preview.unit}`,
    `单位成本：${preview.unitCost || '未填写'}`,
    `原因：${preview.reasonLabel}`,
    '系统会写入一条库存流水，并同步更新该库位与物料汇总库存；提交时会再次校验库位和库存。',
  ];
}

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const STOCK_TRANSACTION_FIELDS: Record<
  string,
  { fieldId: string; label: string }
> = {
  materialId: { fieldId: 'stock-transaction-form', label: '物料' },
  direction: { fieldId: 'direction', label: '方向' },
  quantity: { fieldId: 'quantity', label: '数量' },
  locationId: { fieldId: 'locationId', label: '库位' },
  reasonType: { fieldId: 'reasonType', label: '原因' },
  unitCost: { fieldId: 'unitCost', label: '单位成本' },
  remark: { fieldId: 'remark', label: '备注' },
};

export function StockTransactionForm({ action, unit, locationOptions }: Props) {
  const [state, formAction, pending] = useActionState<
    MaterialMutationResult | null,
    FormData
  >(action, null);
  const visibleState = pending ? null : state;
  const errs = visibleState?.status === 'invalid' ? visibleState.fieldErrors : {};
  const generalError =
    visibleState?.status === 'error' ? visibleState.message : null;
  const success =
    visibleState?.status === 'success'
      ? (visibleState.message ?? '库存已更新')
      : null;
  const summaryErrors = toStockTransactionErrorSummary(errs);
  // 外层不再用 key 强制重挂载（那会连成功提示一起清掉），改成成功后
  // 只 reset 原生表单字段，useActionState 的 state 得以保留并渲染。
  const formRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmedRef = useRef(false);
  const formId = 'stock-transaction-form';
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [preview, setPreview] = useState<StockTransactionPreview | null>(null);
  useEffect(() => {
    if (state?.status === 'success') formRef.current?.reset();
  }, [state]);
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [reasonType, setReasonType] = useState<'PRODUCTION_USE' | 'RETURN' | 'OTHER'>('RETURN');
  const reasonOptions = TX_REASON_OPTIONS.filter((option) =>
    direction === 'IN'
      ? option.value === 'RETURN' || option.value === 'OTHER'
      : option.value === 'PRODUCTION_USE' || option.value === 'OTHER',
  );

  function prepareConfirmation() {
    const form = formRef.current;
    if (!form) return;

    const quantityInput = form.elements.namedItem('quantity');
    const unitCostInput = form.elements.namedItem('unitCost');
    if (
      !(quantityInput instanceof HTMLInputElement) ||
      !(unitCostInput instanceof HTMLInputElement)
    ) {
      return;
    }

    setPositiveQuantityValidity(quantityInput);
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const nextDirection =
      formData.get('direction') === 'OUT' ? ('OUT' as const) : ('IN' as const);
    const nextReason = String(formData.get('reasonType') ?? '');
    setPreview({
      direction: nextDirection,
      locationLabel: stockLocationLabel(
        String(formData.get('locationId') ?? ''),
        locationOptions,
      ),
      quantity: String(formData.get('quantity') ?? '').trim(),
      unit,
      unitCost: String(formData.get('unitCost') ?? '').trim(),
      reasonLabel:
        TX_REASON_OPTIONS.find((option) => option.value === nextReason)?.label ??
        nextReason,
    });
    setConfirmationOpen(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }
    // Enter、requestSubmit() 与普通提交都必须先进入同一个 L2 确认层。
    event.preventDefault();
    prepareConfirmation();
  }

  return (
    <form
      id={formId}
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      onInvalidCapture={() => {
        // 若确认后浏览器原生校验阻止 submit，立即销毁一次性放行令牌。
        confirmedRef.current = false;
      }}
      aria-busy={pending}
      data-risk-level="L2"
      className="space-y-4"
    >
      <FormErrorSummary errors={summaryErrors} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="direction">方向</Label>
          <select
            id="direction"
            name="direction"
            {...(errs.direction?.[0]
              ? formMessageA11yProps('direction', 'error')
              : {})}
            className={selectClass}
            value={direction}
            onChange={(event) => {
              const next = event.target.value === 'OUT' ? 'OUT' : 'IN';
              setDirection(next);
              setReasonType(next === 'IN' ? 'RETURN' : 'PRODUCTION_USE');
            }}
            disabled={pending}
          >
            <option value="IN">入库</option>
            <option value="OUT">出库</option>
          </select>
          {errs.direction?.[0] ? (
            <FormMessage fieldId="direction" tone="error">
              {errs.direction[0]}
            </FormMessage>
          ) : null}
        </div>
        <TextField
          id="quantity"
          label={`数量（${unit}）`}
          required
          pattern="\d{1,10}(\.\d{1,2})?"
          maxLength={13}
          disabled={pending}
          error={errs.quantity?.[0]}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="locationId">库位</Label>
        <select
          id="locationId"
          name="locationId"
          {...(errs.locationId?.[0]
            ? formMessageA11yProps('locationId', 'error')
            : {})}
          className={selectClass}
          defaultValue=""
          disabled={pending}
        >
          <option value="">默认库位</option>
          {locationOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.warehouseName} / {option.name}
              {option.isDefault ? '（默认）' : ''}
            </option>
          ))}
        </select>
        {errs.locationId?.[0] ? (
          <FormMessage fieldId="locationId" tone="error">
            {errs.locationId[0]}
          </FormMessage>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="reasonType">原因</Label>
          <select
            id="reasonType"
            name="reasonType"
            {...(errs.reasonType?.[0]
              ? formMessageA11yProps('reasonType', 'error')
              : {})}
            className={selectClass}
            value={reasonType}
            onChange={(event) =>
              setReasonType(event.target.value as typeof reasonType)
            }
            disabled={pending}
          >
            {reasonOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {errs.reasonType?.[0] ? (
            <FormMessage fieldId="reasonType" tone="error">
              {errs.reasonType[0]}
            </FormMessage>
          ) : null}
        </div>
        <TextField
          id="unitCost"
          label="单位成本（选填）"
          hint="每单位进价，如 0.12；入库时建议填写。"
          pattern="\d{1,6}(\.\d{1,4})?"
          maxLength={11}
          disabled={pending}
          error={errs.unitCost?.[0]}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="remark">备注（选填）</Label>
        <textarea
          id="remark"
          name="remark"
          rows={3}
          maxLength={500}
          disabled={pending}
          {...(errs.remark?.[0]
            ? formMessageA11yProps('remark', 'error')
            : {})}
          className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {errs.remark?.[0] ? (
          <FormMessage fieldId="remark" tone="error">
            {errs.remark[0]}
          </FormMessage>
        ) : null}
      </div>

      {generalError ? (
        <ActionNotice
          tone="error"
          title="库存更新失败"
          description={generalError}
        />
      ) : null}
      {success ? (
        <ActionNotice tone="success" title={success} />
      ) : null}

      <Button
        ref={triggerRef}
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="min-h-11"
      >
        {pending ? '正在更新库存…' : '核对并提交出入库'}
      </Button>
      <ConfirmActionController level="L2"
        formId={formId}
        open={confirmationOpen}
        onOpenChange={setConfirmationOpen}
        focusReturnRef={triggerRef}
        disabled={pending || preview === null}
        onConfirm={() => {
          confirmedRef.current = true;
        }}>
        <ConfirmActionDialog action={`确认${preview?.direction === 'OUT' ? '出库' : '入库'}？`} changes={[]} consequences={preview ? stockTransactionImpactItems(preview) : []} confirmText="确认提交出入库" />
      </ConfirmActionController>
    </form>
  );
}

function TextField({
  id,
  label,
  hint,
  error,
  defaultValue,
  disabled,
  required,
  pattern,
  maxLength,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  defaultValue?: string;
  disabled?: boolean;
  required?: boolean;
  pattern?: string;
  maxLength?: number;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        defaultValue={defaultValue}
        inputMode="decimal"
        required={required}
        pattern={pattern}
        maxLength={maxLength}
        onInput={(event) => event.currentTarget.setCustomValidity('')}
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

function setPositiveQuantityValidity(input: HTMLInputElement) {
  input.setCustomValidity('');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(input.value.trim())) return;
  if (Number(input.value) <= 0) input.setCustomValidity('数量必须大于 0');
}

function stockLocationLabel(
  locationId: string,
  options: readonly WarehouseLocationOption[],
): string {
  const location = locationId
    ? options.find((option) => option.id === locationId)
    : options.find((option) => option.isDefault);
  if (!location) return locationId ? `库位 ${locationId}` : '系统默认库位';
  return `${location.warehouseName} / ${location.name}${location.isDefault ? '（默认）' : ''}`;
}

function toStockTransactionErrorSummary(
  fieldErrors: Record<string, string[]>,
): FormErrorSummaryItem[] {
  return Object.entries(fieldErrors).flatMap(([field, messages]) => {
    const target = STOCK_TRANSACTION_FIELDS[field] ?? {
      fieldId: 'stock-transaction-form',
      label: field,
    };
    return messages.map((message) => ({ ...target, message }));
  });
}
