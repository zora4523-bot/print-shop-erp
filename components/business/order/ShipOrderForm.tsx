'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { shipOrderAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';

type ShipmentInput = {
  id: string;
  sequence: number;
  receiverName: string | null;
  receiverAddress: string | null;
  trackingNo: string | null;
  weightKg: string | null;
};

// COMPLETED → SHIPPED 的入口。多地址分别记录运单号，业务层会在同一
// 事务里确认这些 shipment 都属于目标工单，再统一切换发货状态。
export function ShipOrderForm({
  orderId,
  shipments,
}: {
  orderId: string;
  shipments: ShipmentInput[];
}) {
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
      <ol className="space-y-3">
        {shipments.map((shipment) => (
          <li
            key={shipment.id}
            className="grid min-w-0 gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.6fr)_minmax(180px,0.6fr)] sm:items-end"
          >
            <div className="admin-wrap-anywhere min-w-0 text-sm">
              <p className="font-medium">地址 {shipment.sequence}</p>
              <p className="text-xs text-muted-foreground">
                {shipment.receiverName ?? '未填收货人'} ·{' '}
                {shipment.receiverAddress ?? '未填地址'}
              </p>
            </div>
            <div>
              <label
                htmlFor={`shipment-${shipment.id}-tracking`}
                className="mb-1 block text-xs font-medium"
              >
                运单号（选填）
              </label>
              <input type="hidden" name="shipmentId" value={shipment.id} />
              <Input
                id={`shipment-${shipment.id}-tracking`}
                type="text"
                name="shipmentTrackingNo"
                defaultValue={shipment.trackingNo ?? ''}
                placeholder="填写该地址的运单号"
                maxLength={64}
              />
            </div>
            <div>
              <label
                htmlFor={`shipment-${shipment.id}-weight`}
                className="mb-1 block text-xs font-medium"
              >
                快递重量（kg）
              </label>
              <Input
                id={`shipment-${shipment.id}-weight`}
                type="text"
                inputMode="decimal"
                name="shipmentWeightKg"
                defaultValue={shipment.weightKg ?? ''}
                placeholder="例如 12.5"
              />
            </div>
          </li>
        ))}
      </ol>
      <Button type="submit" disabled={pending || shipments.length === 0}>
        {pending ? '处理中…' : `确认 ${shipments.length} 个地址已发货`}
      </Button>
      {state?.status === 'error' ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
      {state?.status === 'invalid' ? (
        <p role="alert" className="text-xs text-destructive">
          {Object.values(state.fieldErrors).flat().join('；')}
        </p>
      ) : null}
    </form>
  );
}
