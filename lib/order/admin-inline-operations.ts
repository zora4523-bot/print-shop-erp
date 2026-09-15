import 'server-only';

import { OrderChangeRequestStatus, OrderPricingStatus, OrderSettlementType, Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { UnauthorizedError } from '@/lib/auth/errors';
import { isOrderPricingReviewAllowedStatus } from './pricing-status';
import { isFulfillmentPricingStatus } from './fulfillment-pricing-policy';
import { buildShipOrderShipmentInputs } from '@/lib/order/shipping-availability';
import type { AdminOrdersActor, AdminOrderWorkspaceRow } from './admin-workspace';
import type { AdminOrderInlineOperationsData } from './admin-inline-types';

/** Keep addresses and editable financial facts out of the paginated list DTO. */
export async function getAdminOrderInlineOperations(
  actor: AdminOrdersActor,
  order: AdminOrderWorkspaceRow,
): Promise<AdminOrderInlineOperationsData | null> {
  if (actor.role !== Role.ADMIN) throw new UnauthorizedError('仅管理员可读取工单操作');
  if (order.pendingChangeRequest || typeof order.editVersion !== 'number') return null;
  const row = await db.order.findFirst({
    where: {
      id: order.id,
      revision: order.revision,
      editVersion: order.editVersion,
      workOrderVersion: order.workOrderVersion,
      status: order.status,
      changeRequests: { none: { status: OrderChangeRequestStatus.PENDING } },
    },
    select: {
      purpose: true, revision: true, editVersion: true, workOrderVersion: true, priceRevision: true,
      status: true, settlementType: true, pricingStatus: true, isSfCollect: true,
      settledAt: true, settledFee: true,
      shipments: {
        orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
        select: {
          id: true, sequence: true, receiverName: true, receiverAddress: true,
          trackingNo: true, weightKg: true, destinationProvince: true,
        },
      },
      customerCharges: {
        select: { shipmentId: true, category: { select: { code: true } }, amount: true, overrideReason: true },
      },
    },
  });
  // A changed order must never acquire a new form under an old drawer header.
  if (!row) return null;
  const isPricingPending = row.pricingStatus === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION;
  const isExternalSales = row.settlementType === OrderSettlementType.EXTERNAL_SALES;
  const canPrice = row.settlementType !== OrderSettlementType.NO_CHARGE && (isPricingPending || row.purpose === 'PROOF');
  const pricing = canPrice && isOrderPricingReviewAllowedStatus(row.status, row.purpose)
    ? 'factory'
    : canPrice && row.purpose !== 'PROOF' && (isExternalSales || row.purpose === 'SAMPLE_SHIPMENT') && isFulfillmentPricingStatus(row.status) && row.settledAt === null && row.settledFee === null
      ? 'fulfillment' : null;
  const charges = new Map(row.customerCharges.flatMap((charge) =>
    charge.shipmentId ? [[`${charge.shipmentId}:${charge.category.code}`, charge] as const] : [],
  ));
  return {
    pricing,
    shipping: order.capabilities.ship && !isPricingPending ? {
      expectedRevision: row.revision,
      expectedEditVersion: row.editVersion,
      expectedWorkOrderVersion: row.workOrderVersion,
      expectedPriceRevision: row.priceRevision,
      shipments: buildShipOrderShipmentInputs(row.shipments, charges),
      isExternalSales,
      isSfCollect: row.isSfCollect,
    } : null,
    fulfillment: pricing === 'fulfillment' ? {
      currentValue: row.isSfCollect,
      isPricingPending,
      shipments: row.shipments.map((shipment) => ({
        id: shipment.id, sequence: shipment.sequence,
        destinationProvince: shipment.destinationProvince,
        weightKg: shipment.weightKg?.toString() ?? null,
      })),
    } : null,
  };
}
