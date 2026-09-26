import { createHash } from 'node:crypto';
import { BackgroundJobStatus, type Prisma } from '../../generated/prisma/client';
import { BACKGROUND_JOB_TYPES } from './types';

// One authorized order-PDF scope (order, actor, work-order version, content
// snapshot, base URL) owns every ORDER_PDF job whose dedupe key starts with
// this prefix: window downloads, failure-page regenerations and operator
// retries of either. All three entries serialize on the same transaction-scoped
// advisory lock and refuse to put a second job of the scope in flight, so the
// single-concurrency HEAVY queue never renders one scope twice.
// Kept apart from pdf.ts so repository.ts (which pdf.ts imports) can share it.

const ORDER_PDF_SCOPE_KEY = /^order-pdf:v2:[0-9a-f]{64}:/;

export const ORDER_PDF_IN_FLIGHT_STATUSES: readonly BackgroundJobStatus[] = [
  BackgroundJobStatus.PENDING,
  BackgroundJobStatus.RUNNING,
];

export function orderPdfScopePrefix(scope: unknown): string {
  const scopeDigest = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
  return `order-pdf:v2:${scopeDigest}:`;
}

/**
 * The scope prefix embedded in an ORDER_PDF dedupe key, or null for rows that
 * predate the v2 key (`order-pdf:<orderId>:<uuid>`, before 2026-09-11): their
 * key carries no scope digest, and the digest cannot be rebuilt from the jsonb
 * payload because jsonb does not keep key order.
 */
export function orderPdfScopePrefixOfDedupeKey(dedupeKey: string): string | null {
  return ORDER_PDF_SCOPE_KEY.exec(dedupeKey)?.[0] ?? null;
}

export function orderPdfScopeWhere(scopePrefix: string) {
  return {
    type: BACKGROUND_JOB_TYPES.ORDER_PDF,
    dedupeKey: { startsWith: scopePrefix },
  };
}

export async function lockOrderPdfScope(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  scopePrefix: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopePrefix}))`;
}

export async function findInFlightOrderPdfJob(
  tx: Pick<Prisma.TransactionClient, 'backgroundJob'>,
  scopePrefix: string,
): Promise<string | null> {
  const inFlight = await tx.backgroundJob.findFirst({
    where: {
      ...orderPdfScopeWhere(scopePrefix),
      status: { in: [...ORDER_PDF_IN_FLIGHT_STATUSES] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return inFlight?.id ?? null;
}
