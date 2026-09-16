'use client';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { createOrderSchema, type CreateOrderInput } from '@/lib/auth/schemas';
import type { OrderPurposeValue } from '@/lib/order/purpose';
import { workbenchItemQuoteSchema } from '@/lib/workbench/item-quote';
import {
  EMPTY_SAMPLE_FORM,
  type SampleOrderFormState,
  type SampleOrderContext,
  type SavedSampleDraft,
} from '@/components/business/order/SampleOrderForm';

const sampleContextSchema = z.object({
  customName: createOrderSchema.shape.customName,
  packageRequirement: createOrderSchema.shape.packageRequirement,
  externalSalesUserId: createOrderSchema.shape.externalSalesUserId,
  customerRef: createOrderSchema.shape.customerRef,
  promisedDate: createOrderSchema.shape.promisedDate,
  isUrgent: createOrderSchema.shape.isUrgent,
  expressCode: createOrderSchema.shape.expressCode,
});

export function useSampleWorkbenchDraft(
  item: CreateOrderInput['items'][number],
  setItem: (item: CreateOrderInput['items'][number]) => void,
  draftScope: string,
  initial?: { purpose: 'SAMPLE_SHIPMENT' | 'PROOF'; form: SampleOrderFormState; context?: SampleOrderContext },
) {
  // Initial entry values are captured once; later edits belong to this draft.
  const [entryInitial] = useState(initial);
  const [purpose, setPurpose] = useState<OrderPurposeValue>(initial?.purpose ?? 'STANDARD');
  const [context, setContext] = useState(initial?.context);
  const [specialBusy, setSpecialBusy] = useState(false);
  const [sampleForm, setSampleForm] =
    useState<SampleOrderFormState>(initial?.form ?? EMPTY_SAMPLE_FORM);
  const [sampleDraft, setSampleDraft] = useState<SavedSampleDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const sampleStorageKey = `workbench-sample:v1:${draftScope}`;
  const specialLocked = specialBusy || sampleDraft !== null;
  useEffect(() => {
    // Storage is scoped to the signed-in user. Restored facts still go through
    // the command schema; no cached quote is accepted as a price.
    Promise.resolve().then(() => {
      try {
        const raw = window.sessionStorage.getItem(sampleStorageKey);
        if (raw) {
          const saved = JSON.parse(raw);
          if (
            saved.purpose === 'PROOF' ||
            saved.purpose === 'SAMPLE_SHIPMENT'
          ) {
            const fields = saved.form;
            if (
              fields &&
              Object.keys(EMPTY_SAMPLE_FORM).every(
                (key) =>
                  typeof fields[key] ===
                  typeof EMPTY_SAMPLE_FORM[key as keyof SampleOrderFormState],
              )
            ) {
              if (!entryInitial) setPurpose(saved.purpose);
              setSampleForm(fields);
              const restoredContext = sampleContextSchema.safeParse(saved.context);
              if (restoredContext.success) setContext(restoredContext.data);
              if (
                saved.purpose === 'PROOF' &&
                workbenchItemQuoteSchema.safeParse({ item: saved.item }).success
              )
                setItem(saved.item);
              if (
                saved.draft &&
                typeof saved.draft.orderId === 'string' &&
                Array.isArray(saved.draft.itemIds) &&
                saved.draft.itemIds.every(
                  (id: unknown) => typeof id === 'string',
                )
              )
                setSampleDraft(saved.draft);
            }
          }
        }
      } catch {
        /* Storage may be unavailable; server drafts remain accessible. */
      }
      setDraftReady(true);
    });
  }, [sampleStorageKey, setItem, entryInitial]);
  useEffect(() => {
    if (!draftReady) return;
    try {
      if (purpose === 'STANDARD') { window.sessionStorage.removeItem(sampleStorageKey); return; }
      window.sessionStorage.setItem(
        sampleStorageKey,
        JSON.stringify({ purpose, item, form: sampleForm, draft: sampleDraft, context }),
      );
    } catch {
      /* In-memory editing remains available without browser storage. */
    }
  }, [draftReady, purpose, item, sampleForm, sampleDraft, sampleStorageKey, context]);
  function clearSampleDraft() {
    setSampleDraft(null);
    try {
      window.sessionStorage.removeItem(sampleStorageKey);
    } catch {
      /* Optional local cache. */
    }
  }
  const sampleFormProps = {
    context,
    value: sampleForm,
    onChange: setSampleForm,
    draft: sampleDraft,
    onDraftChange: setSampleDraft,
    onComplete: clearSampleDraft,
    onBusyChange: setSpecialBusy,
  };
  return { purpose, setPurpose, specialLocked, sampleFormProps };
}
