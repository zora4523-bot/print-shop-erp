import { HistoricalBlankPriceEditor } from '@/components/business/order/HistoricalBlankPriceEditor';
import { readHistoricalBlankPriceEditor } from '@/lib/order/confirm-historical-blank-price';
import { listOrderReportDisputes } from '@/lib/production/report-dispute';
import { ReportDisputeAdminPanel } from '@/components/business/production/ReportDisputeAdminPanel';
import { OrderWagePanel } from '@/components/business/salary/OrderWagePanel';
import { PayrollPassForm } from '@/components/business/production/PayrollPassForm';
import { productionOperationPassCount } from '@/lib/production/operation-quantity';
import { canEditAllOrderFees } from '@/lib/order/admin-fee-policy';
import { AdminOrderFeeEditor } from '@/components/business/order/AdminOrderFeeEditor';
import { getOrderProductionReadiness } from '@/lib/order/production-readiness-query';
import { ProductionReadinessWarning } from '@/components/business/order/ProductionReadinessWarning';
import { getLegacyProductionFactsRepair } from '@/lib/order/legacy-production-facts-presentation';
import { LegacyProductionFactsRepairForm } from '@/components/business/order/LegacyProductionFactsRepairForm';
import { PACKAGING_MODE_LABELS } from '@/lib/order/packaging-mode';
import { canChangeOrderPackaging } from '@/lib/order/editable-fields';
import { OrderActivity } from '@/components/business/order/OrderActivity';
import { readOrderActivity } from '@/lib/order/activity';
import { ShipmentRegistrationForm } from '@/components/business/order/ShipmentRegistrationForm';
import { getAdminOrderDetailPresentation } from '@/lib/order/admin-detail-query';
import { buildAdminOrderDetailModel } from '@/components/business/order/admin-order-detail-model';
import { AdminOrderDetailView } from '@/components/business/order/AdminOrderDetailView';
import { AdminOrderDetailDecision } from '@/components/business/order/AdminOrderDetailDecision';
import { listActiveOrderChangeCatalogProducts } from '@/lib/order/change-request-catalog-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import Decimal from 'decimal.js';
import { DESIGN_GRID_WARN_THRESHOLD } from '@/components/business/order/design-grid';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import {
  OrderChangeRequestStatus,
  OrderCostCategory,
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderKind,
  OrderProductStructure,
  OrderSettlementType,
  OrderStatus,
  OutsourceStatus,
  PieceworkOperationType,
  ProductionOperationStatus,
  Role,
} from '../../../../generated/prisma/enums';
import { getSession, requireSession } from '@/lib/auth/session';
import { getOrderDetail } from '@/lib/order';
import { getOrderTitleRef } from '@/lib/page-title/refs';
import { orderDetailTitle } from '@/lib/page-title/titles';
import { canAttachOutsource } from '@/lib/order/status-machine';
import { canCreateReworkFromStatus } from '@/lib/order/rework-eligibility';
import {
  canEditOrderSfCollect,
  canRequestOrderModification,
  editableFieldsetForStatus,
  isOrderEditable,
} from '@/lib/order/editable-fields';
import { roleLabel } from '@/lib/auth/role-labels';
import {
  actionLabel,
  formatOrderLogChanges,
} from '@/lib/order/log-format';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { ActionNotice, DisabledReason, TableEmptyState, TableScrollArea, ReceiptNotice } from '@/components/ui-business';
import { readReceipt } from '@/lib/admin/receipt';
import { BreadcrumbEntity } from '@/components/business/admin/breadcrumb-entity';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import { ChangeRequestStatusBadge } from '@/components/business/order/ChangeRequestStatusBadge';
import { ShipmentStatusBadge } from '@/components/business/order/ShipmentStatusBadge';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import { SubmitOrderButton } from '@/components/business/order/SubmitOrderButton';
import { CancelOrderForm } from '@/components/business/order/CancelOrderForm';
import { UrgentToggleForm } from '@/components/business/order/UrgentToggleForm';
import { SfCollectToggleForm } from '@/components/business/order/SfCollectToggleForm';
import { FulfillmentPricingReviewForm } from '@/components/business/order/FulfillmentPricingReviewForm';
import { isFulfillmentPricingStatus } from '@/lib/order/fulfillment-pricing-policy';
import { DesignUploadPanel } from '@/components/business/order/DesignUploadPanel';
import { PromisedDateBadge } from '@/components/business/order/PromisedDateBadge';
import { signDesignReadUrl } from '@/lib/oss/read-url';
import { OrderMaterialUsageEstimate } from '@/components/business/bom/OrderMaterialUsageEstimate';
import { estimateMaterialUsageForOrderItems } from '@/lib/bom';
import {
  formatDateInputShanghai,
  formatDateShanghai,
  formatDateTimeShanghai,
} from '@/lib/format/dates';
import { getOrderPieceworkSummary } from '@/lib/salary/daily';
import { HighlightedRemark } from '@/components/business/order/HighlightedRemark';
import { formatFoilColors } from '@/lib/order/foil-colors';
import { listExternalCreateOrderFoilOptions } from '@/lib/material';
import { hasLogisticsChargeRows, orderBillsLogistics } from '@/lib/order/settlement';
import {
  getReworkCraftOptions,
  reworkItemRequiresUnitsPerBagInput,
} from '@/lib/order/rework';
import { ReworkOrderForm } from '@/components/business/order/ReworkOrderForm';
import { OrderChangeRequestForm } from '@/components/business/order/OrderChangeRequestForm';
import { OrderCancellationRequestForm } from '@/components/business/order/OrderCancellationRequestForm';
import { OrderPricingReviewForm } from '@/components/business/order/OrderPricingReviewForm';
import { OrderCommercialDetailsManager } from '@/components/business/order/OrderCommercialDetailsManager';
import { OrderChangeFieldDiff } from '@/components/business/order/OrderChangeFieldDiff';
import { OrderCostEntryForm } from '@/components/business/bill/OrderCostEntryForm';
import { formatReceiverInfo } from '@/lib/order/receiver-info';
import { formatMoney, formatMoneyPlain } from '@/lib/dashboard/format';
import { formatUnitPrice } from '@/lib/format/unit-price';
import { ORDER_SETTLEMENT_LABELS } from '@/lib/order/settlement';
import {
  isOrderPricingReviewAllowedStatus,
  ORDER_PRICING_STATUS,
  orderPricingStatusLabel,
} from '@/lib/order/pricing-status';
import { orderPricingSourceLabel } from '@/lib/order/pricing-source';
import {
  deriveLegacyOrderItemFoilFacts,
  ORDER_PRICING_ROUTE_LABELS,
} from '@/lib/order/pricing-route';
import {
  isTrustedAdminChargePricingSnapshot,
} from '@/lib/order/admin-pricing-snapshot';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { PricingSnapshotBreakdown } from '@/components/business/price/PricingSnapshotBreakdown';
import { orderDetailAmounts } from '@/lib/order/detail-amounts';
import { OrderAmount } from '@/components/business/order/OrderAmount';
import { OrderDetailTimeline } from '@/components/business/order/OrderDetailTimeline';
import { OrderDetailStickyScope } from '@/components/business/order/OrderDetailStickyScope';
import {
  buildOrderDetailTimeline,
  orderCancelImpact,
} from '@/components/business/order/order-detail-timeline';
import { listOrderTaskDisputes } from '@/lib/production/task-dispute';
import { TaskDisputeAdminPanel } from '@/components/business/production/TaskDisputeAdminPanel';
import {
  listOrderProductionOperations,
  listOrderProductionProgressSteps,
} from '@/lib/production/operation-order-view';
import { getSalesOrderDetailById } from '@/lib/order/sales-detail-query';
import { SalesOrderDetailView } from '@/components/business/order/SalesOrderDetailView';
import {
  orderShippingAvailability,
} from '@/lib/order/shipping-availability';
import { canShowAdminDirectCancel } from '@/lib/order/direct-cancel';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  // 用 getSession() 而不是 requireSession()：流式 metadata 下首屏可能
  // 已经冲出去了，这里抛异常未必还能正常落到 error.tsx。真闸口在下面的
  // 页面组件（requireSession + getOrderDetail 的 scope 过滤）。
  const session = await getSession();
  if (!session) return { title: '工单' };
  const ref = await getOrderTitleRef(id, session.user.id, session.user.role);
  return { title: orderDetailTitle(ref?.orderNo ?? null) };
}

