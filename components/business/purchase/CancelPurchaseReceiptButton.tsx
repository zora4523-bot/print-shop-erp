'use client';

import { useActionState } from 'react';
import { cancelPurchaseReceiptAction } from '@/actions/owner-purchases';
import type { PurchaseMutationResult } from '@/actions/owner-purchases.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function CancelPurchaseReceiptButton({
  receiptId,
}: {
  receiptId: string;
}) {
  const [state, formAction, pending] = useActionState<
    PurchaseMutationResult | null,
    FormData
  >(cancelPurchaseReceiptAction.bind(null, receiptId), null);

  const error = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success' ? state.message : null;

  return (
    <form action={formAction} className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor={`reason-${receiptId}`}>取消原因</Label>
        <Input id={`reason-${receiptId}`} name="reason" disabled={pending} />
      </div>
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? '提交中…' : '取消收货过账'}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success">
          ✓ {success}
        </p>
      ) : null}
    </form>
  );
}
