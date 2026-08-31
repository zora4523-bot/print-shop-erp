import type { ExternalOrderChargeShipmentInput } from './external-order-charges';

export type ExternalOrderChargeItemFacts = {
  itemKey?: string;
  quantity: number;
};

export type ExternalOrderChargeShipmentFacts = {
  shipmentKey: string;
  province: string | null;
  billableWeightKg: string | null;
  itemQuantities: readonly number[];
};

export type DerivedExternalOrderChargeShipment = Omit<
  ExternalOrderChargeShipmentInput,
  'billableWeightKg'
> & {
  billableWeightKg: string | null;
};

function carrierBillableWeight(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  if (!/^\d{1,6}(?:\.\d{1,3})?$/.test(normalized)) return null;
  return Number(normalized) > 0 ? normalized : null;
}

/**
 * Converts validated order/shipment facts into the narrow input accepted by
 * the versioned logistics calculator. Billable weight is a carrier-confirmed
 * fact: paper and quantity are never used to guess it.
 */
export function deriveExternalOrderChargeShipments(args: {
  items: readonly ExternalOrderChargeItemFacts[];
  shipments: readonly ExternalOrderChargeShipmentFacts[];
  isSfCollect: boolean;
}): DerivedExternalOrderChargeShipment[] {
  return args.shipments.map((shipment) => {
    const allocatedItems = args.items.flatMap((item, itemIndex) => {
      const quantity = shipment.itemQuantities[itemIndex] ?? 0;
      if (quantity <= 0) return [];
      return [{
        key: item.itemKey?.trim() || String(itemIndex + 1),
        quantity,
      }];
    });
    const itemQuantity = allocatedItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    return {
      shipmentKey: shipment.shipmentKey,
      province: shipment.province,
      billableWeightKg: args.isSfCollect
        ? null
        : carrierBillableWeight(shipment.billableWeightKg),
      itemQuantity,
    };
  });
}
