'use client';

import { useActionState, useState } from 'react';
import { createOrderChangeRequestAction } from '@/actions/order';
import type { CreateOrderChangeRequestMutationResult } from '@/actions/order.types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  orderId: string;
  expectedRevision: number;
  expectedWorkOrderVersion: number;
};

export function buildOrderCancellationRequestPayload({
  orderId,
  expectedRevision,
  expectedWorkOrderVersion,
  reason,
}: Props & { reason: string }) {
  return {
    orderId,
    expectedRevision,
    expectedWorkOrderVersion,
    type: 'CANCEL' as const,
    reason,
    items: [],
  };
}

export function OrderCancellationRequestForm({
  orderId,
  expectedRevision,
  expectedWorkOrderVersion,
}: Props) {
  const [reason, setReason] = useState('');
  const [state, action, pending] = useActionState<
    CreateOrderChangeRequestMutationResult | null,
    unknown
  >(createOrderChangeRequestAction, null);

  if (state?.status === 'success') {
    return (
      <p
        role="status"
        className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm"
      >
        取消申请已提交；工单仍保留，管理员裁决前不会改变生产或结算事实。
      </p>
    );
  }
  const error =
    state?.status === 'error'
      ? state.message
      : state?.status === 'invalid'
        ? Object.values(state.fieldErrors).flat()[0]
        : null;

  return (
    <form
      className="space-y-3"
      aria-busy={pending}
      action={() =>
        action(buildOrderCancellationRequestPayload({
          orderId,
          expectedRevision,
          expectedWorkOrderVersion,
          reason,
        }))
      }
    >
      <label className="block space-y-1 text-sm">
        <span className="font-medium">取消原因</span>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={500}
          required
          disabled={pending}
          className="w-full"
          placeholder="说明取消原因，生产中订单由管理员核对已产数量并裁决"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="destructive"
        disabled={pending || reason.trim().length === 0}
      >
        {pending ? '正在提交…' : '提交取消申请'}
      </Button>
    </form>
  );
}
