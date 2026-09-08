'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { shipOrderAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';
import { Button } from '@/components/ui/button';
import { ActionNotice, ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';
import {
  ShipOrderShipmentFields,
  ShipOrderVersionFields,
  type ShipmentInput,
} from '@/components/business/order/ShipOrderFields';

type ShipOrderConfirmationValues = {
  trackingNos?: readonly string[];
  shippingFees?: readonly string[];
  packingMaterialFees?: readonly string[];
};

function confirmationAmount(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized ? `¥${normalized}` : '待填写';
}

export function shipOrderImpactItems({
  shipments,
  isExternalSales,
  isSfCollect,
  values = {},
}: {
  shipments: readonly ShipmentInput[];
  isExternalSales: boolean;
  isSfCollect: boolean;
  values?: ShipOrderConfirmationValues;
}): string[] {
  const shipmentItems = shipments.map((shipment, index) => {
    const trackingNo =
      values.trackingNos?.[index]?.trim() ||
      shipment.trackingNo?.trim() ||
      '未填写';
    const receiver = shipment.receiverName?.trim() || '未填收货人';
    if (!isExternalSales) {
      return `地址 ${shipment.sequence}（${receiver}）：运单号 ${trackingNo}，将标记为已发货。`;
    }

    const shippingFee = isSfCollect
      ? '¥0.00（顺丰到付）'
      : confirmationAmount(
          values.shippingFees?.[index] ?? shipment.shippingFee,
        );
    const packingFee = confirmationAmount(
      values.packingMaterialFees?.[index] ?? shipment.packingMaterialFee,
    );
    return `地址 ${shipment.sequence}（${receiver}）：运单号 ${trackingNo}，对客快递费 ${shippingFee}，打包耗材费 ${packingFee}。`;
  });

  return [
    ...shipmentItems,
    isExternalSales
      ? '发货后，快递费和耗材费将按工单创建时价格核价，转为最终收费并重算应收总额。'
      : '本次发货不处理对客快递费或耗材费。',
    '发货后仍需管理员完成结算。',
    '本次发货不会扣减库存。',
  ];
}

export async function submitShipOrderWithRecovery(
  orderId: string,
  previousState: OrderMutationResult | null,
  formData: FormData,
): Promise<OrderMutationResult> {
  try {
    return await shipOrderAction(orderId, previousState, formData);
  } catch {
    return {
      status: 'error',
      message: '发货请求未完成，请刷新工单后重试。',
    };
  }
}

// COMPLETED → SHIPPED 的入口。多地址分别记录运单号，业务层会在同一
// 事务里确认这些 shipment 都属于目标工单，再统一切换发货状态。
export function ShipOrderForm({
  orderId,
  expectedRevision,
  expectedEditVersion,
  expectedWorkOrderVersion,
  expectedPriceRevision,
  initialIdempotencyKey,
  shipments,
  isExternalSales,
  isSfCollect,
  onSuccess,
}: {
  orderId: string;
  expectedRevision: number;
  expectedEditVersion: number;
  expectedWorkOrderVersion: number;
  expectedPriceRevision: number;
  initialIdempotencyKey: string;
  shipments: ShipmentInput[];
  isExternalSales: boolean;
  isSfCollect: boolean;
  onSuccess?: () => void;
}) {
  const [state, action] = useActionState<OrderMutationResult | null, FormData>(
    (previousState, formData) =>
      submitShipOrderWithRecovery(orderId, previousState, formData),
    null,
  );
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const requestIdentityRef = useRef({
    fingerprint: null as string | null,
    key: initialIdempotencyKey,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationImpactItems, setConfirmationImpactItems] = useState(() =>
    shipOrderImpactItems({ shipments, isExternalSales, isSfCollect }),
  );
  const visibleState = pending ? null : state;
  useEffect(() => {
    if (state?.status === 'success') onSuccess?.();
  }, [state, onSuccess]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || state?.status === 'success') return;
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;

    const formData = new FormData(form);
    setConfirmationImpactItems(
      shipOrderImpactItems({
        shipments,
        isExternalSales,
        isSfCollect,
        values: {
          trackingNos: formData
            .getAll('shipmentTrackingNo')
            .map((value) => String(value)),
          shippingFees: formData
            .getAll('shipmentShippingFee')
            .map((value) => String(value)),
          packingMaterialFees: formData
            .getAll('shipmentPackingMaterialFee')
            .map((value) => String(value)),
        },
      }),
    );
    setConfirmationOpen(true);
  }

  function confirmShipment() {
    if (pending || state?.status === 'success') return;
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    const fingerprint = shipOrderFormFingerprint(formData);
    if (
      requestIdentityRef.current.fingerprint !== null &&
      requestIdentityRef.current.fingerprint !== fingerprint
    ) {
      requestIdentityRef.current.key = globalThis.crypto.randomUUID();
    }
    requestIdentityRef.current.fingerprint = fingerprint;
    formData.set('idempotencyKey', requestIdentityRef.current.key);
    startTransition(() => action(formData));
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="space-y-2"
    >
      <ShipOrderVersionFields
        expectedRevision={expectedRevision}
        expectedEditVersion={expectedEditVersion}
        expectedWorkOrderVersion={expectedWorkOrderVersion}
        expectedPriceRevision={expectedPriceRevision}
        initialIdempotencyKey={initialIdempotencyKey}
      />
      <ShipOrderShipmentFields
        shipments={shipments}
        isExternalSales={isExternalSales}
        isSfCollect={isSfCollect}
        result={visibleState}
      />
      <Button
        ref={triggerRef}
        type="submit"
        disabled={pending || state?.status === 'success' || shipments.length === 0}
        aria-busy={pending}
      >
        {pending ? '处理中…' : state?.status === 'success' ? '已发货' : `确认 ${shipments.length} 个地址已发货`}
      </Button>
      <ConfirmActionController level="L2"
        open={confirmationOpen}
        onOpenChange={setConfirmationOpen}
        focusReturnRef={triggerRef}
        disabled={pending || shipments.length === 0}
        onConfirm={confirmShipment}>
        <ConfirmActionDialog action={`确认 ${shipments.length} 个地址已发货？`} changes={[]} consequences={confirmationImpactItems} confirmText={
          isExternalSales ? '确认发货并重算应收' : '确认标记已发货'
        } />
      </ConfirmActionController>
      {visibleState?.status === 'success' ? <ActionNotice tone="success" title="工单已发货" /> : null}
      {visibleState?.status === 'error' ? (
        <p role="alert" className="text-xs text-destructive">
          {visibleState.message}
        </p>
      ) : null}
      {visibleState?.status === 'invalid' ? (
        <p role="alert" className="text-xs text-destructive">
          {Object.values(visibleState.fieldErrors).flat().join('；')}
        </p>
      ) : null}
    </form>
  );
}

export function shipOrderFormFingerprint(formData: FormData): string {
  return JSON.stringify(
    [...formData.entries()]
      .filter(([name]) => name !== 'idempotencyKey')
      .map(([name, value]) => [name, String(value)]),
  );
}
