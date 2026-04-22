'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { setCraftActiveAction } from '@/actions/owner-crafts';
import type { CraftMutationResult } from '@/actions/owner-crafts.types';

// Same pattern as components/business/account/ToggleActiveButton.tsx —
// useActionState around the toggle so the invariant error path renders
// inline instead of vanishing.
export function ToggleActiveButton({
  craftId,
  currentlyActive,
}: {
  craftId: string;
  currentlyActive: boolean;
}) {
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<CraftMutationResult | null, FormData>(
    async () => setCraftActiveAction(craftId, nextActive),
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
          {pending ? '…' : currentlyActive ? '停用工艺' : '启用工艺'}
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
