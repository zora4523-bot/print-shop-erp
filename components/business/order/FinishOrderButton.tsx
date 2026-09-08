'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';
import { finishOrderAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';

export const finishOrderImpactItems = [
  '确认后工单完成且不能恢复。',
  '工单不再接受生产或发货操作。',
  '历史金额、状态和操作记录仍会保留。',
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
      <ConfirmActionController level="L2"
        open={confirmationOpen}
        onOpenChange={setConfirmationOpen}
        focusReturnRef={triggerRef}
        disabled={pending}
        onConfirm={confirmFinish}>
        <ConfirmActionDialog action="关闭工单并标记为已完成" changes={[]} consequences={finishOrderImpactItems} confirmText="关闭并完成" />
      </ConfirmActionController>
      {visibleState?.status === 'error' ? (
        <p role="alert" className="text-xs text-destructive">
          {visibleState.message}
        </p>
      ) : null}
    </form>
  );
}
