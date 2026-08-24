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
          '该规则不再参与后续新报价的价格计算',
          '已保存报价、工单金额和价格快照不会被追溯改写',
          '规则内容和历史引用会继续保留',
        ]}
        activateImpactItems={[
          '该规则会重新参与后续新报价的价格计算',
          '已保存报价、工单金额和价格快照不会被追溯改写',
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
