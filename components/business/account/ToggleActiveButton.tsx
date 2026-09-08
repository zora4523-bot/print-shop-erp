'use client';

import { useActionState, useId } from 'react';
import { ActionNotice } from '@/components/ui-business';
import { ActiveStateConfirmButton } from '@/components/business/master-data/ActiveStateConfirmButton';
import { setUserActiveAction } from '@/actions/owner-accounts';
import type { AccountMutationResult } from '@/actions/owner-accounts.types';

// Small client component so we can show the invariant error ("不能停用自己
// 的账号" / "系统至少需要 1 位活跃管理员") inline instead of dropping it.
export function ToggleActiveButton({
  userId,
  currentlyActive,
}: {
  userId: string;
  currentlyActive: boolean;
}) {
  const formId = useId();
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<AccountMutationResult | null, FormData>(
    async () => setUserActiveAction(userId, nextActive),
    null,
  );

  const visibleState = pending ? null : state;
  const error = visibleState?.status === 'error' ? visibleState.message : null;
  const success = visibleState?.status === 'success';

  return (
    <div className="space-y-2">
      <form id={formId} action={formAction} aria-busy={pending} />
      <ActiveStateConfirmButton
        entityLabel="账号"
        currentlyActive={currentlyActive}
        pending={pending}
        formId={formId}
        activateVerb="激活"
        deactivateImpactItems={[
          '该账号将无法继续登录系统',
          '历史工单、任务、薪资与操作记录会继续保留',
          '已有业务记录不会因为停用而改变',
        ]}
        activateImpactItems={[
          '该账号可重新登录系统',
          '历史业务记录不会改变',
        ]}
      />
      {error ? (
        <ActionNotice
          tone="error"
          title={currentlyActive ? '账号停用失败' : '账号激活失败'}
          description={error}
        />
      ) : null}
      {success ? (
        <ActionNotice
          tone="success"
          title={currentlyActive ? '账号已停用' : '账号已激活'}
        />
      ) : null}
    </div>
  );
}
