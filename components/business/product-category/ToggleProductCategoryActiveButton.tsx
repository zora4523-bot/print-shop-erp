'use client';

import { useActionState, useId } from 'react';
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
    ProductCategoryNodeMutationResult | null,
    FormData
  >(async () => setProductCategoryNodeActiveAction(nodeId, nextActive), null);

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
          '新建可建单组合和 BOM 不可选择该分类',
          '已有产品、BOM、工单和分类层级保留',
        ]}
      />
      {error ? (
        <ActionNotice tone="error" title="分类状态更新失败" description={error} />
      ) : null}
      {success ? (
        <ActionNotice
          tone="success"
          title={currentlyActive ? '分类已停用' : '分类已启用'}
        />
      ) : null}
    </div>
  );
}
