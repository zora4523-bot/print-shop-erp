'use client';

import { useActionState, useId } from 'react';
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
  const [state, formAction, pending] = useActionState<CraftMutationResult | null, FormData>(
    async () => setCraftActiveAction(craftId, nextActive),
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
          '该工艺不再出现在要求活跃工艺的新工单和排产选择中',
          '历史生产任务和薪资记录会继续保留',
          '停用不会删除已有产品或工单中的历史引用',
        ]}
      />
      {error ? (
        <ActionNotice tone="error" title="工艺状态更新失败" description={error} />
      ) : null}
      {success ? (
        <ActionNotice
          tone="success"
          title={currentlyActive ? '工艺已停用' : '工艺已启用'}
        />
      ) : null}
    </div>
  );
}
