import type { ExternalOrderChargeShipmentInput } from './external-order-charges';
import { calculateOrderBillableWeight } from './external-order-charge-calculation';

export type ExternalOrderChargeItemFacts = {
  itemKey?: string;
  quantity: number;
  paperWeightGsm: number | null;
  paperType?: string | null;
  productStructure:
    | 'STANDARD_ENVELOPE'
    | 'WESTERN_ENVELOPE'
    | 'TEN_THOUSAND_ENVELOPE'
    | 'UNSPECIFIED';
};

export type ExternalOrderChargeShipmentFacts = {
  shipmentKey: string;
  province: string | null;
  itemQuantities: readonly number[];
};

export type DerivedExternalOrderChargeShipment = Omit<
  ExternalOrderChargeShipmentInput,
  'billableWeightKg'
> & {
  billableWeightKg: string | null;
};

function canonicalPaperWeightGsm(item: ExternalOrderChargeItemFacts): number | null {
  if (item.paperWeightGsm !== null) return item.paperWeightGsm;
  const match = item.paperType?.trim().match(/^(\d{2,4})\s*g/i);
  return match ? Number.parseInt(match[1] as string, 10) : null;
}

/**
 * Converts persisted order facts into the narrow input accepted by the
 * versioned logistics calculator. Browser-entered weights are never used.
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
        paperWeightGsm: canonicalPaperWeightGsm(item),
        productStructure: item.productStructure,
      }];
    });
    const itemQuantity = allocatedItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    const weight = args.isSfCollect
      ? null
      : calculateOrderBillableWeight(allocatedItems);

    return {
      shipmentKey: shipment.shipmentKey,
      province: shipment.province,
      billableWeightKg:
        weight?.status === 'CALCULATED' ? weight.billableWeightKg : null,
      itemQuantity,
    };
  });
}
