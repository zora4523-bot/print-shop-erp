import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import {
  OrderChangeRequestStatus,
  OrderCostCategory,
  OrderKind,
  OrderSettlementType,
  OrderStatus,
  OutsourceStatus,
  ShipmentStatus,
  Role,
} from '../../../../generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import { getOrderDetail } from '@/lib/order';
import {
  canAttachOutsource,
  isTerminalOrderStatus,
} from '@/lib/order/status-machine';
import {
  canEditOrderSfCollect,
  editableFieldsetForStatus,
  isOrderEditable,
} from '@/lib/order/editable-fields';
import { roleLabel } from '@/lib/auth/role-labels';
import {
  actionLabel,
  formatOrderLogChanges,
} from '@/lib/order/log-format';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import { SubmitOrderButton } from '@/components/business/order/SubmitOrderButton';
import { CancelOrderForm } from '@/components/business/order/CancelOrderForm';
import { ShipOrderForm } from '@/components/business/order/ShipOrderForm';
import { FinishOrderButton } from '@/components/business/order/FinishOrderButton';
import { UrgentToggleForm } from '@/components/business/order/UrgentToggleForm';
import { SfCollectToggleForm } from '@/components/business/order/SfCollectToggleForm';
import { DesignUploadPanel } from '@/components/business/order/DesignUploadPanel';
import { PromisedDateBadge } from '@/components/business/order/PromisedDateBadge';
import { signDesignReadUrl } from '@/lib/oss/read-url';
import { OrderMaterialUsageEstimate } from '@/components/business/bom/OrderMaterialUsageEstimate';
import { estimateMaterialUsageForOrderItems } from '@/lib/bom';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { getOrderPieceworkSummary } from '@/lib/salary/daily';
import { getPendingTaskReassignmentView } from '@/lib/production';
import { ReassignTaskForm } from '@/components/business/production/ReassignTaskForm';
import { HighlightedRemark } from '@/components/business/order/HighlightedRemark';
import { formatFoilColors } from '@/lib/order/foil-colors';
import {
  getReworkCraftOptions,
} from '@/lib/order/rework';
import { ReworkOrderForm } from '@/components/business/order/ReworkOrderForm';
import { OrderChangeRequestForm } from '@/components/business/order/OrderChangeRequestForm';
import { OrderChangeReviewForm } from '@/components/business/order/OrderChangeReviewForm';
import { OrderCostEntryForm } from '@/components/business/bill/OrderCostEntryForm';
import { formatReceiverInfo } from '@/lib/order/receiver-info';
import { formatMoney } from '@/lib/dashboard/format';
import { formatUnitPrice } from '@/lib/format/unit-price';
import { ORDER_SETTLEMENT_LABELS } from '@/lib/order/settlement';
import { PricingSnapshotBreakdown } from '@/components/business/price/PricingSnapshotBreakdown';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `工单 · ${id.slice(0, 8)}` };
}

