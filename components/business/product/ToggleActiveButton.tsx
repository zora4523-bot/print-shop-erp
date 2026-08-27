'use client';

import { useActionState, useId } from 'react';
import { Button } from '@/components/ui/button';
import { ActionNotice, ConfirmActionDialog } from '@/components/ui-business';
import { setProductActiveAction } from '@/actions/owner-products';
import type { ProductMutationResult } from '@/actions/owner-products.types';
import type { ProductReferenceImpact } from '@/lib/product';
import { productActiveChangeImpactItems } from './ProductReferenceImpact';

export function ToggleActiveButton({
  productId,
  currentlyActive,
  impact,
  action = setProductActiveAction,
}: {
  productId: string;
  currentlyActive: boolean;
  impact: ProductReferenceImpact;
  action?: (
    id: string,
    isActive: boolean,
    formData?: FormData,
  ) => Promise<ProductMutationResult>;
}) {
  const formId = useId();
  const nextActive = !currentlyActive;
  const [state, formAction, pending] = useActionState<ProductMutationResult | null, FormData>(
    async (_previous, formData) =>
      action(productId, nextActive, formData),
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
      <ConfirmActionDialog
        level={currentlyActive ? 'L3' : 'L2'}
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
        title={currentlyActive ? '停用该产品？' : '重新启用该产品？'}
        description={
          currentlyActive
            ? '停用后，该产品不能用于新建工单和新报价。请核对下列引用并填写停用理由。'
            : '启用后，该产品可重新用于新建工单和新报价。请核对下列影响。'
        }
        impactItems={productActiveChangeImpactItems(impact, nextActive)}
        confirmLabel={currentlyActive ? '确认停用' : '确认启用'}
        formId={formId}
        reasonLabel="停用理由"
        reasonName="reason"
        reasonPlaceholder="例如：旧款停产，已由新产品替代"
        disabled={pending}
      />
      {error ? (
        <ActionNotice
          tone="error"
          title={currentlyActive ? '产品停用失败' : '产品启用失败'}
          description={error}
        />
      ) : null}
      {success ? (
        <ActionNotice
          tone="success"
          title={currentlyActive ? '产品已停用' : '产品已启用'}
        />
      ) : null}
    </div>
  );
}
