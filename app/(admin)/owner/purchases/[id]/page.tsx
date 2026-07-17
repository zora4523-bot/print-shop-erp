import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { PurchaseOrderStatus, PurchaseReceiptStatus } from '../../../../../generated/prisma/enums';
import { createPurchaseReceiptAction } from '@/actions/owner-purchases';
import { CancelPurchaseOrderButton } from '@/components/business/purchase/CancelPurchaseOrderButton';
import { CancelPurchaseReceiptButton } from '@/components/business/purchase/CancelPurchaseReceiptButton';
import { PurchaseReceiptForm } from '@/components/business/purchase/PurchaseReceiptForm';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import {
  getPurchaseOrderDetail,
  PURCHASE_ORDER_STATUS_LABELS,
  PURCHASE_RECEIPT_STATUS_LABELS,
} from '@/lib/purchase';
import { listActiveWarehouseLocationOptions } from '@/lib/warehouse';

type PageProps = { params: Promise<{ id: string }> };

function decimal(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return String(value);
}

function remaining(quantity: unknown, received: unknown): string {
  return new Decimal(String(quantity ?? 0))
    .minus(new Decimal(String(received ?? 0)))
    .toFixed(2);
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const order = await getPurchaseOrderDetail(id);
  return {
    title: order ? `${order.purchaseNo} · 采购单` : '采购单不存在',
  };
}

export default async function OwnerPurchaseDetailPage({ params }: PageProps) {
  await requirePermission('purchase:manage');
  const { id } = await params;
  const [order, locationOptions] = await Promise.all([
    getPurchaseOrderDetail(id),
    listActiveWarehouseLocationOptions(),
  ]);
  if (!order) notFound();

  const boundReceiptAction = createPurchaseReceiptAction.bind(null, order.id);
  const canReceive =
    order.status !== PurchaseOrderStatus.CANCELLED &&
    order.status !== PurchaseOrderStatus.RECEIVED;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`采购单：${order.purchaseNo}`}
        subtitle={`${order.supplierName} · ${order.supplierCode}`}
        actions={
          <Badge variant="outline">
            {PURCHASE_ORDER_STATUS_LABELS[order.status]}
          </Badge>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">采购明细</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3">物料</th>
                <th className="py-2 pr-3 text-right">采购数量</th>
                <th className="py-2 pr-3 text-right">已收货</th>
                <th className="py-2 pr-3 text-right">剩余</th>
                <th className="py-2 pr-3 text-right">单位成本</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="py-3 pr-3">
                    <div className="font-medium">{item.material.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {item.material.code}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-right font-mono text-xs">
                    {decimal(item.quantity)} {item.material.unit}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono text-xs">
                    {decimal(item.receivedQuantity)} {item.material.unit}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono text-xs">
                    {remaining(item.quantity, item.receivedQuantity)} {item.material.unit}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono text-xs">
                    {decimal(item.unitCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canReceive ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold">采购收货过账</h2>
          <div className="space-y-5">
            {order.items.map((item) => {
              const remain = remaining(item.quantity, item.receivedQuantity);
              if (new Decimal(remain).lte(0)) return null;
              return (
                <div key={item.id} className="rounded-lg border p-4">
                  <div className="mb-3 text-sm font-medium">
                    {item.material.name} · 剩余 {remain} {item.material.unit}
                  </div>
                  <PurchaseReceiptForm
                    action={boundReceiptAction}
                    purchaseOrderItemId={item.id}
                    unit={item.material.unit}
                    defaultUnitCost={item.unitCost ? String(item.unitCost) : null}
                    remainingQuantity={remain}
                    locationOptions={locationOptions}
                    initialIdempotencyKey={randomUUID()}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">收货记录</h2>
        {order.receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无收货记录。</p>
        ) : (
          <div className="space-y-4">
            {order.receipts.map((receipt) => (
              <div key={receipt.id} className="rounded-lg border p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-mono text-sm">{receipt.receiptNo}</div>
                    <div className="text-xs text-muted-foreground">
                      {receipt.receivedAt.toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <Badge variant={receipt.status === PurchaseReceiptStatus.POSTED ? 'outline' : 'secondary'}>
                    {PURCHASE_RECEIPT_STATUS_LABELS[receipt.status]}
                  </Badge>
                </div>
                <ul className="mb-3 space-y-1 text-sm">
                  {receipt.items.map((item) => (
                    <li key={item.id}>
                      {item.material.name}：{decimal(item.quantity)} {item.material.unit}
                    </li>
                  ))}
                </ul>
                {receipt.status === PurchaseReceiptStatus.POSTED ? (
                  <CancelPurchaseReceiptButton receiptId={receipt.id} />
                ) : receipt.cancelReason ? (
                  <p className="text-sm text-muted-foreground">
                    取消原因：{receipt.cancelReason}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {order.status === PurchaseOrderStatus.ORDERED ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-2 text-base font-semibold">取消采购单</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            只有尚未收货的采购单可以直接取消；已有收货记录时请先取消对应收货单。
          </p>
          <CancelPurchaseOrderButton purchaseOrderId={order.id} />
        </section>
      ) : null}
    </div>
  );
}
