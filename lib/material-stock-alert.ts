import Decimal from 'decimal.js';
import type { NotificationPayloadFor } from './notification/events';

/** Compare final global balances, never an intermediate location balance. */
export function materialStockAlertForCrossing(input: {
  materialName: string;
  before: Decimal.Value;
  after: Decimal.Value;
  safetyStock: Decimal.Value | null;
}): NotificationPayloadFor<'STOCK_ALERT'> | null {
  if (input.safetyStock == null) return null;
  const safety = new Decimal(input.safetyStock);
  const before = new Decimal(input.before);
  const after = new Decimal(input.after);
  if (!before.gte(safety) || !after.lt(safety)) return null;
  return {
    materialName: input.materialName,
    currentStock: after.toFixed(2),
    safetyStock: safety.toFixed(2),
  };
}
