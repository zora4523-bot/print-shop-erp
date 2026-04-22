'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { setUserActiveAction } from '@/actions/owner-accounts';
import type { AccountMutationResult } from '@/actions/owner-accounts.types';

// Small client component so we can show the invariant error ("不能停用自己
// 的账号" / "系统至少需要 1 位活跃 OWNER") inline instead of dropping it.
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

  const error = state?.status === 'error' ? state.message : null;

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <Button
          type="submit"
          variant={currentlyActive ? 'destructive' : 'default'}
          disabled={pending}
        >
          {pending ? '…' : currentlyActive ? '停用账号' : '激活账号'}
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
