import type { Prisma } from '../../generated/prisma/client';

type SettlementCutoffLockClient = Pick<
  Prisma.TransactionClient,
  '$executeRaw'
>;

// Global finance cut-off gate. Every v2 settlement writer takes the shared
// side before its first read/write. Monthly generation and confirmation take
// the exclusive side before scanning candidates, so a settlement cannot land
// between the month scan and the bill freeze.
export const SETTLEMENT_CUTOFF_LOCK_KEY =
  'print-shop-erp:agent-monthly-billing:settlement-cutoff:v2';

export async function lockSettlementCutoffShared(
  tx: SettlementCutoffLockClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${SETTLEMENT_CUTOFF_LOCK_KEY}))`;
}

export async function lockSettlementCutoffExclusive(
  tx: SettlementCutoffLockClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SETTLEMENT_CUTOFF_LOCK_KEY}))`;
}
