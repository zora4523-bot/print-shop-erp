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

export function orderShippingAvailability(
  input: OrderShippingAvailabilityInput,
): { canShip: boolean; disabledReason: string | null } {
  const productionReady =
    input.status === OrderStatus.PACKING ||
    input.status === OrderStatus.COMPLETED;
  const disabledReason = input.isPricingPending
    ? '价格待管理员确认'
    : input.hasPendingChange
      ? '存在待审的工单变更'
      : input.hasLiveOutsource
        ? '仍有已发出或进行中的外协单'
        : input.incompleteProductionCount > 0
          ? `${input.incompleteProductionCount} 个工序未完工`
          : !input.hasShipment
            ? '缺少发货地址，无法发货'
            : !productionReady
              ? '完工后才可发货'
              : null;

  return {
    canShip: input.isAdministrator && disabledReason === null,
    disabledReason,
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
