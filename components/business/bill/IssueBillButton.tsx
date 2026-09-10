'use client';

import { useActionState, useId, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  ActionNotice,
  ConfirmActionController, ConfirmActionDialog,
} from '@/components/ui-business';
import { issueBillAction } from '@/actions/bill';
import type { BillMutationResult } from '@/actions/bill.types';
import { formatMoney } from '@/lib/dashboard/format';

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
      <ConfirmActionController level="L2"
        formId={formId}
        disabled={pending}
        trigger={
          <Button type="button" disabled={pending} aria-busy={pending}>
            {pending ? '正在发单…' : '发单给销售 / 客服'}
          </Button>
        }>
        <ConfirmActionDialog action={`确认发布 ${period} 账单？`} changes={[]} consequences={[
          `接收对象：${recipientLabel}`,
          `当前应收：${formatMoney(totalAmount)}，包含 ${orderCount} 张工单`,
          '发布后可以录入付款；达到应收总额时账单进入已结清终态。',
          '发布后本账单保持不变；同月迟到工单会归入新的补充账单。',
        ]} confirmText="确认发单" />
      </ConfirmActionController>
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
