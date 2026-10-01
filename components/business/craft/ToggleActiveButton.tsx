'use client';

import { useActionState, useId } from 'react';
import { withAppliedActive, type AppliedActiveState } from '@/components/business/master-data/applied-active-state';
import { ActionNotice } from '@/components/ui-business';
import { ActiveStateConfirmButton } from '@/components/business/master-data/ActiveStateConfirmButton';
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
  const formId = useId();
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<AppliedActiveState<CraftMutationResult> | null, FormData>(
    async () => withAppliedActive(await setCraftActiveAction(craftId, nextActive), nextActive),
    null,
  );

  const visibleState = pending ? null : state;
  const error = visibleState?.status === 'error' ? visibleState.message : null;
  const success = visibleState?.status === 'success';

  return (
    <div className="space-y-2">
      <form id={formId} action={formAction} aria-busy={pending} />
      <ActiveStateConfirmButton
        entityLabel="工艺"
        currentlyActive={currentlyActive}
        pending={pending}
        formId={formId}
        deactivateImpactItems={[
          '新工单和新规则不可选择该工艺',
          '已有产品、工单和历史记录保留',
        ]}
      />
      {error ? (
        <ActionNotice tone="error" title="工艺状态更新失败" description={error} />
      ) : null}
      {success ? (
        <ActionNotice
          tone="success"
          title={visibleState?.appliedActive ? '工艺已启用' : '工艺已停用'}
        />
      ) : null}
    </div>
  );
}
