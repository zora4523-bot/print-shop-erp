import { AddOrderShipmentForm } from '@/components/business/order/AddOrderShipmentForm';
import { OrderCommercialDetailsManager } from '@/components/business/order/OrderCommercialDetailsManager';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { AdminOrderEditor } from '@/components/business/order/AdminOrderEditor';
import { deriveLegacyOrderItemFoilFacts } from '@/lib/order/pricing-route';
import { signDesignReadUrl } from '@/lib/oss/read-url';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
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
import { listCustomerPartyOptions } from '@/lib/party';
import { getOrderExternalSalesAssociation } from '@/lib/order/external-sales-association';
import { listActiveOrderChangeCatalogProducts } from '@/lib/order/change-request-catalog-query';
import { isFulfillmentPricingStatus } from '@/lib/order/fulfillment-pricing-policy';
import { isOrderPricingReviewAllowedStatus } from '@/lib/order/pricing-status';
import { EditOrderForm } from '@/components/business/order/EditOrderForm';
import {
  OrderSavedConfiguration,
  OrderSavedPackaging,
  OrderSavedItemDetails,
} from '@/components/business/order/OrderSavedConfiguration';
import { OrderChangeRequestForm } from '@/components/business/order/OrderChangeRequestForm';
import { OrderChangeWithdrawButton } from '@/components/business/order/OrderChangeWithdrawButton';
import { OrderPricingReviewForm } from '@/components/business/order/OrderPricingReviewForm';
import { FulfillmentPricingReviewForm } from '@/components/business/order/FulfillmentPricingReviewForm';
import { BreadcrumbEntity } from '@/components/business/admin/breadcrumb-entity';
import { ActionNotice } from '@/components/ui-business';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
  if (
    user.role !== Role.ADMIN &&
    user.role !== Role.SALES &&
    user.role !== Role.CUSTOMER_SERVICE
  )
    notFound();
  const { id } = await params;
  const order = await getOrderDetail(id, { id: user.id, role: user.role });
  if (!order || (user.role !== Role.ADMIN && order.submitterId !== user.id))
    notFound();
  const fieldset = editableFieldsetForStatus(order.status);
  if (fieldset === 'NONE') redirect(`/orders/${id}`);
  const pending = order.changeRequests.find(
    (request) => request.status === 'PENDING',
  );
  const canModify = canRequestOrderModification(user, order, Boolean(pending));
  const [customers, products, externalSalesAssociation, foilColors] = await Promise.all([
    user.role === Role.ADMIN
      ? Promise.resolve([])
      : listCustomerPartyOptions(order.customerPartyId),
    canModify && order.items.length > 0
      ? listActiveOrderChangeCatalogProducts()
      : Promise.resolve([]),
    getOrderExternalSalesAssociation(order.id, user),
    user.role === Role.ADMIN ? listExternalCreateOrderFoilOptions() : Promise.resolve([]),
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
  if (user.role === Role.ADMIN) {
    const productionLocked = [
      OrderStatus.RELEASED,
      OrderStatus.FOILING,
      OrderStatus.PACKING,
      OrderStatus.IN_PRODUCTION,
      OrderStatus.SCHEDULING,
      OrderStatus.ON_HOLD,
    ].some((status) => status === order.status);
    return (
      <>
        <BreadcrumbEntity label={order.orderNo} />
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
            customers,
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
            packagingDetails: <OrderSavedPackaging order={order} />,
            isExternalSales: external,
            isSfCollect: order.isSfCollect,
            blocked: Boolean(pending),
            initial: {
              customName: order.customName,
              customerRef: order.customerRef,
              customerPartyId: order.customerPartyId,
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
              <PendingModificationNoticeSection {...{
                pending: pending, id: id,
              }} />
            ) : null
          }
          deliveries={
            !pending && order.shipments.length < 10 &&
            !order.shipments.some((row) => row.status === 'SHIPPED') &&
            'priceRevision' in order ? (
              <AddOrderShipmentForm
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
                      name: line.orderItem.name,
                      quantity: line.quantity,
                    })),
                  }))}
              />
            ) : null
          }
          fees=<EditorFeesSection {...{
              order, external, pending, pricingPending,
              canPrice, canCorrectFreight,
            }} />
        />
      </>
    );
  }
  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-5 [&_button]:min-h-11 [&_input:not([type=hidden])]:min-h-11 [&_select]:min-h-11">
      <BreadcrumbEntity label={order.orderNo} />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-semibold">
            编辑工单{' '}
            <span className="text-base">{order.customName?.trim() || '未命名工单'}</span>
          </h1>
          <div className="mt-2">
            <OrderStatusBadge status={order.status} />
          </div>
        </div>
        <Link
          href={`/orders/${id}`}
          className={buttonVariants({ variant: 'outline' })}
        >
          返回工单
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        基本信息与配送保存后生效；款式和费用通过下方审批、核价处理。
      </p>
      <EditOrderForm
        key={`${order.id}:${order.editVersion}`}
        orderId={order.id}
        expectedEditVersion={order.editVersion}
        fieldset={fieldset}
        customers={customers}
        externalSalesAssociation={externalSalesAssociation}
        shipments={order.shipments}
        packagingDetails={<OrderSavedPackaging order={order} />}
        isExternalSales={external}
        isSfCollect={order.isSfCollect}
        blocked={Boolean(pending)}
        initial={{
          customName: order.customName,
          customerRef: order.customerRef,
          customerPartyId: order.customerPartyId,
          receiverName: order.receiverName,
          receiverPhone: order.receiverPhone,
          receiverAddress: order.receiverAddress,
          expressCode: order.expressCode,
          packageRequirement: order.packageRequirement,
          remark: order.remark,
          promisedDate: order.promisedDate
            ? formatDateInputShanghai(order.promisedDate)
            : null,
          isUrgent: order.isUrgent,
        }}
      />
      <OrderSavedConfiguration
        order={order}
        canEditDesigns={order.status === OrderStatus.DRAFT && !pending}
      />
      {pending ? (
        <ActionNotice
          tone="info"
          title="修改申请待处理"
          description={pending.reason}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/orders/${id}`}
                className={buttonVariants({ variant: 'outline' })}
              >
                查看申请
              </Link>
              {pending.requesterId === user.id ? (
                <OrderChangeWithdrawButton requestId={pending.id} />
              ) : null}
            </div>
          }
        />
      ) : null}
      {canModify ? (
        <Card id="modify-order">
          <CardHeader>
            <h2 className="text-base font-semibold">申请修改工单</h2>
            <p className="text-sm text-muted-foreground">
              可申请调整款式或交期，管理员批准后生效。
            </p>
          </CardHeader>
          <CardContent>
            <OrderChangeRequestForm
              promisedDate={
                formatDateInputShanghai(order.promisedDate, '') || null
              }
              orderId={order.id}
              expectedRevision={order.revision}
              expectedWorkOrderVersion={order.workOrderVersion}
              catalogProducts={products}
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
          </CardContent>
        </Card>
      ) : null}
      {canPrice ? (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold">核对费用</h2>
          </CardHeader>
          <CardContent>
            <OrderPricingReviewForm
              key={`${order.revision}:${order.editVersion}`}
              orderId={order.id}
            />
          </CardContent>
        </Card>
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
    </div>
  );
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
          <DisclosureSummary className="px-4 py-3">版费与其他费用</DisclosureSummary>
          <div className="border-t p-4">
            <OrderCommercialDetailsManager
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
