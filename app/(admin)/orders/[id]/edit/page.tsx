import { getOrderProductionReadiness } from '@/lib/order/production-readiness-query';
import { ProductionReadinessWarning } from '@/components/business/order/ProductionReadinessWarning';
import { getLegacyProductionFactsRepair } from '@/lib/order/legacy-production-facts-presentation';
import { LegacyProductionFactsRepairForm } from '@/components/business/order/LegacyProductionFactsRepairForm';
import { OrderItemRemarkForm } from '@/components/business/order/OrderItemRemarkForm';
import { SalesOrderEditor } from '@/components/business/order/SalesOrderEditor';
import { AddOrderShipmentForm } from '@/components/business/order/AddOrderShipmentForm';
import { OrderCommercialDetailsManager } from '@/components/business/order/OrderCommercialDetailsManager';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { ChevronDown } from 'lucide-react';
import { AdminOrderEditor } from '@/components/business/order/AdminOrderEditor';
import { deriveLegacyOrderItemFoilFacts } from '@/lib/order/pricing-route';
import { signDesignReadUrl } from '@/lib/oss/read-url';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession, requireSession } from '@/lib/auth/session';
import { getOrderDetail } from '@/lib/order';
import { getOrderTitleRef } from '@/lib/page-title/refs';
import { orderEditTitle } from '@/lib/page-title/titles';
import {
  canRequestOrderModification,
  editableFieldsetForStatus,
} from '@/lib/order/editable-fields';
import { listExternalCreateOrderFoilOptions } from '@/lib/material';
import { getOrderExternalSalesAssociation } from '@/lib/order/external-sales-association';
import { listActiveOrderChangeCatalogProducts } from '@/lib/order/change-request-catalog-query';
import { isFulfillmentPricingStatus } from '@/lib/order/fulfillment-pricing-policy';
import { isOrderPricingReviewAllowedStatus } from '@/lib/order/pricing-status';
import { hasShippedShipment } from '@/lib/order/change-request-shipment-guard';
import {
  OrderSavedConfiguration,
  OrderSavedPackaging,
  OrderSavedItemDetails,
} from '@/components/business/order/OrderSavedConfiguration';
import { OrderPricingReviewForm } from '@/components/business/order/OrderPricingReviewForm';
import { FulfillmentPricingReviewForm } from '@/components/business/order/FulfillmentPricingReviewForm';
import { BreadcrumbEntity } from '@/components/business/admin/breadcrumb-entity';
import { ActionNotice } from '@/components/ui-business';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import {
  OrderStatus,
  OrderPricingStatus,
  OrderSettlementType,
  Role,
} from '@/generated/prisma/enums';
import { formatDateInputShanghai } from '@/lib/format/dates';

type PageProps = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return { title: '编辑工单' };
  const ref = await getOrderTitleRef(id, session.user.id, session.user.role);
  return { title: orderEditTitle(ref?.orderNo ?? null) };
}

export default async function EditOrderPage({ params }: PageProps) {
  const { user } = await requireSession();
  if (user.role !== Role.ADMIN && user.role !== Role.SALES) notFound();
  const { id } = await params;
  if (user.role === Role.SALES) return <SalesOrderEditor id={id} user={user} />;
  const order = await getOrderDetail(id, { id: user.id, role: user.role });
  if (!order) notFound();
  const fieldset = editableFieldsetForStatus(order.status);
  if (fieldset === 'NONE') redirect(`/orders/${id}`);
  const pending = order.changeRequests.find(
    (request) => request.status === 'PENDING',
  );
  const canModify = canRequestOrderModification(user, order, Boolean(pending));
  const [products, externalSalesAssociation, foilColors] = await Promise.all([
    canModify && order.items.length > 0
      ? listActiveOrderChangeCatalogProducts()
      : Promise.resolve([]),
    getOrderExternalSalesAssociation(order.id, user),
    // The admin editor needs swatches and typed catalog color names.
    listExternalCreateOrderFoilOptions(),
  ]);
  const external =
    'settlementType' in order &&
    order.settlementType === OrderSettlementType.EXTERNAL_SALES;
  const pricingPending =
    'pricingStatus' in order &&
    order.pricingStatus === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION;
  const canPrice =
    user.role === Role.ADMIN &&
    !pending &&
    pricingPending &&
    isOrderPricingReviewAllowedStatus(order.status);
  const canCorrectFreight =
    user.role === Role.ADMIN &&
    !pending &&
    external &&
    isFulfillmentPricingStatus(order.status) &&
    order.settledAt === null;
  const showSavedPricingReadiness = 'pricingStatus' in order && order.pricingStatus === OrderPricingStatus.ADMIN_CONFIRMED && (order.status === OrderStatus.SUBMITTED || order.status === OrderStatus.PENDING_FACTORY);
  const readiness = showSavedPricingReadiness ? await getOrderProductionReadiness(order.id) : undefined;
  return <><ProductionReadinessWarning readiness={readiness} saved /><AdministratorOrderEdit {...{order, external, pending, pricingPending, canPrice,
    canCorrectFreight, id, canModify, products, foilColors, fieldset, externalSalesAssociation}} /></>;

}

