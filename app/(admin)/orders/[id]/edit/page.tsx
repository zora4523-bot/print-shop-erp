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
import { listCustomerPartyOptions } from '@/lib/party';
import { listActiveOrderChangeCatalogProducts } from '@/lib/order/change-request-catalog-query';
import { isFulfillmentPricingStatus } from '@/lib/order/fulfillment-pricing-policy';
import { isOrderPricingReviewAllowedStatus } from '@/lib/order/pricing-status';
import { EditOrderForm } from '@/components/business/order/EditOrderForm';
import {
  OrderSavedConfiguration,
  OrderSavedPackaging,
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
  const canModify =
    order.items.length > 0 &&
    canRequestOrderModification(user, order, Boolean(pending));
  const [customers, products] = await Promise.all([
    listCustomerPartyOptions(order.customerPartyId),
    canModify ? listActiveOrderChangeCatalogProducts() : Promise.resolve([]),
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
  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-5 [&_button]:min-h-11 [&_input:not([type=hidden])]:min-h-11 [&_select]:min-h-11">
      <BreadcrumbEntity label={order.orderNo} />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-semibold">
            编辑工单{' '}
            <span className="text-base tabular-nums">{order.orderNo}</span>
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
            ? order.promisedDate.toISOString().slice(0, 10)
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
            <h2 className="text-base font-semibold">申请修改款式</h2>
            <p className="text-sm text-muted-foreground">
              选择需要调整的款式；批准后更新工单及相应计价。
            </p>
          </CardHeader>
          <CardContent>
            <OrderChangeRequestForm
              promisedDate={order.promisedDate?.toISOString().slice(0, 10) ?? null}
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
