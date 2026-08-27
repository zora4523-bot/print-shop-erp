'use client';

import { useActionState, useId } from 'react';
import { ActionNotice } from '@/components/ui-business';
import { ActiveStateConfirmButton } from '@/components/business/master-data/ActiveStateConfirmButton';
import { setMaterialActiveAction } from '@/actions/owner-materials';
import type { MaterialMutationResult } from '@/actions/owner-materials.types';

export function ToggleMaterialActiveButton({
  materialId,
  currentlyActive,
  action = setMaterialActiveAction,
}: {
  materialId: string;
  currentlyActive: boolean;
  action?: (
    id: string,
    isActive: boolean,
  ) => Promise<MaterialMutationResult>;
}) {
  const formId = useId();
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<
    MaterialMutationResult | null,
    FormData
  >(async () => action(materialId, nextActive), null);

  const visibleState = pending ? null : state;
  const error = visibleState?.status === 'error' ? visibleState.message : null;
  const success = visibleState?.status === 'success';

  return (
    <div className="space-y-2">
      <form id={formId} action={formAction} aria-busy={pending} />
      <ActiveStateConfirmButton
        entityLabel="物料"
        currentlyActive={currentlyActive}
        pending={pending}
        formId={formId}
        deactivateImpactItems={[
          '该物料不再出现在新的采购、BOM 和库存作业选择中',
          '现有库存数量、成本和历史流水不会删除',
          '已有 BOM 与历史单据引用会继续保留',
        ]}
      />
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
