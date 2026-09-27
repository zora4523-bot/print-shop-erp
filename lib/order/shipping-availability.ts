import { OrderStatus } from '@/generated/prisma/enums';
import type { ShipmentInput } from './shipping-fields';

export type OrderShippingAvailabilityInput = {
  isAdministrator: boolean;
  status: OrderStatus;
  incompleteProductionCount: number;
  hasLiveOutsource: boolean;
  isPricingPending: boolean;
  hasShipment: boolean;
  hasPendingChange: boolean;
};

export type OrderShippingBlocker = 'STATUS' | 'CHANGE' | 'PRICING' | 'OUTSOURCE' | 'PRODUCTION' | 'ADDRESS';

/** Shared presentation facts. Actual writes still enforce their transactional guards. */
export function orderShippingBlocker(input: OrderShippingAvailabilityInput): OrderShippingBlocker | null {
  if (input.status !== OrderStatus.PACKING && input.status !== OrderStatus.COMPLETED) return 'STATUS';
  if (input.hasPendingChange) return 'CHANGE';
  if (input.isPricingPending) return 'PRICING';
  if (input.hasLiveOutsource) return 'OUTSOURCE';
  if (input.incompleteProductionCount > 0) return 'PRODUCTION';
  if (!input.hasShipment) return 'ADDRESS';
  return null;
}

const SHIPPING_BLOCKER_LABELS: Record<OrderShippingBlocker, string> = {
  STATUS: '当前工单状态不支持发货',
  CHANGE: '存在待审的工单变更',
  PRICING: '价格待管理员确认',
  OUTSOURCE: '外协尚未收回，请先核对外协进度',
  PRODUCTION: '生产工序尚未完成，请先核对报工',
  ADDRESS: '缺少发货地址，无法发货',
};

export function orderShippingRecoveryHref(input: OrderShippingAvailabilityInput): string {
  const blocker = orderShippingBlocker(input);
  switch (blocker) {
    case 'CHANGE': case 'STATUS': return '#order-detail-actions';
    case 'PRICING': return '#pricing-review';
    case 'OUTSOURCE': return '/foreman/outsource';
    case 'PRODUCTION': return '#detail-production-records';
    case 'ADDRESS': case null: return '#shipment-registration';
  }
}

export function orderShippingAvailability(
  input: OrderShippingAvailabilityInput,
): { canShip: boolean; disabledReason: string | null } {
  const blocker = orderShippingBlocker(input);
  return {
    canShip: input.isAdministrator && blocker === null,
    disabledReason: blocker ? SHIPPING_BLOCKER_LABELS[blocker] : null,
  };
}

type ShipmentSource = Omit<
  ShipmentInput,
  | 'weightKg'
  | 'shippingFee'
  | 'packingMaterialFee'
  | 'customerChargeOverrideReason'
> & {
  weightKg: unknown;
};

type ShipmentCharge = {
  amount: { toString(): string } | null;
  overrideReason: string | null;
};

export function buildShipOrderShipmentInputs(
  shipments: readonly ShipmentSource[],
  chargesByShipmentAndCategory: ReadonlyMap<string, ShipmentCharge>,
): ShipmentInput[] {
  return shipments.map((shipment) => {
    const shippingCharge = chargesByShipmentAndCategory.get(
      `${shipment.id}:SHIPPING_FEE`,
    );
    const packingCharge = chargesByShipmentAndCategory.get(
      `${shipment.id}:PACKING_MATERIAL`,
    );
    return {
      ...shipment,
      weightKg: shipment.weightKg ? String(shipment.weightKg) : null,
      shippingFee: shippingCharge?.amount?.toString() ?? null,
      packingMaterialFee: packingCharge?.amount?.toString() ?? null,
      customerChargeOverrideReason:
        shippingCharge?.overrideReason ?? packingCharge?.overrideReason ?? null,
    };
  });
}
