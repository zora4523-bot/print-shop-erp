'use client';

import { useActionState, useId } from 'react';
import { setPriceAdjustmentActiveAction } from '@/actions/owner-prices';
import type { PriceMutationResult } from '@/actions/owner-prices.types';
import { ActionNotice } from '@/components/ui-business';
import { ActiveStateConfirmButton } from '@/components/business/master-data/ActiveStateConfirmButton';

export function TogglePriceAdjustmentActiveButton({
  adjustmentId,
  currentlyActive,
}: {
  adjustmentId: string;
  currentlyActive: boolean;
}) {
  const formId = useId();
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<
    PriceMutationResult | null,
    FormData
  >(async () => setPriceAdjustmentActiveAction(adjustmentId, nextActive), null);

  const visibleState = pending ? null : state;
  const error = visibleState?.status === 'error' ? visibleState.message : null;
  const success = visibleState?.status === 'success';

  return (
    <div className="space-y-2">
      <form id={formId} action={formAction} aria-busy={pending} />
      <ActiveStateConfirmButton
        entityLabel="加价规则"
        currentlyActive={currentlyActive}
        pending={pending}
        formId={formId}
        deactivateImpactItems={[
          '停用后，新报价不再使用该规则',
          '已保存价格和工单金额不变',
          '规则及历史记录保留',
        ]}
        activateImpactItems={[
          '启用后，新报价使用该规则',
          '已保存价格和工单金额不变',
        ]}
      />
      {error ? (
        <ActionNotice tone="error" title="加价规则状态更新失败" description={error} />
      ) : null}
      {success ? (
        <ActionNotice
          tone="success"
          title={currentlyActive ? '加价规则已停用' : '加价规则已启用'}
        />
      ) : null}
    </div>
  );
}
