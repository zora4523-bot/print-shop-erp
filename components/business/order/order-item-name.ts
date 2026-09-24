import type { CreateOrderInput } from '@/lib/auth/schemas';
import {
  externalOrderPaperFromType,
  externalOrderStyleName,
  type ExternalOrderCatalogProduct,
  type ExternalOrderPaperMaterial,
} from '@/lib/order/order-item-catalog';
import { NEW_ORDER_PRICING_ROUTES, ORDER_PRICING_ROUTE_LABELS } from '@/lib/order/pricing-route';

type OrderItem = CreateOrderInput['items'][number];
type NameCatalog = {
  products: readonly ExternalOrderCatalogProduct[];
  paperMaterials?: readonly ExternalOrderPaperMaterial[];
};

export function copyOrderItemName(name: string): string {
  return name.trim() ? `${name.slice(0, 61)} 副本` : '';
}

function automaticName(item: OrderItem, catalog: NameCatalog): string | null {
  const paper = externalOrderPaperFromType(catalog.products, item.paperType, catalog.paperMaterials);
  if (!paper || !item.paperWeightGsm || !item.specification) return null;
  return externalOrderStyleName({
    routeLabel: ORDER_PRICING_ROUTE_LABELS[item.pricingRoute],
    paperLabel: paper.label,
    weight: item.paperWeightGsm,
    specification: item.specification,
  });
}

/** Update only recognizable generated names; free-form design names stay intact. */
export function syncAutomaticOrderItemName(
  current: OrderItem,
  next: OrderItem,
  catalog: NameCatalog,
): string {
  const previousName = automaticName(current, catalog);
  const nextName = automaticName(next, catalog);
  if (!previousName || !nextName) return current.name;

  // Older local drafts retained the previous route label. Require the entire
  // remaining material/specification name to match, not just a route prefix.
  const materialName = previousName.slice(ORDER_PRICING_ROUTE_LABELS[current.pricingRoute].length);
  for (const route of NEW_ORDER_PRICING_ROUTES) {
    let candidate = `${ORDER_PRICING_ROUTE_LABELS[route]}${materialName}`;
    let replacement = nextName;
    const seen = new Set<string>();
    // Repeated copying eventually reaches the 64-character limit and stops
    // changing. Apply the same copy depth to the corrected name.
    while (!seen.has(candidate)) {
      if (current.name === candidate) return replacement;
      seen.add(candidate);
      candidate = copyOrderItemName(candidate);
      replacement = copyOrderItemName(replacement);
    }
  }
  return current.name;
}
