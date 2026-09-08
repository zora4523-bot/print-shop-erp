import Link from 'next/link';
import {
  OrderChangeRequestStatus,
  OrderPricingStatus,
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
import { salesOrderStatusPresentation } from '@/lib/order/sales-list-presentation';
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
import { ShipmentStatusBadge } from './ShipmentStatusBadge';
import { SubmitOrderButton } from './SubmitOrderButton';
import { UrgentToggleForm } from './UrgentToggleForm';

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
}: {
  catalogProducts: OrderChangeCatalogProduct[];
  order: SalesOrderDetail;
}) {
  const status = salesOrderStatusPresentation(order.status);
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
    canEditOrderSfCollect(order.status) && !isFinalizedExternalShipment;
  const canEditDesigns =
    !pendingChangeRequest && order.status === OrderStatus.DRAFT;
  const canRequestModify =
    ORDER_MODIFIABLE_STATUSES.includes(order.status) && !pendingChangeRequest;
  const canRequestCancellation =
    (order.status === OrderStatus.CONFIRMED ||
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
                {order.orderNo}
              </h1>
              <SalesDetailStatusBadge label={status.label} tone={status.tone} />
              {order.isUrgent ? (
                <Badge variant="destructive">急单</Badge>
              ) : null}
              {order.isSfCollect ? (
                <Badge variant="outline">顺丰到付</Badge>
              ) : null}
            </div>
            <p className="admin-wrap-anywhere mt-2 text-base font-semibold">
              {order.customName ?? '未命名工单'}
            </p>
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
            <Link
              href="/orders"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              返回工单列表
            </Link>
            {canEdit ? (
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
            {order.status === OrderStatus.DRAFT ? (
              <SubmitOrderButton orderId={order.id} />
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
        <div className="min-w-0 space-y-4">
          <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold">基本信息</h2>
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
              <SalesDetailRow label="快递代码" value={order.expressCode} />
              <SalesDetailRow
                label="收货人"
                value={[order.receiver.name, order.receiver.phone]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <SalesDetailRow label="收货地址" value={order.receiver.address} />
              <SalesDetailRow label="备注" value={order.remark} full />
            </dl>
          </section>

          <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                款式（{order.items.length}）
              </h2>
              <span className="text-xs text-muted-foreground">
                设计图可在草稿状态上传或删除
              </span>
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
                      <p className="admin-wrap-anywhere mt-1 text-xs text-muted-foreground">
                        {[item.specification, item.paper]
                          .filter(Boolean)
                          .map((value) =>
                            externalPriceBusinessText(String(value)),
                          )
                          .join(' · ') || '规格信息待补充'}
                      </p>
                    </div>
                    <strong className="shrink-0 font-sans tabular-nums">
                      {item.quantity.toLocaleString('zh-CN')} 个
                    </strong>
                  </div>
                  {item.remark ? (
                    <HighlightedRemark className="admin-wrap-anywhere mt-3">
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
                      实际 {group.actualBagCount.toLocaleString('zh-CN')} 袋
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
                  <li key={shipment.id} className="rounded-lg border p-3 text-sm">
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
                      <p className="mt-2 font-sans tabular-nums">
                        运单号：{shipment.trackingNo}
                      </p>
                    ) : null}
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
              <p className="text-sm text-muted-foreground">暂无发货地址</p>
            )}
          </section>

          {order.changeRequests.length > 0 ? (
            <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
              <h2 className="text-base font-semibold">变更 / 取消申请</h2>
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
                          基于业务第 {request.baseRevision} 版 · 基于生产版本{' '}
                          {request.baseWorkOrderVersion == null
                            ? '历史未记录'
                            : `v${request.baseWorkOrderVersion}`}{' '}
                          · 批准后生产版本{' '}
                          {request.workOrderVersionAfter == null
                            ? '未生成'
                            : `v${request.workOrderVersionAfter}`}{' '}
                          ·{' '}
                          {formatDateTimeShanghai(new Date(request.createdAt))}
                        </span>
                      </div>
                      <p className="admin-wrap-anywhere mt-2">
                        原因：{request.reason}
                      </p>
                      {request.reviewRemark ? (
                        <p className="admin-wrap-anywhere mt-2 text-xs text-muted-foreground">
                          审核说明：{request.reviewRemark}
                        </p>
                      ) : null}
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
  const pricingPending = order.pricingStatus === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION;
  const totalEstimated = !pricingPending && order.feeLines.some((line) => line.estimated);
  const hasPendingAmount = order.feeLines.some((line) => line.amount === null);
  return (
    <section
      className={cn(
        'space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6',
        pricingPending && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">费用</h2>
        {pricingPending ? (
          <Badge variant="destructive">待管理员确认价格</Badge>
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
                  <span className="ml-1 text-[10px] text-muted-foreground">
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
            pricingPending && 'text-sm text-destructive',
          )}
        >
          {pricingPending
            ? '待管理员确认价格'
            : formatMoney(order.totalAmount)}
          {totalEstimated ? (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
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

function SalesDetailStatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: ReturnType<typeof salesOrderStatusPresentation>['tone'];
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        tone === 'muted' && 'border-muted bg-muted text-muted-foreground',
        tone === 'outline' && 'border-foreground/70',
        tone === 'production' &&
          'border-foreground bg-foreground text-background',
        tone === 'shipped' &&
          'border-success/40 bg-success/10 text-success-foreground',
        tone === 'attention' &&
          'border-destructive/40 bg-destructive/10 text-destructive',
      )}
    >
      {label}
    </Badge>
  );
}
