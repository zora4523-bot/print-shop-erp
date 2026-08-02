const LEGACY_OPENING_PAYMENT_PREFIX =
  'migration:20260802:bill-payment:';

export function isLegacyOpeningBillPayment(payment: {
  idempotencyKey: string;
}): boolean {
  return payment.idempotencyKey.startsWith(LEGACY_OPENING_PAYMENT_PREFIX);
}
