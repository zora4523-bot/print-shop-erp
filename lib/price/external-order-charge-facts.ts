import type {
  ExternalOrderChargeShipmentInput,
  ExternalOrderChargeWeightItem,
  ExternalOrderProductStructure,
} from './external-order-charges';

export type ExternalOrderChargeItemFacts = {
  itemKey?: string;
  quantity: number;
  paperWeightGsm?: number | null;
  paperType?: string | null;
  productStructure?: ExternalOrderProductStructure;
};

export type ExternalOrderChargeShipmentFacts = {
  shipmentKey: string;
  province: string | null;
  billableWeightKg: string | null;
  itemQuantities: readonly number[];
};

export type DerivedExternalOrderChargeShipment = Omit<
  ExternalOrderChargeShipmentInput,
  'billableWeightKg' | 'weightItems'
> & {
  billableWeightKg: string | null;
  weightItems: ExternalOrderChargeWeightItem[];
};

/**
 * Allocates server-validated item facts to shipments. The price-book policy is
 * intentionally applied later, after the service loads the selected version.
 * `billableWeightKg` is a trusted actual override; `weightItems` are the only
 * facts eligible for a server estimate when that override is absent.
 */
export function deriveExternalOrderChargeShipments(args: {
  items: readonly ExternalOrderChargeItemFacts[];
  shipments: readonly ExternalOrderChargeShipmentFacts[];
  isSfCollect: boolean;
}): DerivedExternalOrderChargeShipment[] {
  return args.shipments.map((shipment) => {
    const weightItems = args.items.flatMap((item, itemIndex) => {
      const quantity = shipment.itemQuantities[itemIndex] ?? 0;
      if (quantity === 0) return [];
      return [{
        itemKey: item.itemKey?.trim() || String(itemIndex + 1),
        quantity,
        paperWeightGsm: item.paperWeightGsm ?? null,
        paperType: item.paperType?.trim() || null,
        productStructure: item.productStructure ?? 'UNSPECIFIED',
      }];
    });
    const itemQuantity = weightItems.reduce(
      (sum, item) => sum + (item.quantity > 0 ? item.quantity : 0),
      0,
    );
    return {
      shipmentKey: shipment.shipmentKey,
      province: shipment.province,
      billableWeightKg: args.isSfCollect
        ? null
        : shipment.billableWeightKg?.trim() || null,
      weightItems,
      itemQuantity,
    };
  });
}
