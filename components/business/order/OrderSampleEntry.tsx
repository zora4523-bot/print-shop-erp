'use client';
import type { OrderCreationLifecycle, SampleOrderEditorSnapshot } from './order-creation-editor';
import { useEffect, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { CreateOrderInput } from '@/lib/auth/schemas';
import type { OrderItemPricingRoute } from '@/generated/prisma/enums';
import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import type { PricingCraftIdentity } from '@/lib/order/pricing-route';
import { WorkbenchCalculator } from '@/components/business/workbench/WorkbenchCalculator';
import { EMPTY_SAMPLE_FORM, type SampleOrderFormState } from './SampleOrderForm';

type SamplePurpose = 'SAMPLE_SHIPMENT' | 'PROOF';
export function useSampleOrderEntry(draftScope: string, workbenchTransferId?: string, initialPurpose?: SamplePurpose | null) {
  const [samplePurpose, setSamplePurpose] = useState<SamplePurpose | null>(initialPurpose ?? null);
  const sampleEntryKey = `order-create-purpose:v1:${draftScope}`;
  useEffect(() => {
    if (workbenchTransferId || initialPurpose !== undefined) return;
    try {
      const saved = sessionStorage.getItem(sampleEntryKey);
      if (saved === 'PROOF' || saved === 'SAMPLE_SHIPMENT') {
        Promise.resolve().then(() => setSamplePurpose(saved));
      }
    } catch { /* In-memory editing remains available. */ }
  }, [sampleEntryKey, workbenchTransferId, initialPurpose]);
  function chooseSamplePurpose(value: 'SAMPLE_SHIPMENT' | 'PROOF' | null) {
    setSamplePurpose(value);
    try {
      if (value) sessionStorage.setItem(sampleEntryKey, value);
      else sessionStorage.removeItem(sampleEntryKey);
    } catch { /* Optional local draft cache. */ }
  }
  return { samplePurpose, chooseSamplePurpose };
}

export function OrderSampleEntry({ editorSnapshot, onEditorSnapshot, lifecycle, form, purpose, options, crafts, draftScope, itemIndex, initialItem, choosePurpose, onRouteChange, canEditFees }: {
  editorSnapshot?: SampleOrderEditorSnapshot;
  onEditorSnapshot?: (snapshot: SampleOrderEditorSnapshot) => void;
  lifecycle?: OrderCreationLifecycle;
  canEditFees?: boolean;
  form: UseFormReturn<CreateOrderInput>;
  purpose: SamplePurpose;
  options: ExternalCreateOrderOptions;
  crafts: readonly PricingCraftIdentity[];
  draftScope: string;
  itemIndex: number;
  initialItem: CreateOrderInput['items'][number];
  choosePurpose: (purpose: SamplePurpose | null) => void;
  onRouteChange: (index: number, route: OrderItemPricingRoute) => void;
}) {
  const values = form.getValues();
  const sampleForm: SampleOrderFormState = {
    ...EMPTY_SAMPLE_FORM,
    name: values.customName || values.items[itemIndex]?.name || '',
    receiverName: values.receiverName ?? '', receiverPhone: values.receiverPhone ?? '',
    receiverAddress: values.receiverAddress ?? '', province: values.destinationProvince ?? '',
    collect: values.isSfCollect ?? false, remark: values.remark ?? '',
  };
  return <section className="space-y-4">
    <h1 className="text-xl font-semibold">新建工单</h1>
    <WorkbenchCalculator options={options} crafts={crafts}
      draftScope={`order-create:${draftScope}`}
      createEntry={{ editorSnapshot, onEditorSnapshot, lifecycle, canEditFees, purpose, form: sampleForm,
        item: values.items[itemIndex] ?? initialItem,
        context: { customName: values.customName, packageRequirement: values.packageRequirement, externalSalesUserId: values.externalSalesUserId,
          customerRef: values.customerRef, promisedDate: values.promisedDate,
          isUrgent: values.isUrgent, expressCode: values.expressCode },
        onPurposeChange: choosePurpose,
        onComplete: () => choosePurpose(null),
        onStandard: (route, contact) => {
          form.setValue('receiverName', contact.receiverName, { shouldDirty: true });
          form.setValue('receiverPhone', contact.receiverPhone, { shouldDirty: true });
          form.setValue('receiverAddress', contact.receiverAddress, { shouldDirty: true });
          form.setValue('destinationProvince', contact.province || null, { shouldDirty: true });
          form.setValue('isSfCollect', contact.collect, { shouldDirty: true });
          form.setValue('remark', contact.remark, { shouldDirty: true });
          onRouteChange(itemIndex, route);
          choosePurpose(null);
        },
      }} />
  </section>;
}

export function prepareSampleOrderEntry(current: CreateOrderInput, itemIndex: number, draftScope: string, purpose: SamplePurpose) {
  const key = `workbench-sample:v1:order-create:${draftScope}`;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    // A new entry carries the current contact and ownership facts;
    // the previously typed sample name/packaging remain reusable.
    sessionStorage.setItem(key, JSON.stringify({
      purpose, item: current.items[itemIndex],
      form: { ...EMPTY_SAMPLE_FORM, ...saved?.form,
        name: saved?.form?.name || current.customName || '',
        receiverName: current.receiverName ?? '', receiverPhone: current.receiverPhone ?? '',
        receiverAddress: current.receiverAddress ?? '', province: current.destinationProvince ?? '',
        collect: current.isSfCollect ?? false, remark: current.remark ?? '' },
      draft: null,
      context: { customName: current.customName, packageRequirement: current.packageRequirement, externalSalesUserId: current.externalSalesUserId,
        customerRef: current.customerRef, promisedDate: current.promisedDate,
        isUrgent: current.isUrgent, expressCode: current.expressCode },
    }));
  } catch { /* Initial props cover browsers without storage. */ }
}
