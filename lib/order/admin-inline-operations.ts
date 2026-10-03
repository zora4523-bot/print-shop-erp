import 'server-only';
import { hasLogisticsChargeRows, orderBillsLogistics } from './settlement';

import { OrderChangeRequestStatus, OrderPricingStatus, OrderSettlementType, OrderStatus, Role } from '@/generated/prisma/enums';
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
      workflowDecisions: { where: { action: 'HOLD' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { fromStatus: true } },
      shipments: {
        orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
        select: {
          id: true, sequence: true, receiverName: true, receiverAddress: true,
          trackingNo: true, weightKg: true, destinationProvince: true,
        },
      },
      customerCharges: {
        select: { shipmentId: true, category: { select: { code: true } }, amount: true, overrideReason: true, priceBookId: true },
      },
    },
  });
  // A changed order must never acquire a new form under an old drawer header.
  if (!row) return null;
  const isPricingPending = row.pricingStatus === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION;
  // Delivery billed through logistics rows: the ship form confirms per-address
  // charges and fulfilment corrections apply, for external sales and for
  // internal orders submitted since 2026-09-18.
  const billsLogistics = orderBillsLogistics({
    settlementType: row.settlementType,
    purpose: row.purpose,
    hasLogisticsRows: hasLogisticsChargeRows(row.customerCharges),
  });
  const canPrice = row.settlementType !== OrderSettlementType.NO_CHARGE && (isPricingPending || row.purpose === 'PROOF');
  // 尚待厂内安排时，物流核对留在费用区；寄样按实际发货能力展示物流入口。
  const heldFrom = row.workflowDecisions[0]?.fromStatus;
  const awaitingProduction = row.purpose !== 'SAMPLE_SHIPMENT' && (row.status === OrderStatus.CONFIRMED || (row.status === OrderStatus.ON_HOLD && (!heldFrom || heldFrom === OrderStatus.CONFIRMED)));
  const pricing = canPrice && isOrderPricingReviewAllowedStatus(row.status, row.purpose)
    ? 'factory'
    : canPrice && billsLogistics && isFulfillmentPricingStatus(row.status) && row.settledAt === null && row.settledFee === null
      && !awaitingProduction
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
      isExternalSales: billsLogistics,
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
