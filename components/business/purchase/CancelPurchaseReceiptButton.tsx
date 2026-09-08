'use client';

import { useActionState, useId } from 'react';
import { cancelPurchaseReceiptAction } from '@/actions/owner-purchases';
import type { PurchaseMutationResult } from '@/actions/owner-purchases.types';
import { Button } from '@/components/ui/button';
import { ActionNotice, ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';

export type PurchaseReceiptCancelItem = {
  materialCode: string;
  materialName: string;
  quantity: string;
  unit: string;
};

export function purchaseReceiptCancelImpactItems({
  receiptNo,
  purchaseNo,
  items,
}: {
  receiptNo: string;
  purchaseNo: string;
  items: readonly PurchaseReceiptCancelItem[];
}): string[] {
  return [
    `收货单 ${receiptNo} 将变为“已取消”，取消理由会保存在该收货单上。`,
    ...items.map(
      (item) =>
        `反向出库：${item.materialName}（${item.materialCode}）${item.quantity} ${item.unit}。`,
    ),
    `采购单 ${purchaseNo} 的已收货数量会同步扣回，并按剩余已收数量重新计算采购单状态。`,
    '系统会写入与原收货对应的反向库存流水；若库存不足以扣回，整个操作会失败。',
    '反向出库若让库存跌破安全线，可能触发库存预警通知。',
  ];
}

export function CancelPurchaseReceiptButton({
  receiptId,
  receiptNo,
  purchaseNo,
  items,
}: {
  receiptId: string;
  receiptNo: string;
  purchaseNo: string;
  items: readonly PurchaseReceiptCancelItem[];
}) {
  const formId = useId();
  const [state, formAction, pending] = useActionState<
    PurchaseMutationResult | null,
    FormData
  >(cancelPurchaseReceiptAction.bind(null, receiptId), null);

  const visibleState = pending ? null : state;
  const error =
    visibleState?.status === 'error'
      ? visibleState.message
      : visibleState?.status === 'invalid'
        ? visibleState.fieldErrors.reason?.[0] ?? '请检查取消理由'
        : null;
  const success =
    visibleState?.status === 'success'
      ? visibleState.message ?? '收货单已取消'
      : null;

  return (
    <div className="space-y-3">
      <form id={formId} action={formAction} aria-busy={pending} />
      <ConfirmActionController level="L3"
        trigger={
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            className="min-h-11"
          >
            {pending ? '正在取消收货过账…' : '取消收货过账'}
          </Button>
        }
        formId={formId}
        reasonLabel="取消理由"
        reasonName="reason"
        reasonPlaceholder="例如：供应商送错物料，已确认退回"
        disabled={pending}>
        <ConfirmActionDialog action={`取消收货单 ${receiptNo} 的过账？`} changes={[]} consequences={purchaseReceiptCancelImpactItems({
          receiptNo,
          purchaseNo,
          items,
        })} confirmText="确认取消并反向出库" />
      </ConfirmActionController>
      {error ? (
        <ActionNotice
          tone="error"
          title="收货过账取消失败"
          description={error}
        />
      ) : null}
      {success ? <ActionNotice tone="success" title={success} /> : null}
    </div>
  );
}