export default async function OrderDetailPage({ params }: PageProps) {
  const { user } = await requireSession();
  const { id } = await params;
  const order = await getOrderDetail(id, { id: user.id, role: user.role });
  if (!order) notFound();
  const canViewCommercialAmounts = user.role !== Role.WORKER;
  const canCreateRework =
    user.role === Role.ADMIN &&
    order.kind !== OrderKind.REWORK &&
    (order.status === OrderStatus.SHIPPED ||
      order.status === OrderStatus.FINISHED);
  const [
    materialEstimate,
    pieceworkSummary,
    reassignmentView,
    reworkCraftOptions,
  ] = await Promise.all([
    estimateMaterialUsageForOrderItems(order.items),
    user.role === Role.ADMIN
      ? getOrderPieceworkSummary(order.id)
      : Promise.resolve(null),
    user.role === Role.ADMIN
      ? getPendingTaskReassignmentView(order.id)
      : Promise.resolve({ tasks: [] }),
    canCreateRework
      ? getReworkCraftOptions(order.items.flatMap((item) => item.crafts))
      : Promise.resolve([]),
  ]);

  const canSubmit =
    order.status === OrderStatus.DRAFT &&
    (order.submitterId === user.id || user.role === Role.ADMIN);
  const canCancel =
    user.role === Role.ADMIN && !isTerminalOrderStatus(order.status);
  // SHIPPED / FINISHED 转换权限：order:ship = ADMIN（见
  // permissions.ts）。这里 mirror 该闸口；action 层 requirePermission
  // 仍是真闸口。
  const canShipOrFinish =
    user.role === Role.ADMIN;
  const hasLiveOutsource = order.outsourceOrders.some(
    (row) =>
      row.status === OutsourceStatus.SENT ||
      row.status === OutsourceStatus.IN_PROGRESS,
  );
  const canShip =
    canShipOrFinish &&
    order.status === OrderStatus.COMPLETED &&
    !hasLiveOutsource;
  const canFinish =
    canShipOrFinish && order.status === OrderStatus.SHIPPED;

  // Editing follows SPEC §3.6. Ownership mirrors the action-layer
  // guard: SALES / CUSTOMER_SERVICE only their own; ADMIN
  // any. Server still re-verifies on submit — this is UI-only.
  const canEdit =
    isOrderEditable(order.status) &&
    (order.submitterId === user.id || user.role === Role.ADMIN);
  // 急单 toggle lives in the FULL fieldset only (DRAFT/SUBMITTED).
  const canToggleUrgent = editableFieldsetForStatus(order.status) === 'FULL' && canEdit;
  const isExternalSalesOrder =
    'settlementType' in order &&
    order.settlementType === OrderSettlementType.EXTERNAL_SALES;
  const isFinalizedExternalShipment =
    order.status === OrderStatus.SHIPPED &&
    isExternalSalesOrder;
  const canToggleSfCollect =
    canEditOrderSfCollect(order.status) &&
    (order.submitterId === user.id || user.role === Role.ADMIN) &&
    (!isFinalizedExternalShipment || user.role === Role.ADMIN);
  // 设计图增删仅 DRAFT（提交后的增删属于 A05，等业主拍板）；所有权
  // 与编辑一致。lib/order-design.ts 是真闸口，这里 UI-only。
  const canEditDesigns = order.status === OrderStatus.DRAFT && canEdit;
  // Only foreman / owner creates outsource orders, and only on
  // production-active states. SHIPPED is non-terminal but already
  // out the door — no new production work attaches there.
  // canAttachOutsource() is the canonical gate;
  // lib/outsource.ts re-checks the same predicate.
  const canCreateOutsource =
    (user.role === Role.ADMIN) &&
    canAttachOutsource(order.status);
  const assignedWorkerNames = [
    ...new Set(
      order.items.flatMap((item) =>
        item.tasks.flatMap((task) =>
          task.worker ? [task.worker.displayName] : [],
        ),
      ),
    ),
  ];
  const pendingChangeRequest = order.changeRequests.find(
    (request) => request.status === OrderChangeRequestStatus.PENDING,
  );
  const canRequestChange =
    (user.role === Role.SALES || user.role === Role.CUSTOMER_SERVICE) &&
    order.submitterId === user.id &&
    (order.status === OrderStatus.DRAFT ||
      order.status === OrderStatus.SUBMITTED ||
      order.status === OrderStatus.SCHEDULING ||
      order.status === OrderStatus.IN_PRODUCTION) &&
    !pendingChangeRequest;
  const customerChargeByShipmentAndCategory = new Map(
    order.customerCharges.flatMap((charge) =>
      charge.shipment
        ? [[`${charge.shipment.id}:${String(charge.category.code)}`, charge] as const]
        : [],
    ),
  );

  return (
    <div className="space-y-6">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            <span className="admin-wrap-anywhere min-w-0 font-sans tabular-nums">
              {order.orderNo}
            </span>
            {order.isUrgent ? (
              <Badge variant="destructive">
                急单
              </Badge>
            ) : null}
            {order.isSfCollect ? (
              <Badge
                variant="outline"
                className="border-warning/50 bg-warning/10 text-warning-foreground"
              >
                顺丰到付 · 自行预约
              </Badge>
            ) : null}
            {order.shipments.length > 1 ? (
              <Badge variant="outline">多地址 ×{order.shipments.length}</Badge>
            ) : null}
            {order.kind === OrderKind.REWORK ? (
              <Badge variant="outline">重做单</Badge>
            ) : null}
          </h1>
          {order.customName ? (
            <p className="admin-wrap-anywhere mt-1 text-base font-semibold text-foreground">
              {order.customName}
            </p>
          ) : null}
          <p className="admin-wrap-anywhere text-sm text-muted-foreground">
            提交人：{order.submitter.displayName}（{roleLabel(order.submitter.role)}）
            · 创建于 {formatDateTimeShanghai(order.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <OrderStatusBadge status={order.status} />
          {canEdit ? (
            <Link
              href={`/orders/${order.id}/edit`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              编辑
            </Link>
          ) : null}
          {canToggleUrgent ? (
            <UrgentToggleForm orderId={order.id} currentValue={order.isUrgent} />
          ) : null}
          {canToggleSfCollect ? (
            <SfCollectToggleForm
              orderId={order.id}
              currentValue={order.isSfCollect}
              status={order.status}
              isExternalSales={isExternalSalesOrder}
              shipments={order.shipments.map((shipment) => ({
                id: shipment.id,
                sequence: shipment.sequence,
                destinationProvince: shipment.destinationProvince,
                weightKg:
                  shipment.weightKg?.toString() ??
                  shipment.quotedWeightKg?.toString() ??
                  null,
                shippingFee: null,
                customerChargeOverrideReason: null,
              }))}
            />
          ) : null}
          {canCreateOutsource ? (
            <Link
              href={`/foreman/outsource/new?orderId=${order.id}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              外协
            </Link>
          ) : null}
          <Link
            href={`/print/orders/${order.id}?autoprint=1`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            打印
          </Link>
          <Link
            href={`/api/orders/${order.id}/pdf`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            下载 PDF
          </Link>
        </div>
      </div>

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold">基本信息</h2>
        <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="工单名称" value={order.customName} full />
          <Row
            label="提交人"
            value={`${order.submitter.displayName}（${roleLabel(order.submitter.role)}）`}
          />
          <Row
            label="师傅"
            value={assignedWorkerNames.length ? assignedWorkerNames.join('、') : '未派工'}
          />
          <Row label="客户名称/简称" value={order.customerRef} />
          {canViewCommercialAmounts && 'settlementType' in order ? (
            <Row
              label="结算路径"
              value={
                ORDER_SETTLEMENT_LABELS[
                  order.settlementType as OrderSettlementType
                ]
              }
            />
          ) : null}
          <Row label="快递代码" value={order.expressCode} />
          <Row
            label="配送方式"
            value={order.isSfCollect ? '顺丰到付（自行预约）' : '普通配送'}
          />
          <Row label="收货信息" value={formatReceiverInfo(order)} full />
          <Row label="包装要求" value={order.packageRequirement} full />
          <Row label="备注" value={order.remark} full />
          <div>
            <dt className="text-muted-foreground">承诺交期</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              {order.promisedDate
                ? order.promisedDate.toISOString().slice(0, 10)
                : '—'}
              <PromisedDateBadge
                promisedDate={order.promisedDate}
                status={order.status}
              />
            </dd>
          </div>
          {canViewCommercialAmounts &&
          'processingAmount' in order &&
          'totalAmount' in order ? (
            <>
              <Row
                label="加工费小计"
                value={String(order.processingAmount)}
                tabular
              />
              <Row
                label={
                  order.isSfCollect
                    ? '对客应收总额（不含快递费，含耗材费）'
                    : '对客应收总额'
                }
                value={String(order.totalAmount)}
                tabular
              />
            </>
          ) : null}
        </dl>
      </section>

      {canViewCommercialAmounts && order.customerCharges.length > 0 ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div>
            <h2 className="text-base font-semibold">对客快递与打包耗材费</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              这些是外部销售应付工厂的收费，不计入工厂内部成本；多地址按每票分别保存。
            </p>
          </div>
          <ol className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            {order.customerCharges.map((charge) => (
              <li
                key={charge.id}
                className="admin-wrap-anywhere min-w-0 rounded-lg border p-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      地址 {charge.shipment?.sequence ?? '—'} ·{' '}
                      {charge.category.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {charge.description}
                    </p>
                  </div>
                  <Badge
                    variant={
                      charge.status === 'FINAL' ? 'secondary' : 'outline'
                    }
                  >
                    {charge.status === 'FINAL'
                      ? '已确认'
                      : charge.status === 'WAIVED'
                        ? '已免收'
                        : '创建时估算'}
                  </Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">实际收费</dt>
                    <dd className="font-sans font-medium tabular-nums">
                      {formatMoney(charge.amount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">报价表建议</dt>
                    <dd className="font-sans tabular-nums">
                      {charge.suggestedAmount === null
                        ? '人工确认'
                        : formatMoney(charge.suggestedAmount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">计费数量</dt>
                    <dd>
                      {charge.quantity === null
                        ? '—'
                        : `${String(charge.quantity)} ${charge.unit ?? ''}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">规则版本</dt>
                    <dd>
                      {charge.priceBook
                        ? `报价第 ${charge.priceBook.version} 版`
                        : '人工收费'}
                    </dd>
                  </div>
                </dl>
                {charge.overrideReason ? (
                  <p className="mt-2 rounded-md bg-warning/10 p-2 text-xs text-warning-foreground">
                    调整说明：{charge.overrideReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            发货地址（{order.shipments.length}）
          </h2>
          {order.shipments.length > 1 ? (
            <Badge variant="outline">多地址发货</Badge>
          ) : null}
        </div>
        <ol className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
          {order.shipments.map((shipment) => (
            <li
              key={shipment.id}
              className="admin-wrap-anywhere min-w-0 rounded-lg border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">地址 {shipment.sequence}</span>
                <Badge
                  variant={
                    shipment.status === ShipmentStatus.SHIPPED
                      ? 'secondary'
                      : 'outline'
                  }
                >
                  {shipment.status === ShipmentStatus.SHIPPED
                    ? '已发货'
                    : '待发货'}
                </Badge>
              </div>
              <p className="mt-2 text-muted-foreground">
                {formatReceiverInfo(shipment, '未填写收货信息')}
              </p>
              {shipment.expressCode ? (
                <p className="text-muted-foreground">
                  快递代码：{shipment.expressCode}
                </p>
              ) : null}
              {shipment.destinationProvince ? (
                <p className="text-muted-foreground">
                  计费省份：{shipment.destinationProvince}
                </p>
              ) : null}
              {shipment.quotedWeightKg ? (
                <p className="font-sans tabular-nums text-muted-foreground">
                  创建时计费重量：{String(shipment.quotedWeightKg)} kg
                </p>
              ) : null}
              {shipment.weightKg ? (
                <p className="font-sans tabular-nums text-muted-foreground">
                  发货计费重量：{String(shipment.weightKg)} kg
                </p>
              ) : null}
              {shipment.trackingNo ? (
                <p className="font-sans tabular-nums">
                  运单号：{shipment.trackingNo}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                {shipment.lines
                  .map(
                    (line) =>
                      `#${line.orderItem.sequence} ${line.orderItem.name} × ${line.quantity}`,
                  )
                  .join('；') || '尚未分配款式数量'}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {order.sourceOrder || order.reworkOrders.length > 0 ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold">重做关联</h2>
          {order.sourceOrder ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">原工单</span>
              <Link
                href={`/orders/${order.sourceOrder.id}`}
                className="admin-wrap-anywhere font-sans tabular-nums text-primary underline"
              >
                {order.sourceOrder.orderNo}
              </Link>
              <OrderStatusBadge status={order.sourceOrder.status} />
            </div>
          ) : null}
          {order.reworkOrders.length > 0 ? (
            <ul className="space-y-2">
              {order.reworkOrders.map((rework) => (
                <li
                  key={rework.id}
                  className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <Badge variant="outline">重做单</Badge>
                  <Link
                    href={`/orders/${rework.id}`}
                    className="admin-wrap-anywhere font-sans tabular-nums text-primary underline"
                  >
                    {rework.orderNo}
                  </Link>
                  <span className="admin-wrap-anywhere text-muted-foreground">
                    {rework.customName}
                  </span>
                  <OrderStatusBadge status={rework.status} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold">款式（{order.items.length}）</h2>
        <ol className="space-y-3">
          {order.items.map((item) => (
            <li key={item.id} className="min-w-0 rounded-lg border p-4 text-sm">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <h3 className="admin-wrap-anywhere min-w-0 font-medium">
                  <span className="text-muted-foreground">#{item.sequence}</span>
                  {' · '}
                  {item.name}
                </h3>
                <dl className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-1 text-xs sm:shrink-0 sm:justify-end sm:text-right">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">数量</dt>
                    <dd className="admin-wrap-anywhere font-sans tabular-nums text-foreground">
                      {formatQuantity(item.quantity)}
                    </dd>
                  </div>
                  {canViewCommercialAmounts &&
                  'unitPrice' in item &&
                  'fixedFee' in item &&
                  'subtotal' in item ? (
                    <>
                      <div className="min-w-0">
                        <dt className="text-muted-foreground">单价</dt>
                        <dd className="admin-wrap-anywhere font-sans tabular-nums text-foreground">
                          {formatUnitPrice(String(item.unitPrice))}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-muted-foreground">一次性费用</dt>
                        <dd className="admin-wrap-anywhere font-sans tabular-nums text-foreground">
                          {formatMoney(String(item.fixedFee))}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-muted-foreground">小计</dt>
                        <dd className="admin-wrap-anywhere font-sans tabular-nums text-foreground">
                          {formatMoney(String(item.subtotal))}
                        </dd>
                      </div>
                    </>
                  ) : null}
                </dl>
              </div>
              <dl className="mt-3 grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Row label="规格" value={item.specification} />
                <Row label="纸张" value={item.paperType} />
                <Row
                  label="烫金色"
                  value={formatFoilColors(item.foilColors)}
                  full
                />
                <Row
                  label="印刷面"
                  value={item.isDoubleSided ? '双面' : '单面'}
                />
                <Row
                  label="印刷色数"
                  value={item.isDoubleColor ? '双色' : '单色'}
                />
                <Row
                  label="工艺"
                  value={item.craftNames.length ? item.craftNames.join('、') : '—'}
                  full
                />
                {canViewCommercialAmounts &&
                'suggestedSubtotal' in item &&
                'priceOverrideReason' in item ? (
                  <>
                    <Row
                      label="系统建议小计"
                      value={
                        item.suggestedSubtotal
                          ? formatMoney(String(item.suggestedSubtotal))
                          : '未形成完整建议价'
                      }
                    />
                    <Row
                      label="人工改价说明"
                      value={String(item.priceOverrideReason ?? '')}
                      full
                    />
                  </>
                ) : null}
                <Row
                  label="生产安排"
                  value={
                    item.tasks.length
                      ? item.tasks
                          .map(
                            (task) =>
                              `${task.craft.name}：${task.worker?.displayName ?? '未派工'}`,
                          )
                          .join('；')
                      : '尚未排产'
                  }
                  full
                />
              </dl>
              {canViewCommercialAmounts && 'pricingSnapshot' in item ? (
                <PricingSnapshotBreakdown
                  pricingSnapshot={item.pricingSnapshot}
                  title="收费项目明细"
                  className="mt-4"
                />
              ) : null}
              {item.remark ? (
                <HighlightedRemark
                  className="admin-wrap-anywhere mt-3"
                >
                  {item.remark}
                </HighlightedRemark>
              ) : null}
              <DesignUploadPanel
                orderId={order.id}
                orderItemId={item.id}
                canEdit={canEditDesigns}
                designs={item.designs.map((d) => ({
                  id: d.id,
                  fileName: d.fileName,
                  fileType: d.fileType,
                  // bucket 私有：IMAGE 缩略图换成 30min 预签 GET。CDR 不签
                  // ——面板只显示 chip，把可用下载 URL 发给无 CDR 权限的
                  // 角色是越权（受控下载口在 /api/cdr/bundles）。
                  fileUrl:
                    d.fileType === 'IMAGE' ? signDesignReadUrl(d.fileUrl) : '',
                  // BigInt 不能过 RSC 序列化边界
                  fileSize: String(d.fileSize),
                }))}
              />
            </li>
          ))}
        </ol>
      </section>

      {canRequestChange ? (
        <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div>
            <h2 className="text-base font-semibold">申请修改工单</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              管理员批准后，款式、待生产任务和各端显示才会统一更新。
            </p>
          </div>
          <OrderChangeRequestForm
            orderId={order.id}
            items={order.items.map((item) => ({
              id: item.id,
              sequence: item.sequence,
              name: item.name,
              quantity: item.quantity,
              specification: item.specification,
              foilColors: item.foilColors,
            }))}
          />
        </section>
      ) : null}

      {user.role !== Role.WORKER && order.changeRequests.length > 0 ? (
        <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">工单修改申请</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                当前工单版本：第 {order.revision} 版
              </p>
            </div>
            {pendingChangeRequest ? (
              <Badge variant="outline">有待审核申请</Badge>
            ) : null}
          </div>
          <ol className="space-y-3">
            {order.changeRequests.map((request) => (
              <li key={request.id} className="min-w-0 rounded-lg border p-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <Badge
                    variant={
                      request.status === OrderChangeRequestStatus.REJECTED
                        ? 'destructive'
                        : request.status === OrderChangeRequestStatus.APPROVED
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {changeRequestStatusLabel(request.status)}
                  </Badge>
                  <span className="font-medium">
                    {'requester' in request
                      ? (request.requester as { displayName: string }).displayName
                      : '—'}
                  </span>
                  <span className="text-muted-foreground">
                    基于第 {request.baseRevision} 版 ·{' '}
                    {formatDateTimeShanghai(request.createdAt)}
                  </span>
                </div>
                <p className="admin-wrap-anywhere mt-2 text-sm">
                  原因：{request.reason}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {describeOrderChanges(request.proposedChanges).map(
                    (description, index) => (
                      <li key={`${request.id}-${index}`}>{description}</li>
                    ),
                  )}
                </ul>
                {request.reviewRemark ? (
                  <p className="admin-wrap-anywhere mt-2 text-xs text-muted-foreground">
                    审核备注：{request.reviewRemark}
                  </p>
                ) : null}
                {user.role === Role.ADMIN &&
                request.status === OrderChangeRequestStatus.PENDING ? (
                  <div className="mt-3 border-t pt-3">
                    <OrderChangeReviewForm requestId={request.id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {reassignmentView.tasks.length > 0 ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div>
            <h2 className="text-base font-semibold">未开工任务改派</h2>
            <p className="text-xs text-muted-foreground">
              只能改派未开工任务；已开工或已完工任务会固定师傅与薪资归属。
            </p>
          </div>
          <ul className="divide-y text-sm">
            {reassignmentView.tasks.map((task) => (
              <li
                key={task.id}
                className="grid items-center gap-3 py-3 sm:grid-cols-[1fr_1fr_minmax(320px,1.5fr)]"
              >
                <span>#{task.itemSequence} · {task.itemName}</span>
                <span>
                  {task.craftName}
                  <span className="ml-2 text-xs text-muted-foreground">
                    当前：{task.currentWorkerName ?? '未派工'}
                  </span>
                </span>
                <ReassignTaskForm
                  taskId={task.id}
                  orderId={order.id}
                  currentWorkerId={task.currentWorkerId}
                  craftId={task.craftId}
                  eligibleWorkers={task.eligibleWorkers}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <OrderMaterialUsageEstimate estimate={materialEstimate} />

      {pieceworkSummary ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">计件工资关联</h2>
              <p className="text-xs text-muted-foreground">
                仅管理员可见；金额来自已生成的日薪任务明细。
              </p>
            </div>
            <strong className="admin-wrap-anywhere font-sans tabular-nums text-primary">
              合计 ¥ {pieceworkSummary.total}
            </strong>
          </div>
          {pieceworkSummary.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无已汇总计件明细。</p>
          ) : (
            <ul className="divide-y text-sm">
              {pieceworkSummary.items.map((item) => (
                <li
                  key={item.id}
                  className="grid gap-2 py-3 sm:grid-cols-[120px_1fr_100px_140px]"
                >
                  <span>{item.dailySalary.worker.displayName}</span>
                  <span className="admin-wrap-anywhere min-w-0">
                    {item.orderItemName} · {item.craftName}
                  </span>
                  <span className="font-sans tabular-nums sm:text-right">¥ {String(item.pieceworkAmount)}</span>
                  <Link
                    href={`/owner/salary/daily/${item.dailySalaryId}`}
                    className="text-xs text-primary underline sm:justify-end sm:text-right"
                  >
                    查看工资明细
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {user.role === Role.ADMIN ? (
        <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div>
            <h2 className="text-base font-semibold">成本补录与调整</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              计件工资和外协金额会在账单中自动汇总；这里补录材料、{order.isSfCollect ? '' : '物流重量费用、'}伙食费、电费等自定义成本。
            </p>
          </div>
          {order.costEntries.length > 0 ? (
            <div
              className="overflow-x-auto"
              role="region"
              aria-label="工单成本明细"
              tabIndex={0}
            >
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">类型</th>
                    <th className="px-2 py-2 text-left">名称</th>
                    <th className="px-2 py-2 text-left">数量/单价</th>
                    <th className="px-2 py-2 text-right">金额</th>
                    <th className="px-2 py-2 text-left">记录人</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {order.costEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-2 py-2">
                        {ORDER_COST_LABELS[entry.category]}
                      </td>
                      <td className="admin-wrap-anywhere px-2 py-2">
                        {entry.description}
                        {entry.remark ? (
                          <p className="text-xs text-muted-foreground">
                            {entry.remark}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {entry.quantity
                          ? `${String(entry.quantity)} ${entry.unit ?? ''}`
                          : '—'}
                        {entry.unitPrice
                          ? ` × ¥ ${String(entry.unitPrice)}`
                          : ''}
                      </td>
                      <td className="px-2 py-2 text-right font-sans tabular-nums">
                        ¥ {String(entry.amount)}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {'createdBy' in entry
                          ? (entry.createdBy as { displayName: string }).displayName
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无人工补录成本。</p>
          )}
          <div className="border-t pt-4">
            <OrderCostEntryForm
              orderId={order.id}
              initialIdempotencyKey={randomUUID()}
              isSfCollect={order.isSfCollect}
            />
          </div>
        </section>
      ) : null}

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold">修改日志</h2>
        {order.logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无</p>
        ) : (
          <ul className="divide-y text-sm">
            {order.logs.slice(0, 10).map((log) => {
              const changes = formatOrderLogChanges(
                canViewCommercialAmounts && 'changedFields' in log
                  ? log.changedFields
                  : undefined,
              );
              return (
                <li key={log.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {formatDateTimeShanghai(log.createdAt)}
                    </span>
                    <span className="font-medium">{actionLabel(log.action)}</span>
                    <span className="text-muted-foreground">
                      · {log.operator.displayName}（{roleLabel(log.operator.role)}）
                    </span>
                    {canViewCommercialAmounts &&
                    'remark' in log &&
                    log.remark ? (
                      <span className="text-muted-foreground">· {String(log.remark)}</span>
                    ) : null}
                  </div>
                  {changes.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {changes.map((c) => (
                        <li key={c.field} className="flex min-w-0 flex-wrap items-start gap-2">
                          <span className="min-w-20 text-muted-foreground">
                            {c.label}
                          </span>
                          <span className="admin-wrap-anywhere line-through text-muted-foreground">
                            {c.before}
                          </span>
                          <span>→</span>
                          <span className="admin-wrap-anywhere font-medium">{c.after}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canShip ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">标记发货</h2>
          <p className="text-xs text-muted-foreground">
            所有任务已完工，工单进入 COMPLETED；标记发货后状态切到
            SHIPPED，可填运单号备查。
          </p>
          <ShipOrderForm
            orderId={order.id}
            shipments={order.shipments.map((shipment) => ({
              id: shipment.id,
              sequence: shipment.sequence,
              receiverName: shipment.receiverName,
              receiverAddress: shipment.receiverAddress,
              trackingNo: shipment.trackingNo,
              weightKg: shipment.weightKg ? String(shipment.weightKg) : null,
              destinationProvince: shipment.destinationProvince,
              shippingFee:
                customerChargeByShipmentAndCategory.get(
                  `${shipment.id}:SHIPPING_FEE`,
                )?.amount?.toString() ?? null,
              packingMaterialFee:
                customerChargeByShipmentAndCategory.get(
                  `${shipment.id}:PACKING_MATERIAL`,
                )?.amount?.toString() ?? null,
              customerChargeOverrideReason:
                customerChargeByShipmentAndCategory.get(
                  `${shipment.id}:SHIPPING_FEE`,
                )?.overrideReason ??
                customerChargeByShipmentAndCategory.get(
                  `${shipment.id}:PACKING_MATERIAL`,
                )?.overrideReason ??
                null,
            }))}
            isExternalSales={
              'settlementType' in order &&
              order.settlementType === OrderSettlementType.EXTERNAL_SALES
            }
            isSfCollect={order.isSfCollect}
          />
        </section>
      ) : null}

      {canShipOrFinish &&
      order.status === OrderStatus.COMPLETED &&
      hasLiveOutsource ? (
        <section className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-6">
          <h2 className="text-base font-semibold">暂不能发货</h2>
          <p className="text-sm text-muted-foreground">
            该工单仍有已发送或进行中的外协单。请先在外协管理中标记收货或取消，系统才会开放发货。
          </p>
          <Link
            href="/foreman/outsource"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            查看外协单
          </Link>
        </section>
      ) : null}

      {canFinish ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">确认完工</h2>
          <p className="text-xs text-muted-foreground">
            发货确认收件 / 客户对账后点确认完工；状态切到 FINISHED 终态，
            工单不再活跃，但仍参与月度账单生成。
          </p>
          <FinishOrderButton orderId={order.id} />
        </section>
      ) : null}

      {canCreateRework ? (
        <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div>
            <h2 className="text-base font-semibold">发起重做排单</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              适用于质量问题或物流损毁。系统会创建关联的新工单进入待排产；
              原工单状态、应收账单和历史工资保持不变。
            </p>
          </div>
          <ReworkOrderForm
            sourceOrderId={order.id}
            items={order.items.map((item) => ({
              id: item.id,
              sequence: item.sequence,
              name: item.name,
              quantity: item.quantity,
              crafts: reworkCraftOptions.filter((craft) =>
                item.crafts.includes(craft.id),
              ),
            }))}
          />
        </section>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row">
        {canSubmit ? <SubmitOrderButton orderId={order.id} /> : null}
        {canCancel ? (
          <div className="min-w-0 flex-1 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
            <h2 className="mb-2 text-base font-semibold">取消工单</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              取消后工单进入 CANCELLED 终态，不再参与排产 / 生产。仅管理员可操作。
            </p>
            <CancelOrderForm orderId={order.id} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tabular,
  full,
}: {
  label: string;
  value: string | null | undefined;
  tabular?: boolean;
  full?: boolean;
}) {
  const display = value === null || value === undefined || value === '' ? '—' : value;
  return (
    <div className={full ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          tabular
            ? 'admin-wrap-anywhere font-sans tabular-nums'
            : 'admin-wrap-anywhere'
        }
      >
        {display}
      </dd>
    </div>
  );
}

const QUANTITY_FORMATTER = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 0,
});

function formatQuantity(value: number): string {
  return QUANTITY_FORMATTER.format(value);
}

function changeRequestStatusLabel(status: OrderChangeRequestStatus): string {
  return {
    [OrderChangeRequestStatus.PENDING]: '待审核',
    [OrderChangeRequestStatus.APPROVED]: '已批准',
    [OrderChangeRequestStatus.REJECTED]: '已拒绝',
    [OrderChangeRequestStatus.CANCELLED]: '已撤销',
    [OrderChangeRequestStatus.STALE]: '版本已过期',
  }[status];
}

function describeOrderChanges(value: unknown): string[] {
  const items = (value as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return ['申请数据无法显示'];
  return items.map((raw) => {
    const change = raw as {
      operation?: string;
      itemId?: string;
      templateItemId?: string;
      name?: string;
      quantity?: number;
      specification?: string | null;
      foilColors?: string[];
    };
    const fields = [
      change.name ? `名称“${change.name}”` : null,
      change.quantity ? `数量 ${change.quantity}` : null,
      change.specification !== undefined
        ? `规格“${change.specification || '空'}”`
        : null,
      change.foilColors
        ? `烫金色 ${change.foilColors.join('、') || '无颜色'}`
        : null,
    ].filter(Boolean);
    return change.operation === 'ADD'
      ? `新增款式（参考 ${change.templateItemId ?? '未知款式'}）：${fields.join('，')}`
      : `修改款式 ${change.itemId ?? '未知款式'}：${fields.join('，')}`;
  });
}

const ORDER_COST_LABELS: Record<OrderCostCategory, string> = {
  [OrderCostCategory.MATERIAL]: '材料',
  [OrderCostCategory.PIECEWORK]: '计件',
  [OrderCostCategory.SETUP]: '上板/装板',
  [OrderCostCategory.OUTSOURCE]: '外协',
  [OrderCostCategory.SHIPPING]: '物流',
  [OrderCostCategory.MEAL]: '伙食费',
  [OrderCostCategory.ELECTRICITY]: '电费',
  [OrderCostCategory.CUSTOM]: '其他',
  [OrderCostCategory.ADJUSTMENT]: '调整',
};
