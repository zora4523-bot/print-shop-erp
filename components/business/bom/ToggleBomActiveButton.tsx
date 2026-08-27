'use client';

import { useActionState, useId } from 'react';
import { setBomActiveAction } from '@/actions/owner-boms';
import type { BomMutationResult } from '@/actions/owner-boms.types';
import { ActionNotice } from '@/components/ui-business';
import { ActiveStateConfirmButton } from '@/components/business/master-data/ActiveStateConfirmButton';

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
  const formId = useId();
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<
    BomMutationResult | null,
    FormData
  >(async () => setBomActiveAction(bomId, nextActive), null);

  // Surface BOTH the invariant/error message AND any invalid field
  // errors — setBomActiveAction can return either shape, and a toggle
  // that failed must never look like it succeeded.
  const visibleState = pending ? null : state;
  const error =
    visibleState?.status === 'error'
      ? visibleState.message
      : visibleState?.status === 'invalid'
        ? Object.values(visibleState.fieldErrors).flat().join('；')
        : null;
  const success = visibleState?.status === 'success';

  return (
    <div className="space-y-2">
      <form id={formId} action={formAction} aria-busy={pending} />
      <ActiveStateConfirmButton
        entityLabel="BOM"
        currentlyActive={currentlyActive}
        pending={pending}
        formId={formId}
        deactivateImpactItems={[
          '该 BOM 不再用于新的物料需求和生产计算',
          '历史工单与物料记录中的 BOM 引用会继续保留',
          'BOM 明细保留',
        ]}
        activateImpactItems={[
          '该 BOM 会重新参与新的物料需求和生产计算',
          '关联产品或分类必须处于启用状态',
          '同一产品或分类不能同时存在另一份启用 BOM',
        ]}
      />
      {error ? (
        <ActionNotice tone="error" title="BOM 状态更新失败" description={error} />
      ) : null}
      {success ? (
        <ActionNotice
          tone="success"
          title={currentlyActive ? 'BOM 已停用' : 'BOM 已启用'}
        />
      ) : null}
    </div>
  );
}
