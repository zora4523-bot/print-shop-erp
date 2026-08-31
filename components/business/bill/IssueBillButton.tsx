'use client';

import { useActionState, useId, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  ActionNotice,
  ConfirmActionDialog,
} from '@/components/ui-business';
import { issueBillAction } from '@/actions/bill';
import type { BillMutationResult } from '@/actions/bill.types';

type IssueBillButtonProps = {
  billId: string;
  period: string;
  recipientLabel: string;
  totalAmount: string;
  orderCount: number;
};

export function IssueBillButton({
  billId,
  period,
  recipientLabel,
  totalAmount,
  orderCount,
}: IssueBillButtonProps) {
  const formId = useId();
  const [state, action] = useActionState<BillMutationResult | null, void>(
    async () => issueBillAction(billId),
    null,
  );
  const [pending, startTransition] = useTransition();
  const visibleState = pending ? null : state;

  return (
    <div className="space-y-2" data-risk-level="L2">
      <form
        id={formId}
        action={() => startTransition(() => action())}
        aria-busy={pending}
      />
      <ConfirmActionDialog
        level="L2"
        formId={formId}
        disabled={pending}
        trigger={
          <Button type="button" disabled={pending} aria-busy={pending}>
            {pending ? '正在发单…' : '发单给销售 / 客服'}
          </Button>
        }
        title={`确认发布 ${period} 账单？`}
        description="发单会把草稿转为可收款账单。此状态单向流转，发布后不能退回草稿。"
        impactItems={[
          `接收对象：${recipientLabel}`,
          `当前应收：¥ ${totalAmount}，包含 ${orderCount} 张工单`,
          '发布后可以录入付款；达到应收总额时账单进入已结清终态。',
          '发布后，账单生成流程不会再自动把新完工工单追加到本账单。',
        ]}
        confirmLabel="确认发单"
      />
      {visibleState?.status === 'error' ? (
        <ActionNotice
          tone="error"
          title="账单发布失败"
          description={visibleState.message}
        />
      ) : null}
    </div>
  );
}
