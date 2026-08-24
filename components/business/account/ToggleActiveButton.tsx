'use client';

import { useActionState } from 'react';
import { ActionNotice, PendingButton } from '@/components/ui-business';
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
      <form action={formAction} aria-busy={pending}>
        <PendingButton
          pending={pending}
          pendingLabel={currentlyActive ? '正在停用账号…' : '正在激活账号…'}
          variant={currentlyActive ? 'destructive' : 'default'}
        >
          {currentlyActive ? '停用账号' : '激活账号'}
        </PendingButton>
      </form>
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
