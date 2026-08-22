'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { setMaterialActiveAction } from '@/actions/owner-materials';
import type { MaterialMutationResult } from '@/actions/owner-materials.types';

export function ToggleMaterialActiveButton({
  materialId,
  currentlyActive,
}: {
  materialId: string;
  currentlyActive: boolean;
}) {
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<
    MaterialMutationResult | null,
    FormData
  >(async () => setMaterialActiveAction(materialId, nextActive), null);

  const error = state?.status === 'error' ? state.message : null;

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <Button
          type="submit"
          variant={currentlyActive ? 'destructive' : 'default'}
          disabled={pending}
        >
          {pending ? '…' : currentlyActive ? '停用物料' : '启用物料'}
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
