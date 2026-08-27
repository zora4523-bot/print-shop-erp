'use client';

import { useActionState, useId } from 'react';
import { cancelPurchaseOrderAction } from '@/actions/owner-purchases';
import type { PurchaseMutationResult } from '@/actions/owner-purchases.types';
import { Button } from '@/components/ui/button';
import { ActionNotice, ConfirmActionDialog } from '@/components/ui-business';

export type PurchaseOrderCancelItem = {
  materialCode: string;
  materialName: string;
  quantity: string;
  unit: string;
};

export function purchaseOrderCancelImpactItems({
  purchaseNo,
  supplierName,
  items,
}: {
  purchaseNo: string;
  supplierName: string;
  items: readonly PurchaseOrderCancelItem[];
}): string[] {
  return [
    `采购单 ${purchaseNo}（供应商：${supplierName}）将从“已下单”变为“已取消”，且不能再继续收货。`,
    ...items.map(
      (item) =>
        `停止收货：${item.materialName}（${item.materialCode}）${item.quantity} ${item.unit}。`,
    ),
    '本操作不会删除采购单，也不会写入库存流水。',
    '已有收货明细时不可取消；需先取消收货过账。',
  ];
}

export function CancelPurchaseOrderButton({
  purchaseOrderId,
  purchaseNo,
  supplierName,
  items,
}: {
  purchaseOrderId: string;
  purchaseNo: string;
  supplierName: string;
  items: readonly PurchaseOrderCancelItem[];
}) {
  const formId = useId();
  const [state, formAction, pending] = useActionState<
    PurchaseMutationResult | null,
    FormData
  >(async () => cancelPurchaseOrderAction(purchaseOrderId), null);

  const visibleState = pending ? null : state;
  const error =
    visibleState?.status === 'error'
      ? visibleState.message
      : visibleState?.status === 'invalid'
        ? Object.values(visibleState.fieldErrors).flat()[0] ?? '请检查操作内容'
        : null;
  const success =
    visibleState?.status === 'success'
      ? visibleState.message ?? '采购单已取消'
      : null;

  return (
    <div className="space-y-3">
      <form id={formId} action={formAction} aria-busy={pending} />
      <ConfirmActionDialog
        level="L2"
        trigger={
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            className="min-h-11"
          >
            {pending ? '正在取消采购单…' : '取消采购单'}
          </Button>
        }
        title={`取消采购单 ${purchaseNo}？`}
        description="这是单向状态变更。请核对供应商和全部采购明细后再继续。"
        impactItems={purchaseOrderCancelImpactItems({
          purchaseNo,
          supplierName,
          items,
        })}
        confirmLabel="确认取消采购单"
        formId={formId}
        disabled={pending}
      />
      {error ? (
        <ActionNotice
          tone="error"
          title="采购单取消失败"
          description={error}
        />
      ) : null}
      {success ? <ActionNotice tone="success" title={success} /> : null}
    </div>
  );
}
