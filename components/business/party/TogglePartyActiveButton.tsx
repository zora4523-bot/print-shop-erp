'use client';

import { useActionState, useId } from 'react';
import { setPartyActiveAction } from '@/actions/owner-parties';
import type { PartyMutationResult } from '@/actions/owner-parties.types';
import { ActionNotice } from '@/components/ui-business';
import { ActiveStateConfirmButton } from '@/components/business/master-data/ActiveStateConfirmButton';

export function TogglePartyActiveButton({
  partyId,
  currentlyActive,
}: {
  partyId: string;
  currentlyActive: boolean;
}) {
  const formId = useId();
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
      <form id={formId} action={formAction} aria-busy={pending} />
      <ActiveStateConfirmButton
        entityLabel="客户/供应商"
        currentlyActive={currentlyActive}
        pending={pending}
        formId={formId}
        deactivateImpactItems={[
          '该客户/供应商不再出现在新业务的可选项中',
          '既有工单、采购、账单和地址记录会继续保留',
          '停用不会自动取消仍在进行的业务',
        ]}
      />
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
