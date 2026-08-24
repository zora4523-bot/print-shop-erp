'use client';

import { useActionState } from 'react';
import { ActionNotice, PendingButton } from '@/components/ui-business';
import { setMaterialActiveAction } from '@/actions/owner-materials';
import type { MaterialMutationResult } from '@/actions/owner-materials.types';

export function ToggleMaterialActiveButton({
  materialId,
  currentlyActive,
}: {
  materialId: string;
  currentlyActive: boolean;
}) {
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<
    MaterialMutationResult | null,
    FormData
  >(async () => setMaterialActiveAction(materialId, nextActive), null);

  const visibleState = pending ? null : state;
  const error = visibleState?.status === 'error' ? visibleState.message : null;
  const success = visibleState?.status === 'success';

  return (
    <div className="space-y-2">
      <form action={formAction} aria-busy={pending}>
        <PendingButton
          pending={pending}
          pendingLabel={currentlyActive ? '正在停用物料…' : '正在启用物料…'}
          variant={currentlyActive ? 'destructive' : 'default'}
        >
          {currentlyActive ? '停用物料' : '启用物料'}
        </PendingButton>
      </form>
      {error ? (
        <ActionNotice
          tone="error"
          title={currentlyActive ? '物料停用失败' : '物料启用失败'}
          description={error}
        />
      ) : null}
      {success ? (
        <ActionNotice
          tone="success"
          title={currentlyActive ? '物料已停用' : '物料已启用'}
        />
      ) : null}
    </div>
  );
}
