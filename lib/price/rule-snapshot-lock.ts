import type { Prisma } from '../../generated/prisma/client';

/**
 * Published customer price books and their referenced catalog identities form
 * one customer-quote snapshot. Every cooperating reader/writer must use this
 * same key so a quote cannot straddle an administrator's catalog or published
 * rule change.
 *
 * These are transaction-scoped PostgreSQL locks by design: callers must hold
 * them only around the coherent rule reads or the corresponding mutation.
 */
export const PRICE_RULE_SNAPSHOT_LOCK_KEY =
  'print-shop-erp:price-rule-snapshot:v1';

export type PriceRuleSnapshotLockClient = Pick<
  Prisma.TransactionClient,
  '$executeRaw'
>;

export async function acquirePriceRuleSnapshotReadLock(
  client: PriceRuleSnapshotLockClient,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${PRICE_RULE_SNAPSHOT_LOCK_KEY}))`;
}

export async function acquirePriceRuleSnapshotWriteLock(
  client: PriceRuleSnapshotLockClient,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PRICE_RULE_SNAPSHOT_LOCK_KEY}))`;
}
