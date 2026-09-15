'use client';
import { useEffect, useState } from 'react';
import type { CreateOrderInput } from '@/lib/auth/schemas';
import type { OrderPurposeValue } from '@/lib/order/purpose';
import { workbenchItemQuoteSchema } from '@/lib/workbench/item-quote';
import {
  EMPTY_SAMPLE_FORM,
  type SampleOrderFormState,
  type SavedSampleDraft,
} from '@/components/business/order/SampleOrderForm';

export function useSampleWorkbenchDraft(
  item: CreateOrderInput['items'][number],
  setItem: (item: CreateOrderInput['items'][number]) => void,
  draftScope: string,
) {
  const [purpose, setPurpose] = useState<OrderPurposeValue>('STANDARD');
  const [specialBusy, setSpecialBusy] = useState(false);
  const [sampleForm, setSampleForm] =
    useState<SampleOrderFormState>(EMPTY_SAMPLE_FORM);
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
              setPurpose(saved.purpose);
              setSampleForm(fields);
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
  }, [sampleStorageKey, setItem]);
  useEffect(() => {
    if (!draftReady) return;
    try {
      if (purpose === 'STANDARD') { window.sessionStorage.removeItem(sampleStorageKey); return; }
      window.sessionStorage.setItem(
        sampleStorageKey,
        JSON.stringify({ purpose, item, form: sampleForm, draft: sampleDraft }),
      );
    } catch {
      /* In-memory editing remains available without browser storage. */
    }
  }, [draftReady, purpose, item, sampleForm, sampleDraft, sampleStorageKey]);
  function clearSampleDraft() {
    setSampleDraft(null);
    try {
      window.sessionStorage.removeItem(sampleStorageKey);
    } catch {
      /* Optional local cache. */
    }
  }
  const sampleFormProps = {
    value: sampleForm,
    onChange: setSampleForm,
    draft: sampleDraft,
    onDraftChange: setSampleDraft,
    onComplete: clearSampleDraft,
    onBusyChange: setSpecialBusy,
  };
  return { purpose, setPurpose, specialLocked, sampleFormProps };
}
