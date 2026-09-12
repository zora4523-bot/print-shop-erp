import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  OrderChangeRequestStatus,
  OrderSettlementType,
  OrderStatus,
} from '@/generated/prisma/enums';
import type { SalesOrderDetail } from '@/lib/order/sales-detail-query';
import {
  canEditOrderSfCollect,
  ORDER_MODIFIABLE_STATUSES,
  editableFieldsetForStatus,
  isOrderEditable,
} from '@/lib/order/editable-fields';
import { orderAmountPresentation } from '@/lib/order/amount-presentation';
import { formatMoney } from '@/lib/dashboard/format';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import type { OrderChangeCatalogProduct } from '@/lib/order/change-request-catalog-identity';
import { ORDER_CHANGE_REQUEST_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { StatusBadge as UiStatusBadge } from '@/components/ui-business';
import { BreadcrumbEntity } from '@/components/business/admin/breadcrumb-entity';
import { DesignUploadPanel } from './DesignUploadPanel';
import { HighlightedRemark } from './HighlightedRemark';
import { OrderChangeRequestForm } from './OrderChangeRequestForm';
import { OrderCancellationRequestForm } from './OrderCancellationRequestForm';
import { OrderChangeWithdrawButton } from './OrderChangeWithdrawButton';
import { PromisedDateBadge } from './PromisedDateBadge';
import { SfCollectToggleForm } from './SfCollectToggleForm';
import { SalesOrderStatusBadge } from './SalesOrderStatusBadge';
import { ShipmentStatusBadge } from './ShipmentStatusBadge';
import { UrgentBadge } from './UrgentBadge';
import { CancelOrderForm } from './CancelOrderForm';
import { SubmitOrderButton } from './SubmitOrderButton';
import { UrgentToggleForm } from './UrgentToggleForm';
import { OrderRemark } from './OrderRemark';
import { SalesOrderRefreshButton } from './SalesOrderRefreshButton';

function SalesOrderChangeRequestSection({
  catalogProducts,
  canRequestCancellation,
  order,
}: {
  catalogProducts: OrderChangeCatalogProduct[];
  canRequestCancellation: boolean;
  order: SalesOrderDetail;
}) {
  return (
    <section
      id="change-request"
      className="scroll-mt-24 space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6"
    >
      <div>
        <h2 className="text-base font-semibold">申请修改工单</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          管理员批准后才会更新工单内容。
        </p>
      </div>
      <OrderChangeRequestForm
              hasPackagingGroups={order.packagingGroups.length > 0}
        promisedDate={order.promisedDate?.slice(0, 10) ?? null}
        orderId={order.id}
        expectedRevision={order.revision}
        expectedWorkOrderVersion={order.workOrderVersion}
        catalogProducts={catalogProducts}
        items={order.items.map((item) => ({
          id: item.id,
          sequence: item.sequence,
          name: item.name,
          quantity: item.quantity,
          productId: item.productId,
          pricingRoute: item.pricingRoute,
          specification: item.specification,
          paperType: item.paperType,
          paperWeightGsm: item.paperWeightGsm,
          frontFoilColors: item.frontFoilColors,
          backFoilColors: item.backFoilColors,
          foilColors: item.foilColors,
          isDoubleSided: item.isDoubleSided,
        }))}
      />
      {canRequestCancellation ? (
        <div className="border-t pt-4">
          <h3 className="mb-2 text-sm font-semibold">申请取消</h3>
          <OrderCancellationRequestForm
            orderId={order.id}
            expectedRevision={order.revision}
            expectedWorkOrderVersion={order.workOrderVersion}
          />
        </div>
      ) : null}
    </section>
  );
}

export function SalesOrderDetailView({
  catalogProducts,
  order,
  editForm,
}: {
  catalogProducts: OrderChangeCatalogProduct[];
  order: SalesOrderDetail;
  editForm?: ReactNode;
}) {
  const pendingChangeRequest = order.changeRequests.find(
    (request) => request.status === OrderChangeRequestStatus.PENDING,
  );
  const canEdit = !pendingChangeRequest && isOrderEditable(order.status);
  const canToggleUrgent =
    !pendingChangeRequest && editableFieldsetForStatus(order.status) === 'FULL';
  const isFinalizedExternalShipment =
    order.status === OrderStatus.SHIPPED &&
    order.settlementType === OrderSettlementType.EXTERNAL_SALES;
  const canToggleSfCollect =
    !pendingChangeRequest && canEditOrderSfCollect(order.status) && !isFinalizedExternalShipment;
  const canEditDesigns =
    !pendingChangeRequest && (order.status === OrderStatus.DRAFT || order.status === OrderStatus.REJECTED);
  const canRequestModify =
    ORDER_MODIFIABLE_STATUSES.includes(order.status) && !pendingChangeRequest;
  const canRequestCancellation =
    (order.status === OrderStatus.ON_HOLD || order.status === OrderStatus.CONFIRMED ||
      order.status === OrderStatus.RELEASED ||
      order.status === OrderStatus.FOILING ||
      order.status === OrderStatus.PACKING) &&
    !pendingChangeRequest;

  return (
    <div data-slot="sales-order-detail" className="space-y-4">
      <BreadcrumbEntity label={order.orderNo} />

      <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="admin-wrap-anywhere min-w-0 font-sans text-xl font-semibold tabular-nums">
                {order.customName?.trim() || '未命名工单'}
              </h1>
              <SalesOrderStatusBadge status={order.status} />
              {order.isUrgent ? (
                <UrgentBadge />
              ) : null}
              {order.isSfCollect ? (
                <Badge variant="outline">顺丰到付</Badge>
              ) : null}
            </div>
            <p className="admin-wrap-anywhere mt-2 text-sm text-muted-foreground">{order.orderNo}</p>
            <p className="admin-wrap-anywhere mt-1 text-sm text-muted-foreground">
              {order.customerRef ?? '未填客户'} · 第 {order.revision} 版 ·{' '}
              {order.items.length} 款{' '}
              {order.items
                .reduce((sum, item) => sum + item.quantity, 0)
                .toLocaleString('zh-CN')}{' '}
              个
            </p>
          </div>

          <div className="flex min-w-0 flex-wrap items-start gap-2 lg:justify-end">
            <SalesOrderRefreshButton />
            {canEdit && !editForm ? (
              <Link
                href={`/orders/${order.id}/edit`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                编辑工单
              </Link>
            ) : null}
            {canToggleUrgent ? (
              <UrgentToggleForm
                orderId={order.id}
                currentValue={order.isUrgent}
              />
            ) : null}
            {canToggleSfCollect ? (
              <SfCollectToggleForm
                key={`sf-${order.id}-${order.revision}-${order.priceRevision}`}
                orderId={order.id}
                currentValue={order.isSfCollect}
                status={order.status}
                isExternalSales={
                  order.settlementType === OrderSettlementType.EXTERNAL_SALES
                }
                mutationGuard={{
                  expectedOrderRevision: order.revision,
                  expectedEditVersion: order.editVersion,
                  expectedWorkOrderVersion: order.workOrderVersion,
                  expectedPriceRevision: order.priceRevision,
                }}
                shipments={order.shipments.map((shipment) => ({
                  id: shipment.id,
                  sequence: shipment.sequence,
                  destinationProvince: shipment.destinationProvince,
                  // SALES cannot perform the post-shipment correction flow,
                  // so no carrier actual-weight fact crosses this boundary.
                  weightKg: null,
                  shippingFee: null,
                  customerChargeOverrideReason: null,
                }))}
              />
            ) : null}
            {!pendingChangeRequest && (order.status === OrderStatus.DRAFT || order.status === OrderStatus.REJECTED) ? (
              <SubmitOrderButton orderId={order.id} />
            ) : null}
          </div>
        </div>
      </section>

      {!pendingChangeRequest && [OrderStatus.DRAFT, OrderStatus.PENDING_FACTORY, OrderStatus.REJECTED].some((status) => status === order.status) ? (
        <CancelOrderForm orderId={order.id} orderNo={order.orderNo} expectedEditVersion={order.editVersion}
          impact={[{ label: '工单', value: `${order.orderNo} 将取消，停止后续处理` }]} compact />
      ) : null}
      {order.workflowDecision ? <section className="space-y-2 rounded-xl border border-warning/50 bg-warning/10 p-4">
        <h2 className="font-semibold">{order.status === OrderStatus.REJECTED ? '驳回原因' : '暂停原因'}：{order.workflowDecision.reason}</h2>
        {order.workflowDecision.note ? <p className="whitespace-pre-wrap break-words">{order.workflowDecision.note}</p> : null}
        <p>受影响款式：{order.workflowDecision.affectedFigs.map((sequence) => `第 ${sequence} 款`).join('、')}</p>
        <p className="text-xs text-muted-foreground">{formatDateTimeShanghai(new Date(order.workflowDecision.createdAt))}</p>
      </section> : null}
      {editForm}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
        <div className="min-w-0 space-y-4">
          <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold">{editForm ? '已保存的基本信息' : '基本信息'}</h2>
            <dl className="grid min-w-0 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <SalesDetailRow
                label="承诺交期"
                value={order.promisedDate}
                trailing={
                  <PromisedDateBadge
                    promisedDate={
                      order.promisedDate ? new Date(order.promisedDate) : null
                    }
                    status={order.status}
                  />
                }
              />
              <SalesDetailRow label="配送方式" value={order.isSfCollect ? '顺丰到付' : '寄付'} />
              {order.expressCode ? <SalesDetailRow label="快递代码" value={order.expressCode} /> : null}
            </dl>
            <OrderRemark remark={order.remark} />
          </section>

          <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                款式（{order.items.length}）
              </h2>
            </div>
            <ol className="space-y-3">
              {order.items.map((item) => (
                <li
                  key={item.id}
                  className="min-w-0 rounded-lg border p-3 sm:p-4"
                >
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="admin-wrap-anywhere font-medium">
                        <span className="text-muted-foreground">
                          #{item.sequence}
                        </span>{' '}
                        · {externalPriceBusinessText(item.name)}
                      </h3>
                    </div>
                    <strong className="shrink-0 font-sans tabular-nums">
                      {item.quantity.toLocaleString('zh-CN')} 个
                    </strong>
                  </div>
                  <dl className="mt-3 grid min-w-0 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                    {item.details.map((fact) => <SalesDetailRow key={fact.label} label={fact.label} value={fact.value} />)}
                  </dl>
                  {item.remark ? (
                    <HighlightedRemark className="admin-wrap-anywhere mt-3 whitespace-pre-wrap">
                      {item.remark}
                    </HighlightedRemark>
                  ) : null}
                  <DesignUploadPanel
                    orderId={order.id}
                    orderItemId={item.id}
                    canEdit={canEditDesigns}
                    designs={item.designs}
                  />
                </li>
              ))}
            </ol>
          </section>

          <section
            aria-label="包装明细"
            className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6"
          >
            <h2 className="text-base font-semibold">
              包装明细（{order.packagingGroups.length}）
            </h2>
            {order.packagingGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">未记录分袋明细。</p>
            ) : (
              <ol className="space-y-3">
                {order.packagingGroups.map((group) => (
                  <li
                    key={group.id}
                    className="admin-wrap-anywhere rounded-lg border p-3 text-sm"
                  >
                    <h3 className="font-medium">
                      包装组 #{group.sequence}
                      {group.name ? ` · ${group.name}` : ''} ·{' '}
                      {group.mode === 'MIXED_STYLE' ? '混装' : '单款装'}
                    </h3>
                    <p className="mt-1">
                      共 {group.actualBagCount.toLocaleString('zh-CN')} 袋
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {group.lines
                        .map(
                          (line) =>
                            `#${line.itemSequence} ${line.itemName} · 每袋 ${line.unitsPerBag} 个`,
                        )
                        .join('；') || '未记录每袋组成'}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {order.packageRequirement ? (
              <p className="admin-wrap-anywhere whitespace-pre-wrap text-sm">
                包装补充说明：{order.packageRequirement}
              </p>
            ) : null}
          </section>

          {canRequestModify ? (
            <SalesOrderChangeRequestSection
              catalogProducts={catalogProducts}
              canRequestCancellation={canRequestCancellation}
              order={order}
            />
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <SalesOrderFeesSection order={order} />

          <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold">
              发货与收货（{order.shipments.length}）
            </h2>
            {order.shipments.length > 0 ? (
              <ol className="space-y-3">
                {order.shipments.map((shipment) => (
                  <li key={shipment.id} className="min-w-0 rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>地址 {shipment.sequence}</strong>
                      <ShipmentStatusBadge status={shipment.status} />
                    </div>
                    <p className="admin-wrap-anywhere mt-2 text-muted-foreground">
                      {[shipment.receiverName, shipment.receiverPhone]
                        .filter(Boolean)
                        .join(' · ') || '收货人未填写'}
                    </p>
                    <p className="admin-wrap-anywhere text-muted-foreground">
                      {shipment.receiverAddress ?? '收货地址未填写'}
                    </p>
                    {shipment.trackingNo ? (
                      <p className="admin-wrap-anywhere mt-2 font-sans tabular-nums">
                        运单号：{shipment.trackingNo}
                      </p>
                    ) : null}
                    {shipment.carrier ? <p className="admin-wrap-anywhere mt-2">快递：{shipment.carrier}</p> : null}
                    {shipment.expressCode && shipment.expressCode !== order.expressCode ? <p className="admin-wrap-anywhere mt-2">快递代码：{shipment.expressCode}</p> : null}
                    {shipment.shippedAt ? <p className="mt-2">发货时间：{formatDateTimeShanghai(new Date(shipment.shippedAt))}</p> : null}
                    {shipment.lines.length > 0 ? (
                      <p className="admin-wrap-anywhere mt-2 text-xs text-muted-foreground">
                        {shipment.lines
                          .map(
                            (line) =>
                              `#${line.itemSequence} ${line.itemName} × ${line.quantity}`,
                          )
                          .join('；')}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="admin-wrap-anywhere space-y-1 text-sm">
                <p>{[order.receiver.name, order.receiver.phone].filter(Boolean).join(' · ') || '收货人未填写'}</p>
                <p>{order.receiver.address || '收货地址未填写'}</p>
              </div>
            )}
          </section>

          {order.changeRequests.length > 0 ? (
            <section id={pendingChangeRequest ? 'change-request' : undefined} className="scroll-mt-4 space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
              <h2 className="text-base font-semibold">最近申请</h2>
              <ol className="space-y-3">
                {order.changeRequests.map((request) => {
                  const definition =
                    ORDER_CHANGE_REQUEST_STATUS_REGISTRY[request.status];
                  return (
                    <li key={request.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <UiStatusBadge tone={definition.tone} dot={definition.dot}>
                          {definition.label}
                        </UiStatusBadge>
                        <span className="text-xs text-muted-foreground">
                          {request.type === 'CANCEL' ? '取消' : '修改'} ·{' '}
                          基于第 {request.baseRevision} 版 ·{' '}
                          {formatDateTimeShanghai(new Date(request.createdAt))}
                        </span>
                      </div>
                      <p className="admin-wrap-anywhere mt-2 whitespace-pre-wrap">
                        原因：{request.reason}
                      </p>
                      {request.reviewRemark ? (
                        <p className="admin-wrap-anywhere mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                          审核说明：{request.reviewRemark}
                        </p>
                      ) : null}
                      {request.reviewedAt ? <p className="mt-2 text-xs text-muted-foreground">审核时间：{formatDateTimeShanghai(new Date(request.reviewedAt))}</p> : null}
                      {request.canWithdraw ? (
                        <OrderChangeWithdrawButton requestId={request.id} />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SalesOrderFeesSection({ order }: { order: SalesOrderDetail }) {
  const total = orderAmountPresentation({
    status: order.status,
    pricingStatus: order.pricingStatus,
    amount: order.totalAmount,
    estimated: order.feeLines.some((line) => line.estimated),
  });
  const pricingPending = total.pending;
  const totalEstimated = total.estimated;
  const hasPendingAmount = order.feeLines.some((line) => line.amount === null);
  return (
    <section
      className={cn(
        'space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6',
        pricingPending && 'border-primary/40 bg-primary/5',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">费用</h2>
        {pricingPending ? (
          <UiStatusBadge tone="primary">{total.label}</UiStatusBadge>
        ) : null}
      </div>
      {order.feeLines.length > 0 ? (
        <dl className="divide-y text-sm">
          {order.feeLines.map((line) => (
            <div
              key={line.id}
              className="flex min-w-0 justify-between gap-3 py-2"
            >
              <dt className="admin-wrap-anywhere min-w-0 text-muted-foreground">
                {line.label}
              </dt>
              <dd className="shrink-0 font-sans font-medium tabular-nums">
                {line.amount === null ? '待定' : formatMoney(line.amount)}
                {line.estimated ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    估
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">暂无费用分项</p>
      )}
      <div className="flex items-baseline justify-between gap-3 border-t-2 border-foreground pt-3">
        <span className="text-sm font-medium">
          {!pricingPending && hasPendingAmount
            ? '已知合计（不含待定）'
            : '合计'}
        </span>
        <strong
          className={cn(
            'font-sans text-xl tabular-nums',
            pricingPending && 'text-sm text-primary',
          )}
        >
          {total.label}
          {totalEstimated ? (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              估
            </span>
          ) : null}
        </strong>
      </div>
    </section>
  );
}

function SalesDetailRow({
  label,
  value,
  trailing,
  full,
}: {
  label: string;
  value: string | null | undefined;
  trailing?: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={cn('min-w-0', full && 'sm:col-span-2')}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="admin-wrap-anywhere mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
        {value?.trim() || '—'}
        {trailing}
      </dd>
    </div>
  );
}
