'use client';

import { useActionState, useId } from 'react';
import { withAppliedActive, type AppliedActiveState } from '@/components/business/master-data/applied-active-state';
import { setProductCategoryNodeActiveAction } from '@/actions/owner-product-categories';
import type { ProductCategoryNodeMutationResult } from '@/actions/owner-product-categories.types';
import { ActionNotice } from '@/components/ui-business';
import { ActiveStateConfirmButton } from '@/components/business/master-data/ActiveStateConfirmButton';

export function ToggleProductCategoryActiveButton({
  nodeId,
  currentlyActive,
}: {
  nodeId: string;
  currentlyActive: boolean;
}) {
  const formId = useId();
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<
    AppliedActiveState<ProductCategoryNodeMutationResult> | null,
    FormData
  >(async () => withAppliedActive(await setProductCategoryNodeActiveAction(nodeId, nextActive), nextActive), null);

  const visibleState = pending ? null : state;
  const error = visibleState?.status === 'error' ? visibleState.message : null;
  const success = visibleState?.status === 'success';

  return (
    <div className="space-y-2">
      <form id={formId} action={formAction} aria-busy={pending} />
      <ActiveStateConfirmButton
        entityLabel="分类"
        currentlyActive={currentlyActive}
        pending={pending}
        formId={formId}
        deactivateImpactItems={[
          '新建产品资料和 BOM 不可选择该分类',
          '已有产品、BOM、工单和分类层级保留',
        ]}
      />
      {error ? (
        <ActionNotice tone="error" title="分类状态更新失败" description={error} />
      ) : null}
      {success ? (
        <ActionNotice
          tone="success"
          title={visibleState?.appliedActive ? '分类已启用' : '分类已停用'}
        />
      ) : null}
    </div>
  );
}
