'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmActionDialog } from '@/components/ui-business';
import { finishOrderAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';

export const finishOrderImpactItems = [
  '工单将从 SHIPPED（已发货）进入 FINISHED（已完成）终态；该状态不可回退。',
  '工单业务台账（ledger）将关闭，不再接受后续生产或发货处理。',
  '工单将退出活跃工作区；历史金额、状态和审计记录仍会保留。',
] as const;

// SHIPPED → FINISHED 终态收尾。无额外字段。
export function FinishOrderButton({ orderId }: { orderId: string }) {
  const [state, action] = useActionState<OrderMutationResult | null, void>(
    async () => finishOrderAction(orderId),
    null,
  );
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const visibleState = pending ? null : state;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setConfirmationOpen(true);
  }

  function confirmFinish() {
    if (pending) return;
    startTransition(() => action());
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={pending} className="space-y-2">
      <Button
        ref={triggerRef}
        type="submit"
        disabled={pending}
        aria-haspopup="dialog"
        aria-expanded={confirmationOpen}
      >
        {pending ? '处理中…' : '确认完工'}
      </Button>
      <ConfirmActionDialog
        level="L2"
        open={confirmationOpen}
        onOpenChange={setConfirmationOpen}
        focusReturnRef={triggerRef}
        disabled={pending}
        title="确认关闭工单并标记为已完成？"
        description="这是工单生命周期的最终收尾。只有点击下方确认按钮后，系统才会提交终态变更。"
        impactItems={finishOrderImpactItems}
        confirmLabel="确认关闭并完成"
        onConfirm={confirmFinish}
      />
      {visibleState?.status === 'error' ? (
        <p role="alert" className="text-xs text-destructive">
          {visibleState.message}
        </p>
      ) : null}
    </form>
  );
}
