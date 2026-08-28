import type {
  CreateOrderPriceSnapshot,
  CreateOrderQuoteItemInput,
  FullFoilUnitPrice,
  PartialBlankUnitPrice,
  PrintPerOrderPrice,
} from './types';

function normalized(value: string): string {
  return value.trim();
}

/** PARTIAL is a unit-price lookup keyed only by the configured blank SKU facts. */
export function selectPartialUnitPrice(
  item: CreateOrderQuoteItemInput,
  snapshot: CreateOrderPriceSnapshot['partial'],
): PartialBlankUnitPrice | null {
  const matches = snapshot.blankUnitPrices.filter(
    (candidate) =>
      normalized(candidate.paperType) === normalized(item.paperType) &&
      candidate.paperWeightGsm === item.paperWeightGsm &&
      normalized(candidate.specification) === normalized(item.specification),
  );
  return matches.length === 1 ? matches[0]! : null;
}

/** FULL is a per-piece tier lookup using the actual quantity, never a rounded quantity. */
export function selectFullUnitPrice(
  item: CreateOrderQuoteItemInput,
  snapshot: CreateOrderPriceSnapshot['full'],
): FullFoilUnitPrice | null {
  const matches = snapshot.unitPrices.filter(
    (candidate) =>
      candidate.pricingGroup === item.pricingGroup &&
      item.quantity >= candidate.minQuantity &&
      (candidate.maxQuantity === null ||
        item.quantity <= candidate.maxQuantity),
  );
  return matches.length === 1 ? matches[0]! : null;
}

export function resolvePrintTierQuantity(
  quantity: number,
  availableTiers: readonly number[],
): number | null {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20_000) {
    return null;
  }
  if (quantity <= 5_000) {
    return (
      [...availableTiers]
        .filter((tier) => tier <= quantity && tier <= 5_000)
        .sort((left, right) => right - left)[0] ?? null
    );
  }
  if (quantity <= 7_000) return 5_000;
  if (quantity < 15_000) return 10_000;
  return 20_000;
}

/** PRINT is an independent PER_ORDER lookup; its amount must never be multiplied by qty. */
export function selectPrintPerOrderPrice(
  item: CreateOrderQuoteItemInput,
  snapshot: CreateOrderPriceSnapshot['print'],
): PrintPerOrderPrice | null {
  const productRows = snapshot.perOrderPrices.filter(
    (candidate) =>
      normalized(candidate.paperType) === normalized(item.paperType) &&
      candidate.paperWeightGsm === item.paperWeightGsm &&
      normalized(candidate.specification) === normalized(item.specification),
  );
  const tierQuantity = resolvePrintTierQuantity(
    item.quantity,
    productRows.map((candidate) => candidate.tierQuantity),
  );
  if (tierQuantity === null) return null;
  const matches = productRows.filter(
    (candidate) => candidate.tierQuantity === tierQuantity,
  );
  return matches.length === 1 ? matches[0]! : null;
}
