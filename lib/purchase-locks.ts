export function purchaseReceiptRequestLockKey(
  idempotencyKey: string,
): string {
  return `print-shop-erp:purchase-receipt-request:${idempotencyKey}`;
}
