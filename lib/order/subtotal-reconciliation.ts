import Decimal from 'decimal.js';

// 业主 2026-09-14 决定容差为 0.01 元：守卫防的是算错与篡改，
// 四舍五入最多差半分；1 元会让真实错误静默通过。
export const SUBTOTAL_RECONCILIATION_TOLERANCE = '0.01';

export function subtotalReconciles(computed: Decimal.Value, subtotal: Decimal.Value): boolean {
  return new Decimal(computed).minus(subtotal).abs().lte(SUBTOTAL_RECONCILIATION_TOLERANCE);
}
