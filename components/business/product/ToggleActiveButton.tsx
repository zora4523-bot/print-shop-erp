'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { setProductActiveAction } from '@/actions/owner-products';
import type { ProductMutationResult } from '@/actions/owner-products.types';

export function ToggleActiveButton({
  productId,
  currentlyActive,
}: {
  productId: string;
  currentlyActive: boolean;
}) {
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<ProductMutationResult | null, FormData>(
    async () => setProductActiveAction(productId, nextActive),
    null,
  );

  const error = state?.status === 'error' ? state.message : null;

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <Button
          type="submit"
          variant={currentlyActive ? 'destructive' : 'default'}
          disabled={pending}
        >
          {pending ? '…' : currentlyActive ? '停用产品' : '启用产品'}
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
