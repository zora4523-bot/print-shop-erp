'use client';

import { useActionState, useEffect, useEffectEvent, useRef, useState } from 'react';
import { emptyPurchaseDraft, type FormDraftContext } from '@/lib/form-drafts/model';
import { useFormDraft } from '@/components/business/form-drafts/useFormDraft';
import { DraftIdentityFields, DraftNotice, SupplementLink } from '@/components/business/form-drafts/FormDraftControls';
import type { PurchaseMutationResult } from '@/actions/owner-purchases.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SupplierPartyOption } from '@/lib/party';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useReportFormPending } from '@/components/business/form/FormPendingScope';

export type PurchaseMaterialOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
};

type Props = {
  action: (
    prev: PurchaseMutationResult | null,
    fd: FormData,
  ) => Promise<PurchaseMutationResult>;
  suppliers: SupplierPartyOption[];
  materials: PurchaseMaterialOption[];
  initialSupplierPartyId?: string;
  draftContext: FormDraftContext;
};


const NEW_SUPPLIER_HREF = '/owner/parties/new?type=SUPPLIER';

export function PurchaseOrderForm({
  action,
  suppliers,
  materials,
  initialSupplierPartyId = '',
  draftContext,
}: Props) {

  const [state, formAction, pending] = useActionState<PurchaseMutationResult | null, FormData>(action, null);
  useReportFormPending(pending);
  const formRef = useRef<HTMLFormElement>(null);
  const draft = useFormDraft(draftContext, emptyPurchaseDraft(initialSupplierPartyId), formRef);
  const [feedback, setFeedback] = useState({ result: state, requestId: draft.identity.clientRequestId });
  if (feedback.result !== state) setFeedback({ result: state, requestId: draft.identity.clientRequestId });
  const currentState = feedback.requestId === draft.identity.clientRequestId ? state : null;
  // Keep the original Server Action bound for native submissions without JS.
  const recheckCreation = useEffectEvent(() => draft.retry());
  useEffect(() => {
    if (state?.status === 'error' && state.creationConflict) void recheckCreation();
  }, [state]);
  const { payload } = draft;
  // Background status verification must not disable a focused native input
  // between keydown and input, which can silently discard the first keystroke.
  const disabled = pending || draft.editingBlocked;
  const change = (key: keyof typeof payload, value: string) => draft.update((current) => ({ ...current, [key]: value }));

  const errs = currentState?.status === 'invalid' ? currentState.fieldErrors : {};
  const generalError = currentState?.status === 'error' ? currentState.message : null;
  const missingSuppliers = suppliers.length === 0;
  const missingMaterials = materials.length === 0;
  const prerequisitesMissing = missingSuppliers || missingMaterials;

  return (
    <form ref={formRef} action={formAction} aria-busy={pending} className="space-y-5" noValidate>
      <DraftIdentityFields identity={draft.identity} />
      <DraftNotice draft={draft} disabled={pending} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="supplierPartyId">供应商</Label>
            <div className="flex flex-wrap gap-x-3">
              <SupplementLink href="/owner/parties?type=suppliers" disabled={pending || draft.blocked} onSupplement={() => draft.supplement('SUPPLIER', 'supplierPartyId', true)}>管理供应商</SupplementLink>
              <SupplementLink href={NEW_SUPPLIER_HREF} disabled={pending || draft.blocked} onSupplement={() => draft.supplement('SUPPLIER', 'supplierPartyId')}>新建供应商</SupplementLink>
            </div>
          </div>
          <NativeSelect
            id="supplierPartyId"
            name="supplierPartyId"
            disabled={disabled || missingSuppliers}
            value={payload.supplierPartyId}
            onChange={(event) => change('supplierPartyId', event.target.value)}
            aria-describedby={missingSuppliers ? 'supplierPartyId-empty' : undefined}
          >
            <option value="">
              {missingSuppliers ? '暂无可用供应商' : '请选择供应商'}
            </option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.code} · {supplier.shortName ?? supplier.name}
              </option>
            ))}
          </NativeSelect>
          {errs.supplierPartyId?.[0] ? (
            <p className="text-sm text-destructive">{errs.supplierPartyId[0]}</p>
          ) : null}
          {missingSuppliers ? (
            <p id="supplierPartyId-empty" className="text-sm text-muted-foreground">
              只有启用的“供应商”或“客户/供应商”主数据可用于采购。
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="materialId">物料</Label>
            <SupplementLink href="/owner/materials/new" disabled={pending || draft.blocked} onSupplement={() => draft.supplement('MATERIAL', 'materialId')}>新建物料</SupplementLink>
          </div>
          <NativeSelect
            id="materialId"
            name="materialId"
            disabled={disabled || missingMaterials}
            value={payload.materialId}
            onChange={(event) => change('materialId', event.target.value)}
            aria-describedby={missingMaterials ? 'materialId-empty' : undefined}
          >
            <option value="">{missingMaterials ? '暂无可用物料' : '请选择物料'}</option>
            {materials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.code} · {externalPriceBusinessText(material.name)}（
                {material.unit}）
              </option>
            ))}
          </NativeSelect>
          {errs.materialId?.[0] ? (
            <p className="text-sm text-destructive">{errs.materialId[0]}</p>
          ) : null}
          {missingMaterials ? (
            <p id="materialId-empty" className="text-sm text-muted-foreground">
              请先创建并启用至少一种物料。
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <TextField
          id="quantity"
          value={payload.quantity}
          onChange={(value) => change('quantity', value)}
          label="采购数量"
          disabled={disabled}
          error={errs.quantity?.[0]}
        />
        <TextField
          id="unitCost"
          value={payload.unitCost}
          onChange={(value) => change('unitCost', value)}
          label="单位成本（选填）"
          disabled={disabled}
          error={errs.unitCost?.[0]}
        />
        <TextField
          id="expectedDate"
          value={payload.expectedDate}
          onChange={(value) => change('expectedDate', value)}
          label="预计到货日（选填）"
          type="date"
          disabled={disabled}
          error={errs.expectedDate?.[0]}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="remark">备注（选填）</Label>
        <Textarea
          id="remark"
          name="remark"
          rows={3}
          value={payload.remark}
          onChange={(event) => change('remark', event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(errs.remark?.[0])}
          className="min-h-20 w-full"
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

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending || draft.blocked || prerequisitesMissing}>
          {pending ? '正在提交…' : '创建采购单'}
        </Button>
      </div>
    </form>
  );
}

function TextField({
  id,
  label,
  error,
  type = 'text',
  disabled,
  value,
  onChange,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  type?: string;
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={Boolean(error)}
      />
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
