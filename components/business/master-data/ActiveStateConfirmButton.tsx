'use client';

import { Button } from '@/components/ui/button';
import { ConfirmActionDialog } from '@/components/ui-business';

export type ActiveStateConfirmButtonProps = {
  entityLabel: string;
  currentlyActive: boolean;
  pending: boolean;
  formId: string;
  deactivateImpactItems: readonly string[];
  activateImpactItems?: readonly string[];
  deactivateDescription?: string;
  activateDescription?: string;
  deactivateVerb?: string;
  activateVerb?: string;
};

/**
 * Shared L2 guard for active-state changes whose current server contract does
 * not accept an audit reason. It prevents direct execution without inventing
 * a new L3 field or changing the underlying mutation contract.
 */
export function ActiveStateConfirmButton({
  entityLabel,
  currentlyActive,
  pending,
  formId,
  deactivateImpactItems,
  activateImpactItems = [
    `${entityLabel}会重新出现在可选项中`,
    '历史业务记录不会改变',
  ],
  deactivateDescription = '停用不是删除。请先核对影响范围，服务器仍会执行现有业务约束校验。',
  activateDescription = '启用后，该对象会重新参与后续业务选择。',
  deactivateVerb = '停用',
  activateVerb = '启用',
}: ActiveStateConfirmButtonProps) {
  const actionLabel = currentlyActive
    ? `${deactivateVerb}${entityLabel}`
    : `${activateVerb}${entityLabel}`;

  return (
    <ConfirmActionDialog
      level="L2"
      trigger={
        <Button
          variant={currentlyActive ? 'destructive' : 'default'}
          disabled={pending}
          aria-busy={pending}
          className="min-h-11"
        >
          {pending ? `正在${actionLabel}…` : actionLabel}
        </Button>
      }
      title={`确认${actionLabel}？`}
      description={
        currentlyActive ? deactivateDescription : activateDescription
      }
      impactItems={
        currentlyActive ? deactivateImpactItems : activateImpactItems
      }
      confirmLabel={`确认${actionLabel}`}
      formId={formId}
      disabled={pending}
    />
  );
}
