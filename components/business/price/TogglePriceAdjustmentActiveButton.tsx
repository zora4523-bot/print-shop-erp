'use client';

import { useActionState } from 'react';
import { setPriceAdjustmentActiveAction } from '@/actions/owner-prices';
import type { PriceMutationResult } from '@/actions/owner-prices.types';
import { Button } from '@/components/ui/button';

export function TogglePriceAdjustmentActiveButton({
  adjustmentId,
  currentlyActive,
}: {
  adjustmentId: string;
  currentlyActive: boolean;
}) {
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<
    PriceMutationResult | null,
    FormData
  >(async () => setPriceAdjustmentActiveAction(adjustmentId, nextActive), null);

  const error = state?.status === 'error' ? state.message : null;

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <Button
          type="submit"
          variant={currentlyActive ? 'destructive' : 'default'}
          disabled={pending}
        >
          {pending ? '…' : currentlyActive ? '停用加价规则' : '启用加价规则'}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
