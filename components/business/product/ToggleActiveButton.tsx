'use client';

import { useActionState, useId } from 'react';
import { withAppliedActive, type AppliedActiveState } from '@/components/business/master-data/applied-active-state';
import { Button } from '@/components/ui/button';
import { ActionNotice, ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';
import { setQuoteProductActiveAction } from '@/actions/owner-products';
import type { ProductMutationResult } from '@/actions/owner-products.types';
import type { ProductReferenceImpact } from '@/lib/product';
import { productActiveChangeImpactItems } from './ProductReferenceImpact';

export function ToggleActiveButton({
  productId,
  currentlyActive,
  impact,
}: {
  productId: string;
  currentlyActive: boolean;
  impact: ProductReferenceImpact;
}) {
  const formId = useId();
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<AppliedActiveState<ProductMutationResult> | null, FormData>(
    async (_previous, formData) =>
      withAppliedActive(await setQuoteProductActiveAction(productId, nextActive, formData), nextActive),
    null,
  );

  const visibleState = pending ? null : state;
  const error =
    visibleState?.status === 'error'
      ? visibleState.message
      : visibleState?.status === 'invalid'
        ? visibleState.fieldErrors.reason?.[0] ?? '请检查操作内容'
        : null;
  const success = visibleState?.status === 'success';

  return (
    <div className="space-y-2">
      <form id={formId} action={formAction} aria-busy={pending} />
      <ConfirmActionController level={currentlyActive ? 'L3' : 'L2'}
        trigger={
          <Button
            variant={currentlyActive ? 'destructive' : 'default'}
            disabled={pending}
          >
            {pending
              ? currentlyActive
                ? '正在停用产品…'
                : '正在启用产品…'
              : currentlyActive
                ? '停用产品'
                : '启用产品'}
          </Button>
        }
        formId={formId}
        reasonLabel="停用理由"
        reasonName="reason"
        reasonPlaceholder="例如：旧款停产，已由新产品替代"
        disabled={pending}>
        <ConfirmActionDialog action={currentlyActive ? '停用产品' : '启用产品'} changes={[]} consequences={productActiveChangeImpactItems(impact, nextActive)} confirmText={currentlyActive ? '确认停用' : '确认启用'} />
      </ConfirmActionController>
      {error ? (
        <ActionNotice
          tone="error"
          title={visibleState?.appliedActive ? '产品启用失败' : '产品停用失败'}
          description={error}
        />
      ) : null}
      {success ? (
        <ActionNotice
          tone="success"
          title={visibleState?.appliedActive ? '产品已启用' : '产品已停用'}
        />
      ) : null}
    </div>
  );
}
