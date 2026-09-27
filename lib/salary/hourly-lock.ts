// Lock order for account / attendance / salary mutations:
//   account admin-invariant (account.ts only)
//   -> salary identity (one user)
//   -> CS user (CS paths only)
//
// No salary path may acquire these in reverse order. Keeping the key in a
// dependency-free module lets account, attendance, and payroll share the same
// facts without introducing an import cycle.
export function salaryIdentityLockKey(userId: string): string {
  return `print-shop-erp:salary-identity:${userId}`;
}
