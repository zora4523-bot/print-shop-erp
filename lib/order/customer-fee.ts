import Decimal from 'decimal.js';

type MoneyLike = unknown;

export type OrderCustomerFeeSource =
  | 'SETTLED'
  | 'CONFIRMED'
  | 'QUOTED'
  | 'LEGACY';

export type OrderCustomerFee = {
  amount: string;
  source: OrderCustomerFeeSource;
  estimated: boolean;
};

/**
 * Selects the persisted customer-facing amount without running a pricing
 * engine. The legacy aggregate is deliberately last so pre-cutover orders
 * keep their historical display while new orders follow the three snapshots.
 */
export function selectOrderCustomerFee(order: {
  settledFee?: MoneyLike | null;
  confirmedFee?: MoneyLike | null;
  quotedFee?: MoneyLike | null;
  totalAmount: MoneyLike;
}): OrderCustomerFee {
  const candidates: Array<{
    value: MoneyLike | null | undefined;
    source: OrderCustomerFeeSource;
  }> = [
    { value: order.settledFee, source: 'SETTLED' },
    { value: order.confirmedFee, source: 'CONFIRMED' },
    { value: order.quotedFee, source: 'QUOTED' },
    { value: order.totalAmount, source: 'LEGACY' },
  ];
  const selected = candidates.find(({ value }) => value !== null && value !== undefined)!;
  const value = selected.value;
  if (
    value === null ||
    value === undefined ||
    (typeof value !== 'string' &&
      typeof value !== 'number' &&
      !(
        typeof value === 'object' &&
        'toString' in value &&
        typeof value.toString === 'function'
      ))
  ) {
    throw new TypeError('工单金额快照格式非法');
  }
  return {
    amount: new Decimal(value.toString()).toFixed(2),
    source: selected.source,
    estimated: selected.source === 'QUOTED',
  };
}