function PendingModificationNoticeSection({ pending, id }: { pending: NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>['changeRequests'][number]; id: string; }
) {
  return (
    <ActionNotice
      tone="info"
      title="修改申请待处理"
      description={pending.reason}
      action={
        <Link href={`/orders/${id}`} className={buttonVariants({ variant: 'outline' })}>
          查看并处理申请
        </Link>
      }
    />
  );
}

type RenderEditorFeesOptions = {
  order: NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;
  external: boolean;
  pending:
    | NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>['changeRequests'][number]
    | undefined;
  pricingPending: boolean;
  canPrice: boolean;
  canCorrectFreight: boolean;
};

function EditorFeesSection({
  order,
  external,
  pending,
  pricingPending,
  canPrice,
  canCorrectFreight,
}: RenderEditorFeesOptions) {
  return (
    <>
      <OrderSavedConfiguration order={order} canEditDesigns={false} feesOnly />
      {external && !pending && 'priceRevision' in order ? (
        <Disclosure className="rounded-xl border bg-card">
          <DisclosureSummary className="justify-between gap-3 px-4 py-4 sm:px-6">
            <h2 className="text-base font-semibold">版费与其他费用</h2>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </DisclosureSummary>
          <div className="px-4 pb-5 pt-2 sm:px-6 sm:pb-6">
            <OrderCommercialDetailsManager
              embedded
              orderId={order.id}
              priceRevision={Number(order.priceRevision)}
              allowPlateDetailMaintenance={!pricingPending}
              manualCharges={order.customerCharges
                .filter((charge) =>
                  ['SAMPLE_FEE', 'OTHER_PACKAGING_FEE', 'APPROVED_ADJUSTMENT'].includes(
                    String(charge.category.code),
                  ),
                )
                .map((charge) => ({
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
              items={order.items.map((item) => ({
                id: item.id,
                sequence: item.sequence,
                name: item.name,
                independentPlateEligible:
                  item.pricingRoute !== 'COLOR_PRINT' &&
                  deriveLegacyOrderItemFoilFacts(item).foilColors.length > 0,
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
              }))}
            />
          </div>
        </Disclosure>
      ) : null}
      {canPrice ? (
        <Disclosure className="rounded-xl border bg-card">
          <DisclosureSummary className="px-4 py-3">核对自动报价与待核费用</DisclosureSummary>
          <div className="border-t p-4">
            <p className="text-xs text-muted-foreground">
              人工费用单独核定，完成后页面将读取最新金额。请先保存其他修改。
            </p>

            <OrderPricingReviewForm
              key={`${order.revision}:${order.editVersion}`}
              orderId={order.id}
            />
          </div>
        </Disclosure>
      ) : null}
      {canCorrectFreight ? (
        <Card>
          <CardContent className="pt-4">
            <FulfillmentPricingReviewForm
              key={`${order.revision}:${order.editVersion}`}
              orderId={order.id}
              currentValue={order.isSfCollect}
              isPricingPending={pricingPending}
              shipments={order.shipments.map((shipment) => ({
                id: shipment.id,
                sequence: shipment.sequence,
                destinationProvince: shipment.destinationProvince,
                weightKg: shipment.weightKg?.toString() ?? null,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function AdministratorOrderEdit({order, external, pending, pricingPending, canPrice,
  canCorrectFreight, id, canModify, products, foilColors, fieldset, externalSalesAssociation}:
  RenderEditorFeesOptions & {
    id: string; canModify: boolean;
    products: Awaited<ReturnType<typeof listActiveOrderChangeCatalogProducts>>;
    foilColors: Awaited<ReturnType<typeof listExternalCreateOrderFoilOptions>>;
    fieldset: Exclude<ReturnType<typeof editableFieldsetForStatus>, 'NONE'>;
    externalSalesAssociation: Awaited<ReturnType<typeof getOrderExternalSalesAssociation>>;
  }) {
    const repairFacts = getLegacyProductionFactsRepair(order);
    const canRepairProductionFacts = repairFacts !== null;
    const productionLocked = [
      OrderStatus.RELEASED,
      OrderStatus.FOILING,
      OrderStatus.PACKING,
      OrderStatus.IN_PRODUCTION,
      OrderStatus.SCHEDULING,
      OrderStatus.ON_HOLD,
    ].some((status) => status === order.status) ||
      // 已有地址发货：款式与数量锁定，只能改交期（服务端同样拒绝）。
      hasShippedShipment(order.shipments);
    return (
      <>
        <BreadcrumbEntity label={order.orderNo} />
        {canRepairProductionFacts && repairFacts ? <LegacyProductionFactsRepairForm canRepair={canRepairProductionFacts} key={`repair-${order.revision}`} facts={repairFacts} /> : null}
        <AdminOrderEditor
          key={`${order.id}:${order.editVersion}`}
          orderId={order.id}
          orderNo={order.orderNo}
          status={order.status}
          revision={order.revision}
          workOrderVersion={order.workOrderVersion}
          canModify={canModify}
          canAdd={canModify && order.status === OrderStatus.DRAFT && order.packagingGroups.length === 0}
          canEditDesigns={order.status === OrderStatus.DRAFT && !pending}
          productionLocked={productionLocked}
          products={products}
          foilColors={foilColors.map((color) => color.name)}
          items={order.items.map((item) => ({
            id: item.id,
            sequence: item.sequence,
            name: item.name,
            quantity: item.quantity,
            pack: item.pack,
            productId: item.productId,
            pricingRoute: item.pricingRoute,
            specification: item.specification,
            paperType: item.paperType,
            paperWeightGsm: item.paperWeightGsm,
            ...deriveLegacyOrderItemFoilFacts(item),
            subtotal: 'subtotal' in item ? String(item.subtotal) : null,
            details: (
              <OrderSavedItemDetails
                key={item.id}
                order={order}
                item={item}
                includeDesigns={false}
              />
            ),
            packagingEditable:
              order.packagingGroups
                .flatMap((group) => group.lines)
                .filter((line) => line.orderItem.id === item.id).length === 1,
            designs: item.designs.map((design) => ({
              id: design.id,
              fileName: design.fileName,
              fileType: design.fileType,
              fileSize: String(design.fileSize),
              fileUrl:
                design.fileType === 'IMAGE'
                  ? signDesignReadUrl(design.fileUrl)
                  : '',
            })),
          }))}
          form={{
            orderId: order.id,
            expectedEditVersion: order.editVersion,
            fieldset,
            externalSalesAssociation,
            shipments: order.shipments.map((row) => ({
              id: row.id,
              sequence: row.sequence,
              status: row.status,
              receiverName: row.receiverName,
              receiverPhone: row.receiverPhone,
              receiverAddress: row.receiverAddress,
              expressCode: row.expressCode,
              destinationProvince: row.destinationProvince,
            })),
            packagingDetails: <OrderSavedPackaging key="packaging" order={order} />,
            isExternalSales: external,
            isSfCollect: order.isSfCollect,
            blocked: Boolean(pending),
            initial: {
              customName: order.customName,
              receiverName: order.receiverName,
              receiverPhone: order.receiverPhone,
              receiverAddress: order.receiverAddress,
              expressCode: order.expressCode,
              packageRequirement: order.packageRequirement,
              remark: order.remark,
              promisedDate:
                formatDateInputShanghai(order.promisedDate, '') || null,
              isUrgent: order.isUrgent,
            },
          }}
          pendingNotice={
            pending ? (
              <PendingModificationNoticeSection key="pending" {...{
                pending: pending, id: id,
              }} />
            ) : null
          }
          itemRemarks={!pending ? (
            <section key="item-remarks" aria-label="款式备注" className="space-y-4">
              {order.items.map((item) => (
                <OrderItemRemarkForm key={`${item.id}:${order.editVersion}`} orderId={order.id}
                  itemId={item.id} sequence={item.sequence} version={order.editVersion} initial={item.remark} />
              ))}
            </section>
          ) : null}
          deliveries={
            !pending && order.shipments.length < 10 &&
            !order.shipments.some((row) => row.status === 'SHIPPED') &&
            'priceRevision' in order ? (
              <AddOrderShipmentForm
                key="add-shipment"
                orderId={order.id}
                expectedRevision={order.revision}
                expectedEditVersion={order.editVersion}
                expectedWorkOrderVersion={order.workOrderVersion}
                expectedPriceRevision={Number(order.priceRevision)}
                allowManualPricing={external && order.billingMode !== 'NO_CHARGE' && order.status !== OrderStatus.DRAFT}
                nextSequence={Math.max(0, ...order.shipments.map((row) => row.sequence)) + 1}
                sources={order.shipments
                  .filter((row) => !row.trackingNo && row.weightKg === null && row.registrationVersion === 0)
                  .map((row) => ({
                    id: row.id,
                    sequence: row.sequence,
                    receiverAddress: row.receiverAddress,
                    lines: row.lines.filter((line) => line.quantity > 0).map((line) => ({
                      orderItemId: line.orderItem.id,
                      sequence: line.orderItem.sequence,
                      name: line.orderItem.name,
                      specification: line.orderItem.specification,
                      quantity: line.quantity,
                    })),
                  }))}
              />
            ) : null
          }
          fees=<EditorFeesSection key="fees" {...{
              order, external, pending, pricingPending,
              canPrice, canCorrectFreight,
            }} />
        />
      </>
    );

}
