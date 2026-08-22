// Every mutation that can change a customer-service period, its sales ledger,
// or its payroll ledger serializes on this user-scoped transaction lock.
export function csUserLockKey(csUserId: string): string {
  return `print-shop-erp:cs-user:${csUserId}`;
}
