'use client';

import { useActionState, useCallback, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CustomerPriceBookMutationResult } from '@/actions/customer-price-books.types';
import { usePriceWorkspaceUnsavedTierChanges } from '@/components/business/price/PriceWorkspaceNavigationGuard';

type FormState = CustomerPriceBookMutationResult | null;

export type CustomerPricingSectionDraftFormProps = {
  children: ReactNode;
  saveAction?: (
    previousState: FormState,
    formData: FormData,
  ) => Promise<CustomerPriceBookMutationResult>;
};

function MutationFeedback({ state }: { state: FormState }) {
  if (!state) return null;
  if (state.status === 'success') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-success-foreground">
        <Check aria-hidden="true" className="size-4" />
        调价草稿已保存。
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="admin-wrap-anywhere text-sm text-destructive">
        {state.message}
      </p>
    );
  }
  const messages = [...new Set(Object.values(state.fieldErrors).flat())];
  return (
    <div role="alert" className="text-sm text-destructive">
      <p className="font-medium">请先修正未保存的价格：</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {messages.map((message) => (
          <li key={message} className="admin-wrap-anywhere">
            {message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CustomerPricingSectionDraftForm({
  children,
  saveAction,
}: CustomerPricingSectionDraftFormProps) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const clearUnsavedChanges = usePriceWorkspaceUnsavedTierChanges(dirty ? 1 : 0);
  const submitAction = useCallback(
    async (previousState: FormState, formData: FormData) => {
      if (!saveAction) return null;
      const result = await saveAction(previousState, formData);
      if (result.status === 'success') {
        setDirty(false);
        clearUnsavedChanges();
        router.refresh();
      }
      return result;
    },
    [clearUnsavedChanges, router, saveAction],
  );
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    submitAction,
    null,
  );

  if (!saveAction) return children;

  return (
    <form
      action={formAction}
      aria-busy={pending}
      className="min-w-0"
      onChange={() => setDirty(true)}
    >
      {children}
      <div className="sticky bottom-3 z-20 mt-4 flex min-w-0 flex-col gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <MutationFeedback state={state} />
        <Button
          type="submit"
          className="min-h-11 shrink-0"
          disabled={pending || !dirty}
        >
          <Save aria-hidden="true" />
          {pending ? '正在保存…' : '保存调价草稿'}
        </Button>
      </div>
    </form>
  );
}