export default async function OrderDetailPage({ params, searchParams }: PageProps) {
  const { user } = await requireSession();
  const { id } = await params;
  const receipt = readReceipt(await searchParams);
  // SALES uses a narrow, customer-facing query and operation page. The legacy
  // shared detail includes production tasks/workers, audit logs, plate data,
  // pricing snapshots and internal costs, so SALES must branch before that
  // query runs. Keep real draft/design/change actions on the safe surface.
  if (user.role === Role.SALES) {
    const [salesOrder, catalogProducts, foilColors] = await Promise.all([
      getSalesOrderDetailById({ id: user.id, role: user.role }, id),
      listActiveOrderChangeCatalogProducts(),
      listExternalCreateOrderFoilOptions(),
    ]);
    if (!salesOrder) notFound();
    return (
      <div className="space-y-4">
        <ReceiptNotice receipt={receipt} noun="工单" />
        <SalesOrderDetailView
          order={salesOrder}
          catalogProducts={catalogProducts}
          foilColorNames={foilColors.map((foil) => foil.name)}
        />
      </div>
    );
  }
  const order = await getOrderDetail(id, { id: user.id, role: user.role });
  // 打印网格是按款式排的，所以阈值也按「单个款式的设计图数」判定，
  // 不是整单累加。
  const maxDesignsPerItem = Math.max(
    0,
    ...(order?.items ?? []).map((item) => item.designs.length),
  );
  if (!order) notFound();
  const reportDisputes = user.role === Role.ADMIN ? await listOrderReportDisputes(order.id, user) : [];
  const adminActivity = user.role === Role.ADMIN ? await readOrderActivity(order.id, user) : null;
  const historicalBlankPrices = user.role === Role.ADMIN ? await readHistoricalBlankPriceEditor(order.id, user) : null;
  const canViewCommercialAmounts = user.role !== Role.WORKER;
  const canCreateRework =
    user.role === Role.ADMIN &&
    order.kind !== OrderKind.REWORK &&
    canCreateReworkFromStatus(order.status);
  const [
    materialEstimate,
    pieceworkSummary,
    taskDisputes,
    reworkCraftOptions,
    productionOperations,
    productionProgressSteps,
  ] = await Promise.all([
    estimateMaterialUsageForOrderItems(order.items),
    user.role === Role.ADMIN
      ? getOrderPieceworkSummary(order.id)
      : Promise.resolve(null),
    user.role === Role.ADMIN
      ? listOrderTaskDisputes(order.id, { id: user.id, role: user.role })
      : Promise.resolve([]),
    canCreateRework
      ? getReworkCraftOptions(order.items.flatMap((item) => item.crafts))
      : Promise.resolve([]),
    listOrderProductionOperations(order.id),
    listOrderProductionProgressSteps(order.id),
  ]);

  const canSubmit =
    order.status === OrderStatus.DRAFT &&
    (order.submitterId === user.id || user.role === Role.ADMIN);
  const canCancel = canShowAdminDirectCancel(user.role, order.status);
  // 发货与结算权限：order:ship = ADMIN（见 permissions.ts）。
  // action 层仍会重新校验，这里只控制界面入口。
  const canShipOrSettle = user.role === Role.ADMIN;
  const canRepairProductionFacts = user.role === Role.ADMIN && order.purpose !== 'SAMPLE_SHIPMENT';
  const repairFacts = canRepairProductionFacts ? getLegacyProductionFactsRepair(order) : null;
  const isExternalSalesOrder =
    'settlementType' in order &&
    order.settlementType === OrderSettlementType.EXTERNAL_SALES;
  // Delivery billed through logistics rows (external sales; internal orders
  // submitted since 2026-09-18): ship-time confirmation, fulfilment
  // corrections and the 顺丰到付 toggle behave the same for all of them.
  const billsLogistics =
    'settlementType' in order &&
    orderBillsLogistics({
      settlementType: order.settlementType as OrderSettlementType,
      purpose: order.purpose,
      hasLogisticsRows: hasLogisticsChargeRows(order.customerCharges),
    });
  const isChargeableOrder =
    'settlementType' in order &&
    order.settlementType !== OrderSettlementType.NO_CHARGE;
  const pricingStatus: string | null =
    canViewCommercialAmounts && 'pricingStatus' in order
      ? String(order.pricingStatus)
      : null;
  const priceRevision =
    canViewCommercialAmounts &&
    'priceRevision' in order &&
    typeof order.priceRevision === 'number'
      ? order.priceRevision
      : null;
  const showSavedPricingReadiness = canRepairProductionFacts && pricingStatus === ORDER_PRICING_STATUS.ADMIN_CONFIRMED && (order.status === OrderStatus.SUBMITTED || order.status === OrderStatus.PENDING_FACTORY);
  const savedPricingReadiness = showSavedPricingReadiness ? await getOrderProductionReadiness(order.id) : undefined;
  const isPricingPending =
    pricingStatus === ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION;
  const hasLiveOutsource = order.outsourceOrders.some(
    (row) =>
      row.status === OutsourceStatus.SENT ||
      row.status === OutsourceStatus.IN_PROGRESS,
  );
  // Editing follows SPEC §3.6. Ownership mirrors the action-layer
  // guard: SALES / CUSTOMER_SERVICE only their own; ADMIN
  // any. Server still re-verifies on submit — this is UI-only.
  const pendingChangeRequest = order.changeRequests.find(
    (request) => request.status === OrderChangeRequestStatus.PENDING,
  );
  const canEdit =
    !pendingChangeRequest &&
    isOrderEditable(order.status) &&
    (order.submitterId === user.id || user.role === Role.ADMIN);
  // 急单 toggle lives in the FULL fieldset only (DRAFT/SUBMITTED).
  const canToggleUrgent = editableFieldsetForStatus(order.status) === 'FULL' && canEdit;
  // Mirrors the gate in lib/order/commercial-details.ts: INTERNAL_SALES is
  // excluded because that path records no 客服业绩 delta.
  const canAdminManageCommercialDetails =
    (order.purpose ?? 'STANDARD') === 'STANDARD' &&
    user.role === Role.ADMIN &&
    (isExternalSalesOrder ||
      ('settlementType' in order && order.settlementType === OrderSettlementType.FACTORY_DIRECT)) &&
    order.status !== OrderStatus.SETTLED &&
    order.status !== OrderStatus.FINISHED &&
    order.status !== OrderStatus.CANCELLED;
  const canShowPricingReviewForm =
    user.role === Role.ADMIN &&
    isChargeableOrder &&
    (isPricingPending || order.purpose === 'PROOF') &&
    isOrderPricingReviewAllowedStatus(order.status, order.purpose);
  const canReviewFulfillmentPricing =
    user.role === Role.ADMIN &&
    billsLogistics &&
    isFulfillmentPricingStatus(order.status);
  const isFinalizedExternalShipment =
    order.status === OrderStatus.SHIPPED &&
    billsLogistics;
  // 补录（priceBookId 为 null）的快递费在标记顺丰到付时会被清零，见 setOrderSfCollect。
  const manualFreightToWaive = (() => {
    if (!canViewCommercialAmounts || billsLogistics || order.isSfCollect) return null;
    const total = order.customerCharges
      .filter((charge) => String(charge.category.code) === 'SHIPPING_FEE' && charge.priceBookId == null && String(charge.status) !== 'WAIVED' && charge.amount != null)
      .reduce((sum, charge) => sum.plus(String(charge.amount)), new Decimal(0));
    return total.isZero() ? null : formatMoney(total);
  })();
  const canToggleSfCollect =
    order.purpose !== 'PROOF' &&
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
  const allTasks = order.items.flatMap((item) => item.tasks);
  const hasProductionOperations = productionOperations.length > 0;
  const productionUnits = hasProductionOperations
    ? [...productionOperations, ...productionProgressSteps]
    : allTasks;
  const pendingProductionCount = productionUnits.filter(
    (unit) => unit.status === 'PENDING',
  ).length;
  const inProgressProductionCount = productionUnits.filter(
    (unit) => unit.status === 'IN_PROGRESS',
  ).length;
  const completedProductionCount = productionUnits.filter(
    (unit) => unit.status === 'COMPLETED',
  ).length;
  const operationsByOrderItemId = new Map<
    string,
    typeof productionOperations
  >();
  for (const operation of productionOperations) {
    for (const source of operation.sources) {
      if (!source.orderItemId) continue;
      const current = operationsByOrderItemId.get(source.orderItemId) ?? [];
      current.push(operation);
      operationsByOrderItemId.set(source.orderItemId, current);
    }
  }
  const progressByOrderItemId = new Map<
    string,
    typeof productionProgressSteps
  >();
  for (const step of productionProgressSteps) {
    const current = progressByOrderItemId.get(step.orderItemId) ?? [];
    current.push(step);
    progressByOrderItemId.set(step.orderItemId, current);
  }
  const liveOutsourceCount = order.outsourceOrders.filter(
    (row) =>
      row.status === OutsourceStatus.SENT ||
      row.status === OutsourceStatus.IN_PROGRESS,
  ).length;
  const incompleteProductionCount =
    pendingProductionCount + inProgressProductionCount;
  const { canShip, disabledReason: shipDisabledReason } =
    orderShippingAvailability({
      isAdministrator: canShipOrSettle,
      status: order.status,
      incompleteProductionCount,
      hasLiveOutsource,
      isPricingPending,
      hasShipment: order.shipments.length > 0,
      hasPendingChange: Boolean(pendingChangeRequest),
    });
  const timelineSteps = buildOrderDetailTimeline({
    status: order.status,
    createdAt: order.createdAt,
    submittedAt: order.submittedAt ?? null,
    completedAt: order.completedAt ?? null,
    promisedDate: order.promisedDate,
    submitterName: order.submitter.displayName,
    logs: order.logs.map((log) => ({
      action: log.action,
      createdAt: log.createdAt,
      operatorName: log.operator.displayName,
      changedFields: 'changedFields' in log ? log.changedFields : undefined,
    })),
    productionUnits: productionUnits.map((unit) => ({ status: unit.status })),
    uncoveredOutsourceNames: order.uncoveredOutsourceItems.map(
      (item) => `#${item.sequence} ${item.name}`,
    ),
    hasLiveOutsource,
    pendingChangeRequest: Boolean(pendingChangeRequest),
  });
  const cancelImpact = orderCancelImpact({
    pendingProductionCount,
    inProgressProductionCount,
    completedProductionCount,
    liveOutsourceCount,
  });
  const canRequestChange =
    user.role === Role.CUSTOMER_SERVICE &&
    canRequestOrderModification(user, order, Boolean(pendingChangeRequest));
  const canRequestCancellation =
    user.role === Role.CUSTOMER_SERVICE &&
    order.submitterId === user.id &&
    (order.status === OrderStatus.CONFIRMED ||
      order.status === OrderStatus.RELEASED ||
      order.status === OrderStatus.FOILING ||
      order.status === OrderStatus.PACKING) &&
    !pendingChangeRequest;
  const [orderChangeCatalogProducts, orderChangeFoilColors] = canRequestChange
    ? await Promise.all([listActiveOrderChangeCatalogProducts(), listExternalCreateOrderFoilOptions()])
    : [[], []];
  const manualCustomerCharges = order.customerCharges.filter((charge) =>
    ['SAMPLE_FEE', 'OTHER_PACKAGING_FEE', 'APPROVED_ADJUSTMENT'].includes(
      String(charge.category.code),
    ),
  );
  const presentation = user.role === Role.ADMIN
    ? await getAdminOrderDetailPresentation(user, {
        id: order.id, orderNo: order.orderNo, revision: order.revision,
        editVersion: order.editVersion, workOrderVersion: order.workOrderVersion,
        priceRevision: 'priceRevision' in order && typeof order.priceRevision === 'number' ? order.priceRevision : undefined,
      })
    : null;
  const inlineOperations = presentation?.workspace.inlineOperations;

  const detailSections = {
    pricing: (<><ProductionReadinessWarning readiness={savedPricingReadiness} saved />{repairFacts ? <LegacyProductionFactsRepairForm canRepair={canRepairProductionFacts} key={`repair-${order.revision}`} facts={repairFacts} /> : null}{isChargeableOrder && pricingStatus ? (
        <section
          id="pricing-review"
          className={
            isPricingPending
              ? 'space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 shadow-sm sm:p-6'
              : 'space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6'
          }
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">工单价格状态</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {isPricingPending
                  ? canReviewFulfillmentPricing
                    ? '物流费用待管理员核对，确认前不能发货或结算；已审核款式价格不变。'
                    : '价格待管理员确认，确认前不可排产。'
                  : '价格已确认。'}
              </p>
            </div>
            <Badge variant={isPricingPending ? 'destructive' : 'secondary'}>
              {orderPricingStatusLabel(pricingStatus)}
            </Badge>
          </div>
          <dl className="grid gap-2 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">价格修订</dt>
              <dd>第 {priceRevision ?? '—'} 版</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">确认人</dt>
              <dd>
                {'pricingConfirmedBy' in order && order.pricingConfirmedBy
                  ? order.pricingConfirmedBy.displayName
                  : pricingStatus === ORDER_PRICING_STATUS.AUTO_CONFIRMED
                    ? '系统自动报价'
                    : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">价格来源</dt>
              <dd>
                {orderPricingSourceLabel(order.pricingRevisions[0]?.source)}
              </dd>
            </div>
          </dl>
          {historicalBlankPrices ? <HistoricalBlankPriceEditor
            key={`material-${historicalBlankPrices.orderRevision}-${historicalBlankPrices.priceRevision}`}
            {...historicalBlankPrices} /> : null}
          {user.role === Role.ADMIN && !pendingChangeRequest && canEditAllOrderFees(order) ? <AdminOrderFeeEditor canEditCommercial={canAdminManageCommercialDetails} key={`all-fees-${order.revision}-${priceRevision}`} orderId={order.id} /> : null}
          {canShowPricingReviewForm && inlineOperations?.pricing !== 'factory' ? (
            <div className="border-t pt-4">
              <OrderPricingReviewForm
                key={`pricing-review-${priceRevision ?? 'unknown'}-${order.revision}`}
                orderId={order.id}
              />
            </div>
          ) : null}
          {canReviewFulfillmentPricing && inlineOperations?.pricing !== 'fulfillment' ? (
            <FulfillmentPricingReviewForm
              key={`fulfillment-${order.id}-${order.revision}-${priceRevision}`}
              orderId={order.id}
              currentValue={order.isSfCollect}
              isPricingPending={isPricingPending}
              shipments={order.shipments.map((shipment) => ({
                id: shipment.id,
                sequence: shipment.sequence,
                destinationProvince: shipment.destinationProvince,
                weightKg: shipment.weightKg?.toString() ?? null,
              }))}
            />
          ) : null}
        </section>
      ) : null}</>),
    commercial: (<>{canAdminManageCommercialDetails &&
      priceRevision !== null ? (
        <OrderCommercialDetailsManager
          orderId={order.id}
          priceRevision={priceRevision}
          allowPlateDetailMaintenance={!isPricingPending}
          manualCharges={manualCustomerCharges.map((charge) => ({
            id: charge.id,
            status: String(charge.status),
            description: charge.description,
            amount: String(charge.amount),
            overrideReason: charge.overrideReason,
            approvalReference: charge.approvalReference,
            category: {
              code: String(charge.category.code),
              name: charge.category.name,
            },
            finalizedBy: charge.finalizedBy,
            finalizedAt: charge.finalizedAt,
          }))}
          items={order.items.map((item) => {
            const foil = deriveLegacyOrderItemFoilFacts(item);
            return {
              id: item.id,
              sequence: item.sequence,
              name: item.name,
              independentPlateEligible:
                item.pricingRoute !== OrderItemPricingRoute.COLOR_PRINT &&
                (foil.frontFoilColors.length > 0 ||
                  foil.backFoilColors.length > 0),
              plateDetails:
                'plateDetails' in item
                  ? item.plateDetails.map((detail) => ({
                      id: detail.id,
                      sequence: detail.sequence,
                      name: detail.name,
                      plateGroupId: detail.plateGroupId,
                      specification: detail.specification,
                      quantity: detail.quantity,
                      unitPrice: String(detail.unitPrice),
                      amount: String(detail.amount),
                      remark: detail.remark,
                      isActive: detail.isActive,
                    }))
                  : [],
            };
          })}
        />
      ) : null}</>),
    otherActions: (<><div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
            <a
              href={`/api/orders/${order.id}/pdf?view=inline`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              打印
            </a>
            <a
              href={`/api/orders/${order.id}/pdf`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              下载 PDF
            </a>
            <Link href={`/print/orders/${order.id}`} prefetch={false} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              网页预览
            </Link>
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
            {canReviewFulfillmentPricing ? (
              <Link href="#fulfillment-pricing" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {isPricingPending ? '确认物流费用' : '更正物流费用'}
              </Link>
            ) : canToggleSfCollect ? (
              <SfCollectToggleForm
                key={`sf-${order.id}-${order.revision}-${priceRevision}`}
                orderId={order.id}
                currentValue={order.isSfCollect}
                status={order.status}
                isExternalSales={billsLogistics}
                manualFreightToWaive={manualFreightToWaive}
                mutationGuard={priceRevision !== null ? {
                  expectedOrderRevision: order.revision,
                  expectedEditVersion: order.editVersion,
                  expectedWorkOrderVersion: order.workOrderVersion,
                  expectedPriceRevision: priceRevision,
                } : undefined}
                shipments={order.shipments.map((shipment) => ({
                  id: shipment.id,
                  sequence: shipment.sequence,
                  destinationProvince: shipment.destinationProvince,
                  weightKg: shipment.weightKg?.toString() ?? null,
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
            {canSubmit ? <SubmitOrderButton orderId={order.id} purpose={order.purpose} /> : null}
            {canShipOrSettle && order.status === OrderStatus.SHIPPED ? (
              isPricingPending ? (
                <DisabledReason
                  cause="prerequisite"
                  reason="价格待管理员确认"
                >
                  <Button type="button" disabled size="sm">
                    结算（价格待确认）
                  </Button>
                </DisabledReason>
              ) : (
                <Link
                  href="#detail-delivery-records"
                  className={buttonVariants({ size: 'sm' })}
                >
                  前往结算
                </Link>
              )
            ) : null}
            {canShip ? (
              <Link
                href="#shipment-registration"
                className={buttonVariants({ size: 'sm' })}
              >
                发货
              </Link>
            ) : canShipOrSettle &&
              order.status !== OrderStatus.SHIPPED &&
              order.status !== OrderStatus.FINISHED &&
              order.status !== OrderStatus.CANCELLED ? (
              <DisabledReason
                cause="prerequisite"
                reason={shipDisabledReason ?? '当前不能发货'}
                fixHref={
                  hasLiveOutsource
                    ? '/foreman/outsource'
                    : order.uncoveredOutsourceItems.length > 0
                      ? `/foreman/outsource/new?orderId=${order.id}`
                      : undefined
                }
                fixLabel={hasLiveOutsource ? '查看外协单' : '补外协'}
              >
                <Button type="button" disabled size="sm">
                  {shipDisabledReason
                    ? `发货（${shipDisabledReason}）`
                    : '发货'}
                </Button>
              </DisabledReason>
            ) : null}
            {canCancel ? (
              <>
                <span
                  aria-hidden="true"
                  className="hidden h-6 w-px bg-border sm:inline-block"
                />
                <CancelOrderForm
                  orderId={order.id}
                  orderNo={order.orderNo}
                  impact={cancelImpact}
                  compact
                />
              </>
            ) : null}
          </div></>),
    basics: (<><OrderBasicSummarySection hideRemark={user.role === Role.ADMIN} {...{
      order, hasProductionOperations, productionOperations, productionProgressSteps,
      assignedWorkerNames, canViewCommercialAmounts,
    }} /></>),
    payrollPass: (<>
      {user.role === Role.ADMIN && ['CONFIRMED', 'RELEASED', 'FOILING', 'PACKING', 'SCHEDULING', 'IN_PRODUCTION'].includes(order.status) && productionOperations.some((op) => op.operationType === 'PARTIAL' && ['PENDING', 'IN_PROGRESS'].includes(op.status)) && <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-6">
        <h2 className="text-base font-semibold">师傅计薪次数</h2>
        <div className="grid gap-3 sm:grid-cols-2">{productionOperations.filter((op) => op.operationType === 'PARTIAL' && ['PENDING', 'IN_PROGRESS'].includes(op.status)).map((op) => <PayrollPassForm key={`${op.id}:${op.payrollRevision}`} operationId={op.id} revision={op.payrollRevision} passCount={op.payrollPassCount ?? productionOperationPassCount(op.operationType, op.sources)} sequences={op.sources.flatMap((s) => s.orderItem ? [s.orderItem.sequence] : [])} />)}</div>
      </section>}
    </>),
    customerCharges: (<>{canViewCommercialAmounts && order.customerCharges.length > 0 ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div>
            <h2 className="text-base font-semibold">对客收费明细</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              对客收费与工厂成本分开统计。
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
                      {charge.shipment
                        ? `地址 ${charge.shipment.sequence} · `
                        : ''}
                      {charge.category.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {charge.description}
                    </p>
                  </div>
                  <Badge
                    variant={
                      charge.status === 'FINAL' ||
                      isTrustedAdminChargePricingSnapshot(
                        charge.pricingSnapshot,
                        charge,
                      )
                        ? 'secondary'
                        : 'outline'
                    }
                  >
                    {charge.status === 'FINAL'
                      ? '已确认'
                      : isTrustedAdminChargePricingSnapshot(
                            charge.pricingSnapshot,
                            charge,
                          )
                        ? '管理员已确认（待结算）'
                      : charge.status === 'WAIVED'
                        ? '已免收'
                        : charge.status === 'PENDING_AMOUNT'
                          ? '金额待定'
                        : '创建时估算'}
                  </Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">实际收费</dt>
                    <dd className="font-sans font-medium tabular-nums">
                      {charge.amount === null
                        ? '待定'
                        : formatMoney(charge.amount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">报价表建议</dt>
                    <dd className="font-sans tabular-nums">
                      {charge.suggestedAmount === null
                        ? charge.status === 'PENDING_AMOUNT'
                          ? '待定'
                          : '人工确认'
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
                    原因：{charge.overrideReason}
                  </p>
                ) : null}
                {charge.approvalReference ? (
                  <p className="mt-2 rounded-md bg-muted/50 p-2 text-xs">
                    审批信息：{charge.approvalReference}
                  </p>
                ) : null}
                {charge.finalizedBy ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    确认人：{charge.finalizedBy.displayName}
                    {charge.finalizedAt
                      ? ` · ${formatDateTimeShanghai(charge.finalizedAt)}`
                      : ''}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}</>),
    shipments: (<><section id="shipment-registration" className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
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
                <ShipmentStatusBadge status={shipment.status} />
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
              {user.role === Role.ADMIN && order.status !== OrderStatus.CANCELLED && order.status !== OrderStatus.FINISHED ? (
                <ShipmentRegistrationForm key={`${shipment.id}:${shipment.registrationVersion}`}
                  orderId={order.id} shipmentId={shipment.id} version={shipment.registrationVersion}
                  revision={order.revision} editVersion={order.editVersion} workOrderVersion={order.workOrderVersion} priceRevision={priceRevision ?? 0}
                  trackingNo={shipment.trackingNo} carrierCode={shipment.carrierCode} carrierName={shipment.carrierName}
                  shipped={shipment.status === 'SHIPPED'} canConfirm={canShip} disabledReason={shipDisabledReason}
                  lastPending={order.shipments.filter((row) => row.status !== 'SHIPPED').length === 1}
                  amount={order.confirmedFee !== null ? formatMoneyPlain(order.confirmedFee) : '待核价'}
                  labels={shipment.labels.map((label) => ({ id: label.id, createdAt: label.createdAt.toISOString() }))}
                />
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
      </section></>),
    rework: (<>{order.sourceOrder || order.reworkOrders.length > 0 ? (
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
      ) : null}</>),
    designFiles: (<><section className={user.role === Role.ADMIN ? "space-y-3" : "space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6"}>
        {user.role !== Role.ADMIN ? <h2 className="text-base font-semibold">款式（{order.items.length}）</h2> : null}
        <ol className="space-y-3">
          {order.items.map((item) => (
            <li key={item.id} className={user.role === Role.ADMIN ? "min-w-0 text-sm" : "min-w-0 rounded-lg border text-sm"}>
              <Disclosure id={`detail-design-item-${item.id}`} className="group/design-item min-w-0">
                <DisclosureSummary className="flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <span className="admin-wrap-anywhere min-w-0 font-medium">
                    <span className="text-muted-foreground">#{item.sequence}</span>
                    {' · '}
                    {item.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatQuantity(item.quantity)} 个
                    {item.craftNames.length
                      ? ` · ${item.craftNames.length} 项工艺`
                      : ''}
                    <span className="ml-2 group-open/design-item:hidden">展开</span>
                    <span className="ml-2 hidden group-open/design-item:inline">收起</span>
                  </span>
                </DisclosureSummary>
              <div className={user.role === Role.ADMIN ? "space-y-3 px-4 pb-4" : "space-y-3 border-t px-4 py-4"}>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <h3 className="sr-only">
                  #{item.sequence} {item.name}
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
                <Row
                  label="计价路线"
                  value={ORDER_PRICING_ROUTE_LABELS[item.pricingRoute]}
                />
                <Row
                  label="产品结构"
                  value={PRODUCT_STRUCTURE_LABELS[item.productStructure]}
                />
                <Row
                  label="产品组合"
                  value={
                    item.product?.name
                      ? externalPriceBusinessText(item.product.name)
                      : null
                  }
                />
                {user.role !== Role.ADMIN ? <>
                <Row
                  label="规格"
                  value={
                    item.specification
                      ? externalPriceBusinessText(item.specification)
                      : null
                  }
                />
                <Row
                  label="实际尺寸"
                  value={formatActualSize(
                    item.actualWidthMm,
                    item.actualHeightMm,
                  )}
                  tabular
                />
                <Row
                  label="纸张"
                  value={
                    item.paperType
                      ? externalPriceBusinessText(item.paperType)
                      : null
                  }
                />
                <Row
                  label="纸张克重"
                  value={
                    item.paperWeightGsm === null
                      ? null
                      : `${formatQuantity(item.paperWeightGsm)} g/㎡`
                  }
                  tabular
                />
                </> : null}
                <Row label="稿件版本" value={item.artworkVersion} />
                <Row
                  label="加工面"
                  value={item.isDoubleSided ? '双面加工' : '单面加工'}
                />
                <Row
                  label="烫金方式"
                  value={FOIL_TECHNIQUE_LABELS[item.foilTechnique]}
                />
                <Row
                  label="烫金颜色"
                  value={formatFoilColorFacts(
                    item.foilColors,
                    item.foilTechnique,
                  )}
                />
                <Row
                  label="双色烫金"
                  value={item.isDoubleColor ? '是' : '否'}
                />
                <Row
                  label="局部烫金"
                  value={formatNullableBoolean(item.hasLocalFoil)}
                />
                <Row
                  label="彩印颜色"
                  value={formatPrintColorFacts(
                    item.printColors,
                    item.printColorsKnown,
                  )}
                  full
                />
                <Row
                  label="工艺"
                  value={item.craftNames.length ? item.craftNames.join('、') : '—'}
                  full
                />
                {canViewCommercialAmounts &&
                item.pricingRoute === OrderItemPricingRoute.MANUAL_QUOTE &&
                'manualQuoteReason' in item ? (
                  <Row
                    label="人工报价原因"
                    value={String(item.manualQuoteReason ?? '')}
                    full
                  />
                ) : null}
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
                {(hasProductionOperations ? (operationsByOrderItemId.get(item.id)?.length ?? 0) > 0 : item.tasks.length > 0) ? (
                <Row
                  label={hasProductionOperations ? '生产工序' : '历史生产记录'}
                  value={
                    hasProductionOperations
                      ? (operationsByOrderItemId.get(item.id) ?? [])
                          .map(
                            (operation) =>
                              `${PRODUCTION_OPERATION_LABELS[operation.operationType]}：${productionOperationStatusLabel(operation.status)}`,
                          )
                          .join('；')
                      : item.tasks
                          .map((task) => `${task.craft.name}：${task.worker?.displayName ?? '历史未分派记录'}`)
                          .join('；')
                  }
                  full
                />
                ) : null}
                {hasProductionOperations && (progressByOrderItemId.get(item.id)?.length ?? 0) > 0 ? (
                  <Row
                    label="无计件进度（不计薪）"
                    value={
                      (progressByOrderItemId.get(item.id) ?? [])
                        .map((step) => {
                          const completed = step.reports.reduce(
                            (sum, report) => sum.plus(report.completedQty),
                            new Decimal(step.carriedCompletedQty?.toString() ?? 0),
                          );
                          return `${step.craftName}：${productionOperationStatusLabel(step.status)}（${completed.toString()}/${step.plannedQty.toString()}）`;
                        })
                        .join('；')
                    }
                    full
                  />
                ) : null}
              </dl>
              {canViewCommercialAmounts &&
              'plateDetails' in item &&
              item.plateDetails.length > 0 ? (
                <div className="mt-4 space-y-2 rounded-md border bg-muted/20 p-3">
                  <h4 className="text-xs font-semibold">制版明细</h4>
                  <ul className="divide-y text-xs">
                    {item.plateDetails.map((detail) => (
                      <li
                        key={detail.id}
                        className="grid gap-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_100px_120px]"
                      >
                        <span className="admin-wrap-anywhere">
                          #{detail.sequence} · {detail.name}
                          {!detail.isActive ? '（已移除）' : ''}
                        </span>
                        <span className="font-sans tabular-nums">
                          {formatQuantity(detail.quantity)} ×{' '}
                          {formatMoney(String(detail.unitPrice))}
                        </span>
                        <span className="font-sans tabular-nums sm:text-right">
                          {formatMoney(String(detail.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
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
              </div>
              </Disclosure>
            </li>
          ))}
        </ol>
      </section></>),
    packaging: (<><OrderPackagingGroupsSection
        order={order}
        canViewCommercialAmounts={canViewCommercialAmounts}
      /></>),
    changeForm: (<>{canRequestChange ? (
        <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div>
            <h2 className="text-base font-semibold">申请修改工单</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              管理员批准后才会更新款式和待生产任务。
            </p>
          </div>
          <OrderChangeRequestForm
              hasPackagingGroups={order.packagingGroups.length > 0}
            promisedDate={formatDateInputShanghai(order.promisedDate, '') || null}
            orderId={order.id}
            expectedRevision={order.revision}
            expectedWorkOrderVersion={order.workOrderVersion}
            catalogProducts={orderChangeCatalogProducts}
            foilColorNames={orderChangeFoilColors.map((foil) => foil.name)}
            items={order.items.map((item) => ({
              id: item.id,
              sequence: item.sequence,
              name: item.name,
              quantity: item.quantity,
              pack: order.packagingGroups.flatMap((group) => group.lines)
                .find((line) => line.orderItem.id === item.id)?.unitsPerBag ?? item.pack,
              packagingEditable: canChangeOrderPackaging(order.status) &&
                order.packagingGroups.flatMap((group) => group.lines)
                  .filter((line) => line.orderItem.id === item.id).length === 1,
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
      ) : null}</>),
    changeHistory: (<>{user.role !== Role.WORKER && order.changeRequests.length > 0 ? (
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
                  <ChangeRequestStatusBadge status={request.status} />
                  <span className="font-medium">
                    {'requester' in request
                      ? (request.requester as { displayName: string }).displayName
                      : '—'}
                  </span>
                  <span className="text-muted-foreground">
                    基于业务第 {request.baseRevision} 版 · 基于生产版本{' '}
                    {request.baseWorkOrderVersion == null
                      ? '历史未记录'
                      : `v${request.baseWorkOrderVersion}`}{' '}
                    · 批准后生产版本{' '}
                    {request.workOrderVersionAfter == null
                      ? '未生成'
                      : `v${request.workOrderVersionAfter}`}{' '}
                    ·{' '}
                    {formatDateTimeShanghai(request.createdAt)}
                  </span>
                </div>
                <p className="admin-wrap-anywhere mt-2 text-sm">
                  原因：{request.reason}
                </p>
                <OrderChangeFieldDiff
                  beforeSnapshot={request.beforeSnapshot}
                  proposedChanges={request.proposedChanges}
                />
                {request.reviewRemark ? (
                  <p className="admin-wrap-anywhere mt-2 text-xs text-muted-foreground">
                    审核备注：{request.reviewRemark}
                  </p>
                ) : null}
                {user.role === Role.ADMIN &&
                request.status === OrderChangeRequestStatus.PENDING ? (
                  <div className="mt-3 border-t pt-3">
                    <Link
                      href="#order-detail-actions"
                      prefetch={false}
                      className={buttonVariants({ size: 'sm' })}
                    >
                      前往工单处理区审核
                    </Link>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}</>),
    disputes: (<>{user.role === Role.ADMIN && <ReportDisputeAdminPanel disputes={reportDisputes} />}{user.role === Role.ADMIN ? (
        <TaskDisputeAdminPanel
          disputes={taskDisputes.map((dispute) => ({
            id: dispute.id,
            status: dispute.status,
            reason: dispute.reason,
            resolution: dispute.resolution,
            resolvedAt: dispute.resolvedAt,
            createdAt: dispute.createdAt,
            workerName: dispute.worker.displayName,
            resolvedByName: dispute.resolvedBy?.displayName ?? null,
            task: {
              id: dispute.productionTask.id,
              itemSequence: dispute.productionTask.orderItem.sequence,
              itemName: dispute.productionTask.orderItem.name,
              craftName: dispute.productionTask.craft.name,
              plannedQty: dispute.productionTask.plannedQty,
              completedQty: dispute.productionTask.completedQty,
              pieceworkAmount: String(dispute.productionTask.pieceworkAmount),
            },
          }))}
        />
      ) : null}</>),
    material: (<><OrderMaterialUsageEstimate estimate={materialEstimate} /></>),
    piecework: (<>{user.role === Role.ADMIN && <OrderWagePanel orderId={order.id} actor={user} />}{pieceworkSummary ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">已生成计件工资</h2>
            </div>
            <strong className="admin-wrap-anywhere font-sans tabular-nums text-primary">
              合计 {formatMoney(pieceworkSummary.total)}
            </strong>
          </div>
          {pieceworkSummary.items.length === 0 ? (
            <TableEmptyState
              variant="compact"
              title="暂无计件工资明细"
            />
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
                  <span className="font-sans tabular-nums sm:text-right">{formatMoney(item.pieceworkAmount)}</span>
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
      ) : null}</>),
    costs: (<>{user.role === Role.ADMIN ? (
        <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div>
            <h2 className="text-base font-semibold">成本补录与调整</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              无需重复录入计件工资和外协费用。
            </p>
          </div>
          {order.costEntries.length > 0 ? (
            <TableScrollArea label="工单成本明细">
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
                          ? ` × ${formatUnitPrice(entry.unitPrice)}`
                          : ''}
                      </td>
                      <td className="px-2 py-2 text-right font-sans tabular-nums">
                        {formatMoney(entry.amount)}
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
            </TableScrollArea>
          ) : (
            <TableEmptyState
              variant="compact"
              title="尚无人工补录成本"
            />
          )}
          <div className="border-t pt-4">
            <OrderCostEntryForm
              orderId={order.id}
              initialIdempotencyKey={randomUUID()}
              isSfCollect={order.isSfCollect}
            />
          </div>
        </section>
      ) : null}</>),
    logs: (<><section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold">修改日志</h2>
        {order.logs.length === 0 ? (
          <TableEmptyState
            variant="compact"
            title="尚无修改记录"
          />
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
      </section></>),
    shippingForm: null,
    completionBlock: (<>{user.role === Role.ADMIN &&
      (order.status === OrderStatus.SCHEDULING ||
        order.status === OrderStatus.IN_PRODUCTION) &&
      order.uncoveredOutsourceItems.length > 0 ? (
        <section className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-6">
          <h2 className="text-base font-semibold">暂不能完工</h2>
          <p className="text-sm text-muted-foreground">
            以下款式含外协工艺，但外协履约数量不足，或还没有未取消的
            外协单。请先创建或补足外协单：
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {order.uncoveredOutsourceItems.map((item) => (
              <li key={item.id}>
                款式 {item.sequence}：{item.name}
              </li>
            ))}
          </ul>
          {canCreateOutsource ? (
            <Link
              href={`/foreman/outsource/new?orderId=${order.id}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              创建外协单
            </Link>
          ) : null}
        </section>
      ) : null}</>),
    shippingBlock: (<>{canShipOrSettle &&
      (order.status === OrderStatus.PACKING ||
        order.status === OrderStatus.COMPLETED) &&
      !canShip ? (
        <section
          id="ship-order"
          className="scroll-mt-28 space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-6"
        >
          <h2 className="text-base font-semibold">暂不能发货</h2>
          <p className="text-sm text-muted-foreground">
            {shipDisabledReason ?? '请先补齐发货前置事实。'}
          </p>
          {hasLiveOutsource ? (
            <Link
              href="/foreman/outsource"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              查看外协单
            </Link>
          ) : null}
        </section>
      ) : null}</>),
    settlementBlock: (<>{canShipOrSettle &&
      order.status === OrderStatus.SHIPPED &&
      isPricingPending ? (
        <section className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-6">
          <h2 className="text-base font-semibold">暂不能结算</h2>
          <p className="text-sm text-muted-foreground">
            当前对客价格待管理员确认。请先完成整单重算并生成终价修订，再结算。
          </p>
        </section>
      ) : null}</>),
    reworkForm: (<>{canCreateRework ? (
        <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div>
          <h2 className="text-base font-semibold">发起重做工单</h2>
          </div>
          <ReworkOrderForm
            sourceOrderId={order.id}
            items={order.items.map((item) => ({
              id: item.id,
              sequence: item.sequence,
              name: item.name,
              quantity: item.quantity,
              requiresUnitsPerBagInput:
                reworkItemRequiresUnitsPerBagInput(
                  order.packagingGroups.filter((group) =>
                    group.lines.some(
                      (line) => line.orderItem.id === item.id,
                    ),
                  ).length,
                  item.pack,
                ),
              crafts: reworkCraftOptions.filter((craft) =>
                item.crafts.includes(craft.id),
              ),
            }))}
          />
        </section>
      ) : null}</>),
  };

  if (user.role === Role.ADMIN) {
    if (!presentation) return <ActionNotice tone="warning" title="工单已更新，请刷新后查看最新资料"
      action={<Link href={`/orders/${order.id}`} className={buttonVariants({ variant: 'outline' })}>重新加载</Link>} />;
    const model = buildAdminOrderDetailModel({
      order, workspace: presentation.workspace, productionOperations, productionProgressSteps,
      workReports: presentation.workReports, signImageUrl: signDesignReadUrl,
    });
    return <>
      <BreadcrumbEntity label={order.orderNo} />
      <ReceiptNotice receipt={receipt} noun="工单" />
      <AdminOrderDetailView model={model} canEdit={canEdit} prints={presentation.prints}
        printHint={maxDesignsPerItem >= DESIGN_GRID_WARN_THRESHOLD
          ? `有款式含 ${maxDesignsPerItem} 张设计图，建议分款式打印以保证清晰度` : undefined}
        decision={<AdminOrderDetailDecision key={`${order.revision}:${order.workOrderVersion}:${presentation.workspace.pendingPrintJobId}`} order={presentation.workspace}
          requiresPaperRecall={presentation.prints.some((print) => print.version < order.workOrderVersion || print.state === 'PRINTED')} />}
        packaging={detailSections.packaging}
        supplementary={[
          { id: 'detail-design-files', title: '设计文件与完整工艺资料', content: detailSections.designFiles },
          { id: 'detail-pricing-tools', title: '计价与收费维护', content: <>{detailSections.pricing}{detailSections.commercial}{detailSections.customerCharges}</> },
          { id: 'detail-delivery-records', title: '配送与发货记录', content: <>{detailSections.shipments}{detailSections.shippingForm}{detailSections.shippingBlock}{detailSections.settlementBlock}</> },
          { id: 'detail-production-records', title: '生产、用料与计件记录', content: <>{detailSections.payrollPass}{detailSections.material}{detailSections.piecework}{detailSections.disputes}{detailSections.completionBlock}</> },
          { id: 'detail-business-records', title: '基本信息、成本与重做', content: <>{detailSections.basics}{detailSections.costs}{detailSections.rework}{detailSections.reworkForm}</> },
          { id: 'detail-audit-records', title: '工单动态', content: <>{adminActivity ? <OrderActivity key={`${order.id}:${adminActivity.events[0]?.id ?? "empty"}`} orderId={order.id} initialPage={adminActivity} /> : null}{detailSections.changeHistory}</> },
          { id: 'detail-other-actions', title: '其他工单操作', content: detailSections.otherActions },
        ]}
      />
    </>;
  }

  return (
    <div className="space-y-4">
      {/* 顶栏面包屑显示业务编号。值来自上面已经查出来的 order，
          不产生额外请求；组件自身不渲染任何 DOM。 */}
      <BreadcrumbEntity label={order.orderNo} />
      <ReceiptNotice receipt={receipt} noun="工单" />
      <OrderDetailStickyScope
        header={
          <>
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
              <span className="admin-wrap-anywhere min-w-0 font-sans tabular-nums">
                {order.customName?.trim() || '未命名工单'}
              </span>
              <OrderStatusBadge status={order.status} />
              {order.isUrgent ? (
                <UrgentBadge />
              ) : null}
              {order.uncoveredOutsourceItems.length > 0 ? (
                <Badge
                  variant="outline"
                  className="border-warning/50 bg-warning/10 text-warning-foreground"
                >
                  {order.uncoveredOutsourceItems.length} 项阻断
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
            <Disclosure className="mt-2"><DisclosureSummary>工单信息</DisclosureSummary>
              <p className="admin-wrap-anywhere py-2">{order.orderNo} · v{order.workOrderVersion}</p>
            </Disclosure>
            <p className="admin-wrap-anywhere text-sm text-muted-foreground">
              提交人 {order.submitter.displayName}（{roleLabel(order.submitter.role)}）
              {order.promisedDate
                ? ` · 承诺交期 ${formatDateShanghai(order.promisedDate)}`
                : ''}
              {` · ${order.items.length} 款 ${formatQuantity(
                order.items.reduce((sum, item) => sum + item.quantity, 0),
              )} 个`}
            </p>
          </div>
          {detailSections.otherActions}
        </div>
        {maxDesignsPerItem >= DESIGN_GRID_WARN_THRESHOLD ? (
          // 这条提示原来写在 /print 页里且带 .no-print，而那个页面
          // autoprint=1 会立刻弹打印对话框并自行关闭——等于永远没人
          // 看得到。放在打印按钮旁，用户才有机会在点之前读到。
          <p className="text-xs text-warning-foreground">
            有款式含 {maxDesignsPerItem} 张设计图，建议分款式打印以保证清晰度
          </p>
        ) : null}
          </>
        }
      >

      {detailSections.pricing}

      {detailSections.commercial}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(15rem,16.75rem)_minmax(0,1fr)]">
        <OrderDetailTimeline steps={timelineSteps} />
        <div className="min-w-0 space-y-3">

      {detailSections.basics}

      {detailSections.customerCharges}

      {detailSections.shipments}

      {detailSections.rework}

      {detailSections.designFiles}

      {detailSections.packaging}

      {detailSections.changeForm}

      {detailSections.changeHistory}

      {detailSections.disputes}

      {detailSections.material}

      {detailSections.piecework}

      {detailSections.costs}

      {detailSections.logs}

      {detailSections.shippingForm}

      {/* 「暂不能完工」常驻横幅：数据源 getOrderDetail.uncoveredOutsourceItems，
          与 lib/production-completion.ts 的闸口共用 outsourceCoverageApplies +
          findUndercoveredOutsourceItems，页面提示与实际能否完工不会打架。
          仅 ADMIN 可见——只有他们能建外协单。 */}
      {detailSections.completionBlock}

      {detailSections.shippingBlock}

      {detailSections.settlementBlock}

      {detailSections.reworkForm}

        </div>
      </div>
      </OrderDetailStickyScope>
    </div>
  );
}

type RenderOrderBasicSummaryOptions = {
  hideRemark?: boolean;
  order: NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;
  hasProductionOperations: boolean;
  productionOperations: Awaited<ReturnType<typeof listOrderProductionOperations>>;
  productionProgressSteps: Awaited<ReturnType<typeof listOrderProductionProgressSteps>>;
  assignedWorkerNames: string[];
  canViewCommercialAmounts: boolean;
};

function OrderBasicSummarySection({
  hideRemark = false,
  order,
  hasProductionOperations,
  productionOperations,
  productionProgressSteps,
  assignedWorkerNames,
  canViewCommercialAmounts,
}: RenderOrderBasicSummaryOptions) {
  const amounts = canViewCommercialAmounts ? orderDetailAmounts(order) : null;
  const displayAmount = (amount: string | null, estimated: boolean, total = false) => {
    return <OrderAmount status={order.status} amount={amount} estimated={estimated}
      pricingStatus={total ? amounts?.pricingStatus : undefined}
      incomplete={total && amounts?.feeSource === 'INCOMPLETE'} />;
  };
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold">基本信息</h2>
      <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label="工单名称" value={order.customName} full />
        <Row
          label="提交人"
          value={`${order.submitter.displayName}（${roleLabel(order.submitter.role)}）`}
        />
        {hasProductionOperations ? (
          <>
            <Row
              label="计件生产工序"
              value={productionOperations
                .map(
                  (operation) =>
                    `${PRODUCTION_OPERATION_LABELS[operation.operationType]}（${productionOperationStatusLabel(operation.status)}）`,
                )
                .join('；')}
            />
            <Row
              label="无计件生产进度"
              value={
                productionProgressSteps.length > 0
                  ? productionProgressSteps
                      .map(
                        (step) =>
                          `#${step.orderItem.sequence} ${step.craftName}（${productionOperationStatusLabel(step.status)}）`,
                      )
                      .join('；')
                  : '无'
              }
              full
            />
          </>
        ) : assignedWorkerNames.length > 0 ? (
          <Row label="历史派工" value={assignedWorkerNames.join('、')} />
        ) : null}
        <Row label="客户名称/简称" value={order.customerRef} />
        {canViewCommercialAmounts && 'settlementType' in order ? (
          <Row
            label="结算路径"
            value={ORDER_SETTLEMENT_LABELS[order.settlementType as OrderSettlementType]}
          />
        ) : null}
        <Row label="快递代码" value={order.expressCode} />
        <Row label="配送方式" value={order.isSfCollect ? '顺丰到付（自行预约）' : '普通配送'} />
        <Row label="收货信息" value={formatReceiverInfo(order)} full />
        {!hideRemark ? <Row label="备注" value={order.remark} full /> : null}
        <div>
          <dt className="text-muted-foreground">承诺交期</dt>
          <dd className="mt-0.5 flex items-center gap-2">
            {order.promisedDate ? formatDateInputShanghai(order.promisedDate) : '—'}
            <PromisedDateBadge promisedDate={order.promisedDate} status={order.status} />
          </dd>
        </div>
        {amounts ? (
          <>
            <Row
              label="款式加工费"
              value={displayAmount(amounts.itemProcessingAmount, amounts.processingEstimated)}
              tabular
            />
            <Row label="入袋费" value={displayAmount(amounts.packagingAmount, amounts.packagingEstimated)} tabular />
            <Row label="加工费合计" value={displayAmount(amounts.processingAmount, amounts.processingEstimated || amounts.packagingEstimated)} tabular />
            <Row
              label={
                order.isSfCollect
                    ? '对客应收总额（不含快递费，含耗材费）'
                    : '对客应收总额'
              }
              value={displayAmount(amounts.totalAmount, amounts.estimated, true)}
              tabular
            />
          </>
        ) : null}
      </dl>
    </section>
  );
}

function OrderPackagingGroupsSection({ order, canViewCommercialAmounts }: {
  order: NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;
  canViewCommercialAmounts: boolean;
}) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold">
        包装组（{order.packagingGroups.length}）
      </h2>
      {order.packageRequirement ? (
        <p className="admin-wrap-anywhere whitespace-pre-wrap text-sm">
          包装补充说明：{order.packageRequirement}
        </p>
      ) : null}
      {order.packagingGroups.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
          暂无包装组
        </p>
      ) : (
        <ol className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
          {order.packagingGroups.map((group) => {
            const unitsPerBag = group.lines.reduce(
              (sum, line) => sum + line.unitsPerBag,
              0,
            );
            return (
              <li
                key={group.id}
                className="admin-wrap-anywhere min-w-0 rounded-lg border p-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium">
                      包装组 #{group.sequence}
                      {group.name ? ` · ${group.name}` : ''}
                    </h3>
                    <p className="mt-1 font-sans tabular-nums text-muted-foreground">
                      实际 {formatQuantity(group.actualBagCount)} 袋
                      {unitsPerBag > 0
                        ? ` · 每袋共 ${formatQuantity(unitsPerBag)} 个`
                        : ''}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {PACKAGING_MODE_LABELS[group.mode]}
                  </Badge>
                </div>
                {canViewCommercialAmounts &&
                  'unitPrice' in group &&
                  'subtotal' in group ? (
                  <>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/20 p-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">入袋单价</dt>
                        <dd className="font-sans font-medium tabular-nums">
                          {formatUnitPrice(String(group.unitPrice))} / 袋
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">入袋小计</dt>
                        <dd className="font-sans font-medium tabular-nums">
                          {formatMoney(String(group.subtotal))}
                        </dd>
                      </div>
                      {'suggestedSubtotal' in group ? (
                        <div>
                          <dt className="text-muted-foreground">
                            系统建议小计
                          </dt>
                          <dd className="font-sans tabular-nums">
                            {group.suggestedSubtotal === null
                              ? '未形成完整建议价'
                              : formatMoney(String(group.suggestedSubtotal))}
                          </dd>
                        </div>
                      ) : null}
                      {'priceOverrideReason' in group &&
                        group.priceOverrideReason ? (
                        <div className="col-span-2">
                          <dt className="text-muted-foreground">
                            入袋费改价说明
                          </dt>
                          <dd className="admin-wrap-anywhere mt-0.5">
                            {String(group.priceOverrideReason)}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    {'pricingSnapshot' in group ? (
                      <PricingSnapshotBreakdown
                        pricingSnapshot={group.pricingSnapshot}
                        title="入袋计价明细"
                        className="mt-3"
                      />
                    ) : null}
                  </>
                ) : null}
                {group.lines.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    未记录每袋款式组成
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {group.lines.map((line) => (
                      <li
                        key={line.id}
                        className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 rounded-md bg-muted/40 px-3 py-2"
                      >
                        <span className="min-w-0">
                          #{line.orderItem.sequence} {line.orderItem.name}
                        </span>
                        <span className="font-sans text-xs tabular-nums text-muted-foreground">
                          每袋 {formatQuantity(line.unitsPerBag)} 个 · 全组{' '}
                          {formatQuantity(
                            line.unitsPerBag * group.actualBagCount,
                          )}{' '}
                          个
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Row({
  label,
  value,
  tabular,
  full,
}: {
  label: string;
  value: ReactNode;
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

const PRODUCT_STRUCTURE_LABELS: Record<OrderProductStructure, string> = {
  [OrderProductStructure.UNSPECIFIED]: '未明确',
  [OrderProductStructure.STANDARD_ENVELOPE]: '普通封',
  [OrderProductStructure.WESTERN_ENVELOPE]: '西封',
  [OrderProductStructure.TEN_THOUSAND_ENVELOPE]: '万元封',
};

const FOIL_TECHNIQUE_LABELS: Record<OrderFoilTechnique, string> = {
  [OrderFoilTechnique.UNSPECIFIED]: '历史数据未明确',
  [OrderFoilTechnique.NONE]: '不烫金',
  [OrderFoilTechnique.FLAT]: '平烫',
  [OrderFoilTechnique.RELIEF]: '浮雕',
  [OrderFoilTechnique.RAISED]: '激凸',
};



const PRODUCTION_OPERATION_LABELS: Record<PieceworkOperationType, string> = {
  [PieceworkOperationType.PARTIAL]: '局部烫金',
  [PieceworkOperationType.FULL]: '专版烫金',
  [PieceworkOperationType.PACKING]: '打包入袋',
};

function productionOperationStatusLabel(
  status: ProductionOperationStatus,
): string {
  if (status === ProductionOperationStatus.PENDING) return '待报工';
  if (status === ProductionOperationStatus.IN_PROGRESS) return '进行中';
  if (status === ProductionOperationStatus.COMPLETED) return '已完工';
  return '已取消';
}

function formatActualSize(
  width: unknown,
  height: unknown,
): string {
  if (width === null || width === undefined || height === null || height === undefined) {
    return '—';
  }
  return `${String(width)} × ${String(height)} mm`;
}

function formatFoilColorFacts(
  colors: readonly string[],
  technique: OrderFoilTechnique,
): string {
  if (colors.length > 0) {
    return `${formatFoilColors(colors)}（${colors.length} 色）`;
  }
  if (technique === OrderFoilTechnique.UNSPECIFIED) return '历史数据未明确';
  if (technique === OrderFoilTechnique.NONE) return '无';
  return '未填写';
}

function formatPrintColorFacts(
  colors: readonly string[],
  known: boolean,
): string {
  if (!known) return '历史数据未明确';
  if (colors.length === 0) return '无';
  return `${colors.join('、')}（${colors.length} 色）`;
}

function formatNullableBoolean(value: boolean | null): string {
  if (value === null) return '历史数据未明确';
  return value ? '是' : '否';
}

function formatQuantity(value: number): string {
  return QUANTITY_FORMATTER.format(value);
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
