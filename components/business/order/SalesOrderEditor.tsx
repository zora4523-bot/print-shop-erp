import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { OrderSettlementType, Role } from '@/generated/prisma/enums';
import { getSalesOrderDetailById } from '@/lib/order/sales-detail-query';
import { editableFieldsetForStatus } from '@/lib/order/editable-fields';
import { listActiveOrderChangeCatalogProducts } from '@/lib/order/change-request-catalog-query';
import { listExternalCreateOrderFoilOptions } from '@/lib/material';
import { buttonVariants } from '@/components/ui/button';
import { AddOrderShipmentForm } from './AddOrderShipmentForm';
import { SalesOrderEditGuard } from './SalesOrderEditGuard';
import { EditOrderForm } from './EditOrderForm';
import { SalesOrderDetailView } from './SalesOrderDetailView';

export async function SalesOrderEditor({ id, user }: { id: string; user: { id: string; role: Role } }) {
  // Both routes use this single select + serializer; no general order DTO here.
  const order = await getSalesOrderDetailById(user, id);
  if (!order) notFound();
  const fieldset = editableFieldsetForStatus(order.status);
  if (fieldset === 'NONE') redirect(`/orders/${id}`);
  const [catalogProducts, foilColors] = await Promise.all([listActiveOrderChangeCatalogProducts(), listExternalCreateOrderFoilOptions()]);
  return <SalesOrderEditGuard key={`${id}:${order.editVersion}`}><SalesOrderDetailView order={order} catalogProducts={catalogProducts} foilColorNames={foilColors.map((foil) => foil.name)} editForm={
    <section className="space-y-4">
      <Link href={`/orders/${id}`} className={buttonVariants({ variant: 'outline' })}>返回工单</Link>
      <EditOrderForm key={`${id}:${order.editVersion}`} orderId={id}
        expectedEditVersion={order.editVersion} fieldset={fieldset} hideCustomerFields
        shipments={order.shipments} isExternalSales={order.settlementType === OrderSettlementType.EXTERNAL_SALES}
        isSfCollect={order.isSfCollect} blocked={order.changeRequests.some((request) => request.status === 'PENDING')}
        initial={{ customName: order.customName, customerRef: order.customerRef,
          customerPartyId: order.customerPartyId, receiverName: order.receiver.name,
          receiverPhone: order.receiver.phone, receiverAddress: order.receiver.address,
          expressCode: order.expressCode, packageRequirement: order.packageRequirement,
          remark: order.remark, promisedDate: order.promisedDate, isUrgent: order.isUrgent }} />
      {order.canAddShipment ?
        <AddOrderShipmentForm orderId={id} expectedRevision={order.revision} expectedEditVersion={order.editVersion}
          expectedWorkOrderVersion={order.workOrderVersion} expectedPriceRevision={order.priceRevision} allowManualPricing={false}
          nextSequence={Math.max(0, ...order.shipments.map((shipment) => shipment.sequence)) + 1}
          sources={order.shipments.filter((shipment) => shipment.canSplit).map((shipment) => ({
            id: shipment.id, sequence: shipment.sequence, receiverAddress: shipment.receiverAddress,
            lines: shipment.lines.flatMap((line) => {
              const item = order.items.find((candidate) => candidate.sequence === line.itemSequence);
              return item ? [{ orderItemId: item.id, name: line.itemName, quantity: line.quantity }] : [];
            }),
          }))} /> : null}
    </section>
  } /></SalesOrderEditGuard>;
}
