/** Shared visibility policy; the pricing command repeats it under the order lock. */
export function canEditAllOrderFees(order: {
  status: string; settlementType: unknown; settledFee?: unknown; settledAt?: unknown;
}): boolean {
  return typeof order.settlementType === 'string' && ['EXTERNAL_SALES', 'INTERNAL_SALES', 'FACTORY_DIRECT'].includes(order.settlementType) && order.settledFee == null && order.settledAt == null &&
    ['PENDING_FACTORY', 'SUBMITTED', 'CONFIRMED', 'ON_HOLD', 'RELEASED', 'FOILING', 'PACKING', 'SCHEDULING', 'IN_PRODUCTION', 'COMPLETED', 'SHIPPED'].includes(order.status);
}

type Charge = { businessKey: string; category: { code: string }; status: string };
/** Structured plates have their own quantity × unit-price editor and trust contract. */
export function isEditableOrderCharge(charge: Charge, charges: readonly Charge[]): boolean {
  if (charge.businessKey.startsWith('PLATE_DETAIL:')) return false;
  if (charge.category.code === 'PLATE_MAKING_FEE' && charges.some((row) => row.businessKey.startsWith('PLATE_DETAIL:') && row.status !== 'WAIVED')) return false;
  return true;
}
