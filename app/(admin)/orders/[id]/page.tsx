import { Fragment } from 'react';
import { ProductionDeliverySummary } from '@/components/business/production/ProductionDeliverySummary';
import { ProductionJobPanel } from '@/components/business/production/ProductionJobPanel';
import { CreateOrderOutsourceLink } from '@/components/business/outsource/CreateOrderOutsourceLink';
import { hasPermission } from '@/lib/auth/permissions-dict';
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
import { OrderActivity } from '@/components/business/order/OrderActivity';
import { readOrderActivity } from '@/lib/order/activity';
import { ShipmentRegistrationForm } from '@/components/business/order/ShipmentRegistrationForm';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { outsourceUnavailableReason } from '@/lib/order/outsource-eligibility';
import { canCreateReworkFromStatus } from '@/lib/order/rework-eligibility';
import {
  canEditOrderSfCollect,
  editableFieldsetForStatus,
  isOrderEditable,
} from '@/lib/order/editable-fields';
import { roleLabel } from '@/lib/auth/role-labels';
import {
  CUSTOMER_CHARGE_STATUS_REGISTRY,
  customerChargeDisplayStatus,
  PRODUCTION_TASK_STATUS_REGISTRY,
} from '@/lib/ui/status-registry';
import {
  actionLabel,
  formatOrderLogChanges,
} from '@/lib/order/log-format';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureIndicator, DisclosureSummary } from '@/components/ui/disclosure';
import { ActionNotice, StatusBadge, TableEmptyState, TableScrollArea, ReceiptNotice } from '@/components/ui-business';
import { readReceipt } from '@/lib/admin/receipt';
import { BreadcrumbEntity } from '@/components/business/admin/breadcrumb-entity';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import { ChangeRequestStatusBadge } from '@/components/business/order/ChangeRequestStatusBadge';
import { ShipmentStatusBadge } from '@/components/business/order/ShipmentStatusBadge';
import { SubmitOrderButton } from '@/components/business/order/SubmitOrderButton';
import { CancelOrderForm } from '@/components/business/order/CancelOrderForm';
import { UrgentToggleForm } from '@/components/business/order/UrgentToggleForm';
import { SfCollectToggleForm } from '@/components/business/order/SfCollectToggleForm';
import { FulfillmentPricingReviewForm } from '@/components/business/order/FulfillmentPricingReviewForm';
import { isFulfillmentPricingStatus } from '@/lib/order/fulfillment-pricing-policy';
import { DesignUploadPanel } from '@/components/business/order/DesignUploadPanel';
import { signDesignReadUrl } from '@/lib/oss/read-url';
import { OrderMaterialUsageEstimate } from '@/components/business/bom/OrderMaterialUsageEstimate';
import { estimateMaterialUsageForOrderItems } from '@/lib/bom';
import {
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
import { OrderAmount } from '@/components/business/order/OrderAmount';
import { orderCancelImpact } from '@/components/business/order/order-detail-timeline';
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
  orderShippingBlocker,
  shipmentCompletesPlannedProduction,
  orderShippingRecoveryHref,
} from '@/lib/order/shipping-availability';
import { getPlannedCompletionPreview } from '@/lib/production/planned-completion';
import { outsourceCoverageApplies } from '@/lib/outsource/coverage';
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
  // 业主 2026-09-24：后台只剩管理员与外部销售两类账号，销售已在上面分流。
  if (user.role !== Role.ADMIN) notFound();
  const order = await getOrderDetail(id, { id: user.id, role: user.role });
  // 打印网格是按款式排的，所以阈值也按「单个款式的设计图数」判定，
  // 不是整单累加。
  const maxDesignsPerItem = Math.max(
    0,
    ...(order?.items ?? []).map((item) => item.designs.length),
  );
  if (!order) notFound();
  const reportDisputes = await listOrderReportDisputes(order.id, user);
  const adminActivity = await readOrderActivity(order.id, user);
  const historicalBlankPrices = await readHistoricalBlankPriceEditor(order.id, user);
  const canViewCommercialAmounts = true;
  const canCreateRework =
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
    getOrderPieceworkSummary(order.id),
    listOrderTaskDisputes(order.id, { id: user.id, role: user.role }),
    canCreateRework
      ? getReworkCraftOptions(order.items.flatMap((item) => item.crafts))
      : Promise.resolve([]),
    listOrderProductionOperations(order.id),
    listOrderProductionProgressSteps(order.id),
  ]);

  const canSubmit = order.status === OrderStatus.DRAFT;
  const canCancel = canShowAdminDirectCancel(user.role, order.status, order.shipments);
  // 发货与结算权限：order:ship = ADMIN（见 permissions.ts）。
  // action 层仍会重新校验，这里只控制界面入口。
  const canShipOrSettle = true;
  const canRepairProductionFacts = order.purpose !== 'SAMPLE_SHIPMENT';
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
  // Editing follows SPEC §3.6. SALES uses its own editor above; this
  // shared detail only serves ADMIN. Server still re-verifies on submit — this is UI-only.
  const pendingChangeRequest = order.changeRequests.find(
    (request) => request.status === OrderChangeRequestStatus.PENDING,
  );
  const canEdit =
    !pendingChangeRequest &&
    isOrderEditable(order.status);
  // 急单 toggle lives in the FULL fieldset only (DRAFT/SUBMITTED).
  const canToggleUrgent = editableFieldsetForStatus(order.status) === 'FULL' && canEdit;
  // Mirrors the gate in lib/order/commercial-details.ts.
  const canAdminManageCommercialDetails =
    (order.purpose ?? 'STANDARD') === 'STANDARD' &&
    isExternalSalesOrder &&
    order.status !== OrderStatus.SETTLED &&
    order.status !== OrderStatus.FINISHED &&
    order.status !== OrderStatus.CANCELLED;
  const canShowPricingReviewForm =
    isChargeableOrder &&
    (isPricingPending || order.purpose === 'PROOF') &&
    isOrderPricingReviewAllowedStatus(order.status, order.purpose);
  const canReviewFulfillmentPricing =
    billsLogistics &&
    isFulfillmentPricingStatus(order.status);
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
    canEditOrderSfCollect(order.status);
  // 设计图增删仅 DRAFT（提交后的增删属于 A05，等业主拍板）；所有权
  // 与编辑一致。lib/order-design.ts 是真闸口，这里 UI-only。
  const canEditDesigns = order.status === OrderStatus.DRAFT && canEdit;
  const canManageBom = hasPermission('bom:manage', user.role);
  const canManageOutsource = hasPermission('outsource:manage', user.role);
  const canCreateOutsource = canManageOutsource && !outsourceUnavailableReason(order);
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
    ? [...productionOperations.filter(operation => !order.simpleProduction || operation.operationType !== 'PACKING'), ...productionProgressSteps]
    : [...productionProgressSteps, ...allTasks];
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
  // Mirrors the ship gate's outsource check (findRequiredOutsourceBlocker):
  // uncoveredOutsourceItems is computed with the same predicate and coverage function.
  const hasOutsourceGap = outsourceCoverageApplies(order) && (
    order.uncoveredOutsourceItems.length > 0 ||
    !order.outsourceOrders.some((row) => row.status !== OutsourceStatus.CANCELLED)
  );
  // 业主 2026-10-01：单人流程确认发货时按计划数量代师傅登记完成。
  const plannedCompletionPreview = order.simpleProduction && (order.status === OrderStatus.RELEASED || order.status === OrderStatus.FOILING)
    ? await getPlannedCompletionPreview(order.id, order.workOrderVersion) : null;
  const shippingFacts = {
      isAdministrator: canShipOrSettle,
      status: order.status,
      incompleteProductionCount,
      hasLiveOutsource,
      hasOutsourceGap,
      plannedCompletion: plannedCompletionPreview ? { pendingJobs: plannedCompletionPreview.pendingJobs.length,
        requestedJobs: plannedCompletionPreview.requestedCount, unassignedUnits: plannedCompletionPreview.unassignedUnits } : null,
      isPricingPending,
      hasShipment: order.shipments.length > 0,
      hasPendingChange: Boolean(pendingChangeRequest),
    };
  const { canShip, disabledReason: shipDisabledReason } = orderShippingAvailability(shippingFacts);
  const shippingRecoveryHref = orderShippingRecoveryHref(shippingFacts);
  const shippingBlocker = orderShippingBlocker(shippingFacts);
  const shipmentAutoCompletion = canShip && plannedCompletionPreview && shipmentCompletesPlannedProduction(shippingFacts)
    ? plannedCompletionPreview.pendingJobs.map((job) => `${job.workerName}（${job.label} ${job.plannedQty} 个）`) : null;
  const cancelImpact = orderCancelImpact({
    pendingProductionCount,
    inProgressProductionCount,
    completedProductionCount,
    liveOutsourceCount,
  });
  const manualCustomerCharges = order.customerCharges.filter((charge) =>
    ['SAMPLE_FEE', 'OTHER_PACKAGING_FEE', 'APPROVED_ADJUSTMENT'].includes(
      String(charge.category.code),
    ),
  );
  const presentation = await getAdminOrderDetailPresentation(user, {
    id: order.id, orderNo: order.orderNo, revision: order.revision,
    editVersion: order.editVersion, workOrderVersion: order.workOrderVersion,
    priceRevision: 'priceRevision' in order && typeof order.priceRevision === 'number' ? order.priceRevision : undefined,
  });
  const inlineOperations = presentation?.workspace.inlineOperations;
  const hasPricingDetails = Boolean(isChargeableOrder && pricingStatus) ||
    (canAdminManageCommercialDetails && priceRevision !== null) ||
    (canViewCommercialAmounts && order.customerCharges.length > 0);

  const detailSections = {
    readiness: (<Fragment key="readiness"><ProductionReadinessWarning readiness={savedPricingReadiness} saved />{repairFacts ? <LegacyProductionFactsRepairForm canRepair={canRepairProductionFacts} key={`repair-${order.revision}`} facts={repairFacts} /> : null}</Fragment>),
    pricing: (<Fragment key="pricing">{isChargeableOrder && pricingStatus ? (
        <section
          id="pricing-review"
          className={
            isPricingPending
              ? 'space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-4 shadow-sm sm:p-6'
              : 'space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6'
          }
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold">工单价格状态</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {isPricingPending
                  ? canReviewFulfillmentPricing
                    ? '物流费用待核对，核对前不能发货或结算。'
                    : '价格待管理员确认，确认前不可排产。'
                  : '价格已确认。'}
              </p>
            </div>
            {/* 待工厂核价 = 主强调（§4.3），不是失败。 */}
            <Badge variant={isPricingPending ? 'default' : 'secondary'}>
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
          {!pendingChangeRequest && canEditAllOrderFees(order) ? <AdminOrderFeeEditor canEditCommercial={canAdminManageCommercialDetails} key={`all-fees-${order.revision}-${priceRevision}`} orderId={order.id} /> : null}
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
              collapsible
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
      ) : null}</Fragment>),
    commercial: (<Fragment key="commercial">{canAdminManageCommercialDetails &&
      priceRevision !== null ? (
        <OrderCommercialDetailsManager headingLevel={3}
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
      ) : null}</Fragment>),
    printActions: (<Fragment key="printActions"><div className="flex min-w-0 flex-wrap items-center gap-2">
            <a
              href={`/print/orders/${order.id}?autoprint=1`}
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
          </div></Fragment>),
    otherActions: (<Fragment key="otherActions"><div className="flex min-w-0 flex-wrap items-center gap-2">
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
              // 物流核对已在「当前待办」时不再重复入口；与当前待办同用「核对物流费用」。
              inlineOperations?.pricing === 'fulfillment' ? null : (
                <Link href="#fulfillment-pricing" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  {isPricingPending ? '核对物流费用' : '更正物流费用'}
                </Link>
              )
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
            <CreateOrderOutsourceLink orderId={order.id} status={order.status} completedAt={order.completedAt} canManage={canManageOutsource} />
            {canSubmit ? <SubmitOrderButton orderId={order.id} purpose={order.purpose} /> : null}
            {canShip ? (
              <Link
                href="#shipment-registration"
                className={buttonVariants({ size: 'sm' })}
              >
                发货
              </Link>
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
          </div></Fragment>),
    basics: (<Fragment key="basics"><OrderBasicSummarySection {...{
      order, hasProductionOperations, productionOperations, productionProgressSteps,
      assignedWorkerNames, canViewCommercialAmounts,
    }} /></Fragment>),
    payrollPass: (<Fragment key="payrollPass">
      {['CONFIRMED', 'RELEASED', 'FOILING', 'PACKING', 'SCHEDULING', 'IN_PRODUCTION'].includes(order.status) && productionOperations.some((op) => op.operationType === 'PARTIAL' && ['PENDING', 'IN_PROGRESS'].includes(op.status)) && <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-6">
        <h3 className="text-base font-semibold">师傅计薪次数</h3>
        <div className="grid gap-3 sm:grid-cols-2">{productionOperations.filter((op) => op.operationType === 'PARTIAL' && ['PENDING', 'IN_PROGRESS'].includes(op.status)).map((op) => <PayrollPassForm key={`${op.id}:${op.payrollRevision}`} operationId={op.id} revision={op.payrollRevision} passCount={op.payrollPassCount ?? productionOperationPassCount(op.operationType, op.sources)} sequences={op.sources.flatMap((s) => s.orderItem ? [s.orderItem.sequence] : [])} />)}</div>
      </section>}
    </Fragment>),
    customerCharges: (<Fragment key="customerCharges">{canViewCommercialAmounts && order.customerCharges.length > 0 ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <h3 className="text-base font-semibold">对客收费明细</h3>
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
                    {/* 说明与收费类别同名时（如「对客快递费」）不再重复一行。 */}
                    {charge.description && charge.description.trim() !== charge.category.name ? (
                      <p className="text-xs text-muted-foreground">
                        {charge.description}
                      </p>
                    ) : null}
                  </div>
                  {/* 收费状态走注册表（ui-规范 §6「Badge 不承载状态」，审查 D-10）。 */}
                  {(() => {
                    const definition = CUSTOMER_CHARGE_STATUS_REGISTRY[customerChargeDisplayStatus(
                      String(charge.status),
                      isTrustedAdminChargePricingSnapshot(charge.pricingSnapshot, charge),
                    )];
                    return <StatusBadge tone={definition.tone}>{definition.label}</StatusBadge>;
                  })()}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">{charge.status === 'ESTIMATED' ? '估算收费' : charge.status === 'FINAL' ? '已确认收费' : '收费金额'}</dt>
                    <dd className="font-sans font-medium tabular-nums">
                      <OrderAmount status={order.status} amount={charge.amount?.toString() ?? null} estimated={charge.status === 'ESTIMATED'} />
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
      ) : null}</Fragment>),
    shipments: (<Fragment key="shipments">{order.simpleProduction && <ProductionDeliverySummary orderId={order.id} version={order.workOrderVersion} />}<section id="shipment-registration" className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">
            发货地址（{order.shipments.length}）
          </h3>
          {order.shipments.length > 1 ? (
            <Badge variant="outline">多地址发货</Badge>
          ) : null}
        </div>
        {order.shipments.length === 0 ? <p className="text-sm text-muted-foreground">未填写发货地址{canEdit ? <> · <Link href={`/orders/${order.id}/edit`} className="inline-flex min-h-11 items-center underline">补充配送信息</Link></> : null}</p> : null}
        <ol className="grid min-w-0 grid-cols-1 gap-4">
          {order.shipments.map((shipment) => (
            <li key={shipment.id} className="admin-wrap-anywhere min-w-0">
              <Card className="min-w-0 gap-3 text-sm shadow-none">
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">地址 {shipment.sequence}</h4>
                  <ShipmentStatusBadge status={shipment.status} />
                </CardHeader>
                <CardContent className="min-w-0 space-y-3">
                  <div className="space-y-1">
                    {shipment.receiverName || shipment.receiverPhone ? (
                      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        {shipment.receiverName ? <span className="font-medium">{shipment.receiverName}</span> : null}
                        {shipment.receiverPhone ? <span className="tabular-nums">{shipment.receiverPhone}</span> : null}
                      </p>
                    ) : null}
                    {shipment.receiverAddress ? <p className="whitespace-pre-line text-muted-foreground">{shipment.receiverAddress}</p> : null}
                    {!shipment.receiverName && !shipment.receiverPhone && !shipment.receiverAddress ? <p className="text-muted-foreground">未填写收货信息</p> : null}
                  </div>
                  {shipment.expressCode || shipment.destinationProvince || shipment.weightKg ? (
                    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {shipment.expressCode ? <div className="flex flex-wrap gap-x-1"><dt>快递代码</dt><dd>{shipment.expressCode}</dd></div> : null}
                      {shipment.destinationProvince ? <div className="flex flex-wrap gap-x-1"><dt>计费省份</dt><dd>{shipment.destinationProvince}</dd></div> : null}
                      {shipment.weightKg ? <div className="flex flex-wrap gap-x-1"><dt>发货计费重量</dt><dd className="tabular-nums">{String(shipment.weightKg)} kg</dd></div> : null}
                    </dl>
                  ) : null}
                  {shipment.lines.length ? (
                    <ul aria-label={`地址 ${shipment.sequence} 的款式数量`} className="space-y-2 border-t pt-3">
                      {shipment.lines.map((line) => (
                        <li key={line.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="min-w-0 text-muted-foreground">#{line.orderItem.sequence} {line.orderItem.name}</span>
                          <span className="shrink-0 font-medium tabular-nums">{line.quantity.toLocaleString('zh-CN')} 个</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-xs text-muted-foreground">尚未分配款式数量</p>}
                  {shipment.trackingNo && (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.FINISHED) ? (
                    <p className="tabular-nums">
                      运单号：{shipment.trackingNo}
                    </p>
                  ) : null}
                  {order.status !== OrderStatus.CANCELLED && order.status !== OrderStatus.FINISHED ? (
                    <ShipmentRegistrationForm key={`${shipment.id}:${shipment.registrationVersion}`}
                      orderId={order.id} shipmentId={shipment.id} version={shipment.registrationVersion}
                      revision={order.revision} editVersion={order.editVersion} workOrderVersion={order.workOrderVersion} priceRevision={priceRevision ?? 0}
                      trackingNo={shipment.trackingNo} carrierCode={shipment.carrierCode} carrierName={shipment.carrierName}
                      shipped={shipment.status === 'SHIPPED'} canConfirm={canShip} disabledReason={shipDisabledReason} autoCompletion={shipmentAutoCompletion}
                      lastPending={order.shipments.filter((row) => row.status !== 'SHIPPED').length === 1}
                      chargeable={isChargeableOrder}
                      amount={order.confirmedFee !== null ? formatMoneyPlain(order.confirmedFee) : '待核价'}
                      labels={shipment.labels.map((label) => ({ id: label.id, createdAt: label.createdAt.toISOString() }))}
                    />
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section></Fragment>),
    rework: (<Fragment key="rework">{order.sourceOrder || order.reworkOrders.length > 0 ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <h3 className="text-base font-semibold">重做关联</h3>
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
      ) : null}</Fragment>),
    itemDetails: order.items.map((item) => ({ itemId: item.id, content: (
              <Disclosure key={item.id} id={`detail-design-item-${item.id}`} className="group/design-item min-w-0">
                <DisclosureSummary className="flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <span className="min-w-0 font-medium"><span className="sr-only">第 {item.sequence} 款 · {item.name}：</span>设计文件与工艺资料</span>
                  <span className="text-xs text-muted-foreground">
                    <span className="group-open/design-item:hidden">展开</span>
                    <span className="hidden group-open/design-item:inline">收起</span>
                  </span>
                </DisclosureSummary>
              <div className="space-y-3 px-4 pb-4">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
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
                          .map((task) => `${task.craft.name}：${task.worker?.displayName ?? '历史未分派记录'}（${PRODUCTION_TASK_STATUS_REGISTRY[task.status].label}）`)
                          .join('；')
                  }
                  full
                />
                ) : null}
                {(progressByOrderItemId.get(item.id)?.length ?? 0) > 0 ? (
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
              </Disclosure>    ) })),
    packaging: (<Fragment key="packaging"><OrderPackagingGroupsSection
        order={order}
        canViewCommercialAmounts={canViewCommercialAmounts}
      /></Fragment>),
    changeHistory: (<Fragment key="changeHistory">{order.changeRequests.length > 0 ? (
        <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold">工单修改申请</h3>
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
                {request.type === 'CANCEL' ? <p className="mt-2 text-sm">取消工单{request.producedQty != null ? ` · 已产 ${request.producedQty} 个` : ''}{request.settleFee != null ? ` · 结算 ${formatMoney(request.settleFee)}` : ''}</p> : <OrderChangeFieldDiff
                  beforeSnapshot={request.beforeSnapshot}
                  proposedChanges={request.proposedChanges}
                />}
                {request.reviewRemark ? (
                  <p className="admin-wrap-anywhere mt-2 text-xs text-muted-foreground">
                    审核备注：{request.reviewRemark}
                  </p>
                ) : null}
                {request.status === OrderChangeRequestStatus.PENDING ? (
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
      ) : null}</Fragment>),
    disputes: (<Fragment key="disputes"><ReportDisputeAdminPanel headingLevel={3} disputes={reportDisputes} />{(
        <TaskDisputeAdminPanel headingLevel={3}
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
      )}</Fragment>),
    material: (<Fragment key="material"><OrderMaterialUsageEstimate headingLevel={3} estimate={materialEstimate} canManageBom={canManageBom} /></Fragment>),
    piecework: (<Fragment key="piecework"><OrderWagePanel headingLevel={3} orderId={order.id} actor={user} />{pieceworkSummary && (!order.simpleProduction || pieceworkSummary.items.length > 0) ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-base font-semibold">已生成计件工资</h3>
            </div>
            {/* 工资合计不是风险或失败，不用红色（ui-规范 §8.2）；无明细时空态已说明，不再显示「合计 ¥ 0.00」。 */}
            {pieceworkSummary.items.length > 0 ? (
              <strong className="admin-wrap-anywhere font-sans tabular-nums text-foreground">
                合计 {formatMoney(pieceworkSummary.total)}
              </strong>
            ) : null}
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
      ) : null}</Fragment>),
    costs: (<Fragment key="costs">{(
        <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div>
            <h3 className="text-base font-semibold">成本补录与调整</h3>
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
          {/* 业主 2026-10-01：缩短详情页。补录表单默认收起，仍挂载在 details 内。 */}
          <Disclosure className="border-t pt-1">
            <DisclosureSummary className="gap-2">添加成本明细<DisclosureIndicator /></DisclosureSummary>
            <OrderCostEntryForm
              orderId={order.id}
              initialIdempotencyKey={randomUUID()}
              isSfCollect={order.isSfCollect}
            />
          </Disclosure>
        </section>
      )}</Fragment>),
    logs: (<Fragment key="logs"><section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <h3 className="text-base font-semibold">修改日志</h3>
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
      </section></Fragment>),
    shippingForm: null,
    completionBlock: (<Fragment key="completionBlock">{(order.status === OrderStatus.SCHEDULING ||
        order.status === OrderStatus.IN_PRODUCTION) &&
      order.uncoveredOutsourceItems.length > 0 ? (
        <section className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-6">
          <h3 className="text-base font-semibold">暂不能完工</h3>
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
              新建外协单
            </Link>
          ) : null}
        </section>
      ) : null}</Fragment>),
    shippingBlock: (<Fragment key="shippingBlock">{canShipOrSettle &&
      (order.status === OrderStatus.PACKING ||
        order.status === OrderStatus.COMPLETED) &&
      !canShip ? (
        <section
          id="ship-order"
          className="scroll-mt-28 space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-6"
        >
          <h3 className="text-base font-semibold">暂不能发货</h3>
          <p className="text-sm text-muted-foreground">
            {shipDisabledReason ?? '请先补齐发货前置事实。'}
          </p>
          {shippingRecoveryHref ? (
            <Link href={shippingRecoveryHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {shippingBlocker === 'PRODUCTION' ? '查看生产进度' : '处理发货前置条件'}
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">
              该工单已完工，无法补充发货地址，请核对历史收货资料。
            </p>
          )}
        </section>
      ) : null}</Fragment>),
    settlementBlock: (<Fragment key="settlementBlock">{canShipOrSettle &&
      order.status === OrderStatus.SHIPPED &&
      isPricingPending ? (
        <section className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-6">
          <h3 className="text-base font-semibold">暂不能结算</h3>
          <p className="text-sm text-muted-foreground">
            当前对客价格待管理员确认。请先完成整单重算并生成终价修订，再结算。
          </p>
          <Link href="#pricing-review" className={buttonVariants({ variant: 'outline', size: 'sm' })}>处理核价</Link>
        </section>
      ) : null}</Fragment>),
    reworkForm: (<Fragment key="reworkForm">{canCreateRework ? (
        // 重做是少数情况才用的入口：默认收起（业主 2026-10-01 缩短详情页），仍挂载，展开不丢输入。
        <Disclosure className="rounded-xl border bg-card px-4 shadow-sm sm:px-6">
          <DisclosureSummary className="gap-2"><h3 className="text-base font-semibold">发起重做工单</h3><DisclosureIndicator /></DisclosureSummary>
          <div className="pb-4 sm:pb-6">
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
          </div>
        </Disclosure>
      ) : null}</Fragment>),
  };

  if (!presentation) return <ActionNotice tone="warning" title="工单已更新，请刷新后查看最新资料"
    action={<Link href={`/orders/${order.id}`} className={buttonVariants({ variant: 'outline' })}>重新加载</Link>} />;
  const model = buildAdminOrderDetailModel({
    order, workspace: presentation.workspace, productionOperations, productionProgressSteps,
    workReports: presentation.workReports, signImageUrl: signDesignReadUrl,
  });
  return <>
    <BreadcrumbEntity label={order.orderNo} />
    <ReceiptNotice receipt={receipt} noun="工单" />
    <AdminOrderDetailView simpleProduction={order.simpleProduction} productionOwners={presentation.workspace.productionOwners} model={model} canEdit={canEdit} prints={presentation.prints}
      printHint={maxDesignsPerItem >= DESIGN_GRID_WARN_THRESHOLD
        ? `有款式含 ${maxDesignsPerItem} 张设计图，建议分款式打印以保证清晰度` : undefined}
      decision={<AdminOrderDetailDecision key={`${order.revision}:${order.workOrderVersion}:${presentation.workspace.pendingPrintJobId}`} order={presentation.workspace}
        requiresPaperRecall={presentation.prints.some((print) => print.version < order.workOrderVersion || print.state === 'PRINTED')} />}
      packaging={detailSections.packaging}
      itemDetails={detailSections.itemDetails}
      printActions={detailSections.printActions}
      supplementary={[
        ...(hasPricingDetails ? [{ id: 'detail-pricing-tools', title: '计价与收费维护', content: <>{detailSections.pricing}{detailSections.commercial}{detailSections.customerCharges}</> }] : []),
        { id: 'detail-delivery-records', title: '配送与发货记录', content: <>{detailSections.shipments}{detailSections.shippingForm}{detailSections.shippingBlock}{detailSections.settlementBlock}</> },
        { id: 'detail-production-records', title: '生产、用料与计件记录', content: <><ProductionJobPanel key="production-jobs" orderId={order.id} />{detailSections.readiness}{detailSections.payrollPass}{detailSections.material}{detailSections.piecework}{detailSections.disputes}{detailSections.completionBlock}</> },
        { id: 'detail-business-records', title: '生产与业务资料', content: detailSections.basics },
        { id: 'detail-costs', title: '工厂成本', content: detailSections.costs },
        ...(canCreateRework || order.sourceOrder || order.reworkOrders.length > 0 ? [{ id: 'detail-after-sales', title: '售后与重做', content: <>{detailSections.rework}{detailSections.reworkForm}</> }] : []),
        { id: 'detail-audit-records', title: '工单动态', content: <>{adminActivity ? <OrderActivity key={`${order.id}:${adminActivity.events[0]?.id ?? "empty"}`} orderId={order.id} initialPage={adminActivity} /> : null}{detailSections.changeHistory}</> },
        { id: 'detail-other-actions', title: '其他工单操作', content: detailSections.otherActions },
      ]}
    />
  </>;

}

type RenderOrderBasicSummaryOptions = {
  order: NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;
  hasProductionOperations: boolean;
  productionOperations: Awaited<ReturnType<typeof listOrderProductionOperations>>;
  productionProgressSteps: Awaited<ReturnType<typeof listOrderProductionProgressSteps>>;
  assignedWorkerNames: string[];
  canViewCommercialAmounts: boolean;
};

function OrderBasicSummarySection({
  order,
  hasProductionOperations,
  productionOperations,
  productionProgressSteps,
  assignedWorkerNames,
  canViewCommercialAmounts,
}: RenderOrderBasicSummaryOptions) {
  return (
    // 分区标题已是「生产与业务资料」，不再在卡内重复「生产概况与业务资料」（审查 D-12）。
    <section aria-label="生产概况与业务资料" className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row
          label="提交人"
          value={`${order.submitter.displayName}（${roleLabel(order.submitter.role)}）`}
        />
        {hasProductionOperations ? (
          <Row
            label="计件生产工序"
            value={productionOperations
              .map(
                (operation) =>
                  `${PRODUCTION_OPERATION_LABELS[operation.operationType]}（${productionOperationStatusLabel(operation.status)}）`,
              )
              .join('；')}
          />
        ) : assignedWorkerNames.length > 0 ? (
          <Row label="历史派工" value={assignedWorkerNames.join('、')} />
        ) : null}
        {!hasProductionOperations && order.items.some((item) => item.tasks.length > 0) ? (
          <Row
            label="历史生产进度"
            value={order.items.flatMap((item) => item.tasks.map((task) =>
              `#${item.sequence} ${task.craft.name}（${PRODUCTION_TASK_STATUS_REGISTRY[task.status].label}）`,
            )).join('；')}
            full
          />
        ) : null}
        {productionProgressSteps.length > 0 ? (
          <Row
            label="无计件生产进度"
            value={productionProgressSteps
              .map(
                (step) =>
                  `#${step.orderItem.sequence} ${step.craftName}（${productionOperationStatusLabel(step.status)}）`,
              )
              .join('；')}
            full
          />
        ) : null}
        {canViewCommercialAmounts && 'settlementType' in order ? (
          <Row
            label="结算路径"
            value={ORDER_SETTLEMENT_LABELS[order.settlementType as OrderSettlementType]}
          />
        ) : null}
        <Row label="快递代码" value={order.expressCode} />
        <Row label="配送方式" value={order.isSfCollect ? '顺丰到付（自行预约）' : '普通配送'} />
        {order.shipments.length === 0 ? <Row label="历史收货信息" value={formatReceiverInfo(order)} full /> : null}

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
      <h3 className="text-base font-semibold">
        包装组（{order.packagingGroups.length}）
      </h3>
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
                    <h4 className="font-medium">
                      包装组 #{group.sequence}
                      {group.name ? ` · ${group.name}` : ''}
                    </h4>
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
