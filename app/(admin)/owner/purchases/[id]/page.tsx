import { VerifiedDraftReceipt } from '@/components/business/form-drafts/VerifiedDraftReceipt';
import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { PurchaseOrderStatus, PurchaseReceiptStatus } from '../../../../../generated/prisma/enums';
import { createPurchaseReceiptAction } from '@/actions/owner-purchases';
import { CancelPurchaseOrderButton } from '@/components/business/purchase/CancelPurchaseOrderButton';
import { CancelPurchaseReceiptButton } from '@/components/business/purchase/CancelPurchaseReceiptButton';
import { PurchaseReceiptForm } from '@/components/business/purchase/PurchaseReceiptForm';
import {
  PurchaseOrderStatusBadge,
  PurchaseReceiptStatusBadge,
} from '@/components/business/purchase/PurchaseStatusBadge';
import { PageHeader, TableEmptyState, TableScrollArea, ReceiptNotice } from '@/components/ui-business';
import { readReceipt } from '@/lib/admin/receipt';
import { requirePermission } from '@/lib/auth/permissions';
import { getPurchaseOrderDetail } from '@/lib/purchase';
import { listActiveWarehouseLocationOptions } from '@/lib/warehouse';
// 之前这里直接 receivedAt.toLocaleString('zh-CN')，走的是服务器本地
// 时区——而部署里没有设 TZ，收货时间会随机器时区漂。
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

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

export default async function OwnerPurchaseDetailPage({ params, searchParams }: PageProps) {
  const actor = await requirePermission('purchase:manage');
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

  const receipt = readReceipt(await searchParams);

  return (
    <div className="space-y-6">
      <VerifiedDraftReceipt actorId={actor.id} kind="purchase-new" entityId={id} receipt={receipt} />
      <ReceiptNotice receipt={receipt} noun="采购单" />
      <PageHeader
        title={`采购单：${order.purchaseNo}`}
        subtitle={`${order.supplierName} · ${order.supplierCode}`}
        status={<PurchaseOrderStatusBadge status={order.status} />}
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">采购明细</h2>
        <TableScrollArea label="采购明细">
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
                    <div className="font-medium">
                      {externalPriceBusinessText(item.material.name)}
                    </div>
                    <div className="font-sans tabular-nums text-xs text-muted-foreground">
                      {item.material.code}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-right font-sans tabular-nums text-xs">
                    {decimal(item.quantity)} {item.material.unit}
                  </td>
                  <td className="py-3 pr-3 text-right font-sans tabular-nums text-xs">
                    {decimal(item.receivedQuantity)} {item.material.unit}
                  </td>
                  <td className="py-3 pr-3 text-right font-sans tabular-nums text-xs">
                    {remaining(item.quantity, item.receivedQuantity)} {item.material.unit}
                  </td>
                  <td className="py-3 pr-3 text-right font-sans tabular-nums text-xs">
                    {decimal(item.unitCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
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
                    {externalPriceBusinessText(item.material.name)} · 剩余 {remain}{' '}
                    {item.material.unit}
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
          <TableEmptyState
            variant="compact"
            title="暂无收货记录"
          />
        ) : (
          <div className="space-y-4">
            {order.receipts.map((receipt) => (
              <div key={receipt.id} className="rounded-lg border p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-sans tabular-nums text-sm">{receipt.receiptNo}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTimeShanghai(receipt.receivedAt)}
                    </div>
                  </div>
                  <PurchaseReceiptStatusBadge status={receipt.status} />
                </div>
                <ul className="mb-3 space-y-1 text-sm">
                  {receipt.items.map((item) => (
                    <li key={item.id}>
                      {externalPriceBusinessText(item.material.name)}：
                      {decimal(item.quantity)} {item.material.unit}
                    </li>
                  ))}
                </ul>
                {receipt.status === PurchaseReceiptStatus.POSTED ? (
                  <CancelPurchaseReceiptButton
                    receiptId={receipt.id}
                    receiptNo={receipt.receiptNo}
                    purchaseNo={order.purchaseNo}
                    items={receipt.items.map((item) => ({
                      materialCode: item.material.code,
                      materialName: externalPriceBusinessText(item.material.name),
                      quantity: decimal(item.quantity),
                      unit: item.material.unit,
                    }))}
                  />
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
          <CancelPurchaseOrderButton
            purchaseOrderId={order.id}
            purchaseNo={order.purchaseNo}
            supplierName={order.supplierName}
            items={order.items.map((item) => ({
              materialCode: item.material.code,
              materialName: externalPriceBusinessText(item.material.name),
              quantity: decimal(item.quantity),
              unit: item.material.unit,
            }))}
          />
        </section>
      ) : null}
    </div>
  );
}
