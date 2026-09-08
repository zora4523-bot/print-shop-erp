'use client';

import { useActionState, useId } from 'react';
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
  const [state, formAction, pending] = useActionState<ProductMutationResult | null, FormData>(
    async (_previous, formData) =>
      setQuoteProductActiveAction(productId, nextActive, formData),
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
                ? '正在停用组合…'
                : '正在启用组合…'
              : currentlyActive
                ? '停用组合'
                : '启用组合'}
          </Button>
        }
        formId={formId}
        reasonLabel="停用理由"
        reasonName="reason"
        reasonPlaceholder="例如：旧款停产，已由新产品替代"
        disabled={pending}>
        <ConfirmActionDialog action={currentlyActive ? '停用该组合？' : '重新启用该组合？'} changes={[]} consequences={productActiveChangeImpactItems(impact, nextActive)} confirmText={currentlyActive ? '确认停用' : '确认启用'} />
      </ConfirmActionController>
      {error ? (
        <ActionNotice
          tone="error"
          title={currentlyActive ? '组合停用失败' : '组合启用失败'}
          description={error}
        />
      ) : null}
      {success ? (
        <ActionNotice
          tone="success"
          title={currentlyActive ? '组合已停用' : '组合已启用'}
        />
      ) : null}
    </div>
  );
}
