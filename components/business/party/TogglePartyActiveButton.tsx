'use client';

import { useActionState } from 'react';
import { setPartyActiveAction } from '@/actions/owner-parties';
import type { PartyMutationResult } from '@/actions/owner-parties.types';
import { Button } from '@/components/ui/button';

export function TogglePartyActiveButton({
  partyId,
  currentlyActive,
}: {
  partyId: string;
  currentlyActive: boolean;
}) {
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<
    PartyMutationResult | null,
    FormData
  >(async () => setPartyActiveAction(partyId, nextActive), null);

  const error = state?.status === 'error' ? state.message : null;

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <Button
          type="submit"
          variant={currentlyActive ? 'destructive' : 'default'}
          disabled={pending}
        >
          {pending
            ? '…'
            : currentlyActive
              ? '停用客户/供应商'
              : '启用客户/供应商'}
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
