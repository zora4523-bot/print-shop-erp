'use client';

import { useActionState } from 'react';
import { setBomActiveAction } from '@/actions/owner-boms';
import type { BomMutationResult } from '@/actions/owner-boms.types';
import { Button } from '@/components/ui/button';

// Small client component so a failed toggle (e.g. BomInvariantError
// "该 BOM 仍被工单引用") surfaces inline instead of being silently
// dropped. Previously this used useTransition and awaited the action
// without reading its result, so an error looked like success.
export function ToggleBomActiveButton({
  bomId,
  currentlyActive,
}: {
  bomId: string;
  currentlyActive: boolean;
}) {
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<
    BomMutationResult | null,
    FormData
  >(async () => setBomActiveAction(bomId, nextActive), null);

  // Surface BOTH the invariant/error message AND any invalid field
  // errors — setBomActiveAction can return either shape, and a toggle
  // that failed must never look like it succeeded.
  const error =
    state?.status === 'error'
      ? state.message
      : state?.status === 'invalid'
        ? Object.values(state.fieldErrors).flat().join('；')
        : null;

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <Button
          type="submit"
          variant={currentlyActive ? 'destructive' : 'outline'}
          disabled={pending}
        >
          {pending ? '处理中…' : currentlyActive ? '停用 BOM' : '启用 BOM'}
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
