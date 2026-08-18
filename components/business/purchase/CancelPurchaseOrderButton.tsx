'use client';

import { useActionState } from 'react';
import { cancelPurchaseOrderAction } from '@/actions/owner-purchases';
import type { PurchaseMutationResult } from '@/actions/owner-purchases.types';
import { Button } from '@/components/ui/button';

export function CancelPurchaseOrderButton({
  purchaseOrderId,
}: {
  purchaseOrderId: string;
}) {
  const [state, formAction, pending] = useActionState<
    PurchaseMutationResult | null,
    FormData
  >(async () => cancelPurchaseOrderAction(purchaseOrderId), null);

  const error = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success' ? state.message : null;

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? '提交中…' : '取消采购单'}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success-foreground">
          ✓ {success}
        </p>
      ) : null}
    </div>
  );
}
