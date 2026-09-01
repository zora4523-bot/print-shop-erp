// Lock order for account / attendance / hourly-payroll mutations:
//   account admin-invariant (account.ts only)
//   -> salary identity (one user)
//   -> CS user (CS paths only)
//   -> hourly worker-month (attendance/payroll paths only)
//
// No salary path may acquire these in reverse order. Keeping the keys in a
// dependency-free module lets account, attendance, and payroll share the same
// facts without introducing an import cycle.
export function salaryIdentityLockKey(userId: string): string {
  return `print-shop-erp:salary-identity:${userId}`;
}

// Every mutation that can change an hourly payroll or one of its attendance
// inputs must use this exact key.
export function hourlyPayrollLockKey(workerId: string, month: string): string {
  return `print-shop-erp:hourly:${workerId}:${month}`;
}
