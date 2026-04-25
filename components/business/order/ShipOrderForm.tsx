'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { shipOrderAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';

// COMPLETED → SHIPPED 的入口。运单号选填——纸单 / 快递包裹场景下
// 写一个 truck/express tracking number 进 Order.trackingNo，没有则
// 跳过，OrderLog 会记录"标记发货"。
export function ShipOrderForm({ orderId }: { orderId: string }) {
  const bound = shipOrderAction.bind(null, orderId);
  const [state, action] = useActionState<OrderMutationResult | null, FormData>(
    bound,
    null,
  );
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => startTransition(() => action(fd))}
      className="space-y-2"
    >
      <div className="flex items-center gap-3">
        <Input
          type="text"
          name="trackingNo"
          placeholder="运单号（选填）"
          maxLength={64}
          className="max-w-[240px]"
        />
        <Button type="submit" disabled={pending}>
          {pending ? '处理中…' : '标记发货'}
        </Button>
      </div>
      {state?.status === 'error' ? (
        <p className="text-xs text-destructive">{state.message}</p>
      ) : null}
      {state?.status === 'invalid' ? (
        <p className="text-xs text-destructive">
          {Object.values(state.fieldErrors).flat().join('；')}
        </p>
      ) : null}
    </form>
  );
}
