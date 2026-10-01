'use client';

import {
  useActionState,
  useCallback,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type { PurchaseMutationResult } from '@/actions/owner-purchases.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';
import type { WarehouseLocationOption } from '@/lib/warehouse';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  action: (
    prev: PurchaseMutationResult | null,
    fd: FormData,
  ) => Promise<PurchaseMutationResult>;
  purchaseOrderItemId: string;
  unit: string;
  defaultUnitCost: string | null;
  remainingQuantity: string;
  locationOptions: WarehouseLocationOption[];
  initialIdempotencyKey: string;
};

export type PurchaseReceiptPreview = {
  locationLabel: string;
  quantity: string;
  unit: string;
  unitCost: string;
};

export function purchaseReceiptImpactItems(
  preview: PurchaseReceiptPreview,
  remainingQuantity: string,
): string[] {
  return [
    '方向：入库（采购收货过账）',
    '物料：当前采购明细物料',
    `库位：${preview.locationLabel}`,
    `本次数量：${preview.quantity} ${preview.unit}`,
    `单位成本：${preview.unitCost || '未填写'}`,
    `提交前剩余：${remainingQuantity} ${preview.unit}`,
    '本次收货数量计入库存和采购单的已收数量。',
  ];
}


export function PurchaseReceiptForm({
  action,
  purchaseOrderItemId,
  unit,
  defaultUnitCost,
  remainingQuantity,
  locationOptions,
  initialIdempotencyKey,
}: Props) {
  const allowReset = useRef(false);
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmedRef = useRef(false);
  const [locationId, setLocationId] = useState('');
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [preview, setPreview] = useState<PurchaseReceiptPreview | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey);
  const submitReceipt = useCallback(
    async (prev: PurchaseMutationResult | null, formData: FormData) => {
      const result = await action(prev, formData);
      allowReset.current = result.status === 'success';
      if (result.status === 'success') {
        setLocationId('');
        setIdempotencyKey(window.crypto.randomUUID());
      }
      return result;
    },
    [action],
  );
  const [state, formAction, pending] = useActionState<
    PurchaseMutationResult | null,
    FormData
  >(submitReceipt, null);

  const visibleState = pending ? null : state;
  const errs = visibleState?.status === 'invalid' ? visibleState.fieldErrors : {};
  const generalError =
    visibleState?.status === 'error' ? visibleState.message : null;
  const success =
    visibleState?.status === 'success' ? visibleState.message : null;

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

    setReceiptQuantityValidity(quantityInput, remainingQuantity);
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    setPreview({
      locationLabel: purchaseReceiptLocationLabel(
        String(formData.get('locationId') ?? ''),
        locationOptions,
      ),
      quantity: String(formData.get('quantity') ?? '').trim(),
      unit,
      unitCost: String(formData.get('unitCost') ?? '').trim(),
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
      onReset={(event) => { if (!allowReset.current) event.preventDefault(); }}
      onSubmit={handleSubmit}
      onInvalidCapture={() => {
        // 原生校验若阻止确认后的 submit，不允许令牌泄漏到下一次提交。
        confirmedRef.current = false;
      }}
      aria-busy={pending}
      data-risk-level="L2"
      className="space-y-4"
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="purchaseOrderItemId" value={purchaseOrderItemId} />
      <div className="space-y-2">
        <Label htmlFor={`location-${purchaseOrderItemId}`}>收货库位</Label>
        <NativeSelect
          id={`location-${purchaseOrderItemId}`}
          name="locationId"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          disabled={pending}
        >
          <option value="">默认库位</option>
          {locationId && !locationOptions.some((option) => option.id === locationId) ? <option value={locationId}>原库位已停用，请重新选择</option> : null}
          {locationOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.warehouseName} / {option.name}
              {option.isDefault ? '（默认）' : ''}
            </option>
          ))}
        </NativeSelect>
        {errs.locationId?.[0] ? (
          <p className="text-sm text-destructive">{errs.locationId[0]}</p>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          id={`receipt-quantity-${purchaseOrderItemId}`}
          name="quantity"
          label={`本次收货数量（${unit}）`}
          hint={`剩余 ${remainingQuantity} ${unit}`}
          required
          pattern="\d{1,10}(\.\d{1,2})?"
          maxLength={13}
          disabled={pending}
          error={errs.quantity?.[0]}
        />
        <TextField
          id={`receipt-unit-cost-${purchaseOrderItemId}`}
          name="unitCost"
          label="单位成本（选填）"
          pattern="\d{1,6}(\.\d{1,4})?"
          maxLength={11}
          disabled={pending}
          error={errs.unitCost?.[0]}
          defaultValue={defaultUnitCost ?? ''}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`receipt-remark-${purchaseOrderItemId}`}>备注（选填）</Label>
        <Textarea
          id={`receipt-remark-${purchaseOrderItemId}`}
          name="remark"
          rows={2}
          maxLength={500}
          disabled={pending}
          aria-invalid={Boolean(errs.remark?.[0])}
          className="min-h-16 w-full"
        />
        {errs.remark?.[0] ? (
          <p className="text-sm text-destructive">{errs.remark[0]}</p>
        ) : null}
      </div>
      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success-foreground">
          ✓ {success}
        </p>
      ) : null}
      <Button
        ref={triggerRef}
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="min-h-11"
      >
        {pending ? '正在提交…' : '核对并确认收货过账'}
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
        <ConfirmActionDialog action="确认采购收货过账" changes={[]} consequences={
          preview ? purchaseReceiptImpactItems(preview, remainingQuantity) : []
        } confirmText="收货过账" />
      </ConfirmActionController>
    </form>
  );
}

function TextField({
  id,
  name,
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
  name: string;
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
        name={name}
        defaultValue={defaultValue}
        inputMode="decimal"
        required={required}
        pattern={pattern}
        maxLength={maxLength}
        onInput={(event) => event.currentTarget.setCustomValidity('')}
        disabled={disabled}
        aria-invalid={Boolean(error)}
      />
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function setReceiptQuantityValidity(
  input: HTMLInputElement,
  remainingQuantity: string,
) {
  input.setCustomValidity('');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(input.value.trim())) return;

  const quantity = Number(input.value);
  const remaining = Number(remainingQuantity);
  if (quantity <= 0) {
    input.setCustomValidity('收货数量必须大于 0');
  } else if (Number.isFinite(remaining) && quantity > remaining) {
    input.setCustomValidity(`本次最多可收货 ${remainingQuantity}`);
  }
}

function purchaseReceiptLocationLabel(
  locationId: string,
  options: readonly WarehouseLocationOption[],
): string {
  const location = locationId
    ? options.find((option) => option.id === locationId)
    : options.find((option) => option.isDefault);
  if (!location) return locationId ? `库位 ${locationId}` : '系统默认库位';
  return `${location.warehouseName} / ${location.name}${location.isDefault ? '（默认）' : ''}`;
}
