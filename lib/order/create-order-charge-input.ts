import type {
  ExternalOrderChargeInput,
  ExternalOrderChargeWeightItem,
} from '../price/external-order-charges';
import type { CreateOrderQuoteInput } from '../price/create-order/types';

/**
 * Maps the pure create-order facts into the canonical order-charge input.
 *
 * This function deliberately preserves the established allocation semantics:
 * every positive allocation contributes to itemQuantity, while only keys with
 * matching item facts can contribute a weight item for server estimation.
 */
export function buildCreateOrderExternalChargeInput(
  input: CreateOrderQuoteInput,
): ExternalOrderChargeInput {
  const itemsByKey = new Map(input.items.map((item) => [item.itemKey, item]));
  return {
    isSfCollect: input.isSfCollect,
    shipments: input.shipments.map((shipment) => {
      const allocations = Object.entries(shipment.itemQuantities).filter(
        ([, quantity]) => quantity > 0,
      );
      return {
        shipmentKey: shipment.shipmentKey,
        province: shipment.province,
        billableWeightKg: shipment.trustedBillableWeightKg ?? null,
        itemQuantity: allocations.reduce(
          (sum, [, quantity]) => sum + quantity,
          0,
        ),
        weightItems: allocations.flatMap(
          ([itemKey, quantity]): ExternalOrderChargeWeightItem[] => {
            const item = itemsByKey.get(itemKey);
            return item
              ? [
                  {
                    itemKey,
                    quantity,
                    paperWeightGsm: item.paperWeightGsm,
                    paperType: item.paperType,
                    productStructure: item.productStructure,
                  },
                ]
              : [];
          },
        ),
      };
    }),
  };
}
