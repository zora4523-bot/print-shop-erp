'use client';

import { useActionState } from 'react';
import { setPartyActiveAction } from '@/actions/owner-parties';
import type { PartyMutationResult } from '@/actions/owner-parties.types';
import { ActionNotice, PendingButton } from '@/components/ui-business';

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

  const visibleState = pending ? null : state;
  const error = visibleState?.status === 'error' ? visibleState.message : null;
  const success = visibleState?.status === 'success';

  return (
    <div className="space-y-2">
      <form action={formAction} aria-busy={pending}>
        <PendingButton
          pending={pending}
          pendingLabel={
            currentlyActive
              ? '正在停用客户/供应商…'
              : '正在启用客户/供应商…'
          }
          variant={currentlyActive ? 'destructive' : 'default'}
        >
          {currentlyActive ? '停用客户/供应商' : '启用客户/供应商'}
        </PendingButton>
      </form>
      {error ? (
        <ActionNotice
          tone="error"
          title={
            currentlyActive
              ? '客户/供应商停用失败'
              : '客户/供应商启用失败'
          }
          description={error}
        />
      ) : null}
      {success ? (
        <ActionNotice
          tone="success"
          title={
            currentlyActive ? '客户/供应商已停用' : '客户/供应商已启用'
          }
        />
      ) : null}
    </div>
  );
}
