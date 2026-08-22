'use client';

import { useActionState } from 'react';
import { setProductCategoryNodeActiveAction } from '@/actions/owner-product-categories';
import type { ProductCategoryNodeMutationResult } from '@/actions/owner-product-categories.types';
import { Button } from '@/components/ui/button';

export function ToggleProductCategoryActiveButton({
  nodeId,
  currentlyActive,
}: {
  nodeId: string;
  currentlyActive: boolean;
}) {
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<
    ProductCategoryNodeMutationResult | null,
    FormData
  >(async () => setProductCategoryNodeActiveAction(nodeId, nextActive), null);

  const error = state?.status === 'error' ? state.message : null;

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <Button
          type="submit"
          variant={currentlyActive ? 'destructive' : 'default'}
          disabled={pending}
        >
          {pending ? '…' : currentlyActive ? '停用分类' : '启用分类'}
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
