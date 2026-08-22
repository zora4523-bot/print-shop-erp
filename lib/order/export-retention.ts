import type { Prisma } from '../../generated/prisma/client';
import { db } from '../db';

type RetentionClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

/**
 * Removes request parameters once an export job reaches a non-retryable
 * terminal state. Only the coarse export scope remains; deterministic hashes
 * of low-entropy filters can still be enumerated and are not a safe receipt.
 */
export async function scrubOrderExportFiltersForBackgroundJob(
  backgroundJobId: string,
  client: RetentionClient = db,
): Promise<number> {
  return client.$executeRaw`
    UPDATE "OrderExport"
       SET "filters" = jsonb_build_object(
             'scope',
             CASE
               WHEN "filters"->>'scope' = 'all' THEN 'all'
               ELSE 'filtered'
             END
           ),
           "updatedAt" = NOW()
     WHERE "backgroundJobId" = ${backgroundJobId}
       AND "status" = 'FAILED'::"OrderExportStatus"
       AND jsonb_typeof("filters") = 'object'
       AND "filters" IS DISTINCT FROM jsonb_build_object(
             'scope',
             CASE
               WHEN "filters"->>'scope' = 'all' THEN 'all'
               ELSE 'filtered'
             END
           )
  `;
}

/** Scrubs terminal rows created before lifecycle scrubbing was introduced. */
export async function scrubTerminalOrderExportFilters(
  client: RetentionClient = db,
): Promise<number> {
  return client.$executeRaw`
    UPDATE "OrderExport"
       SET "filters" = jsonb_build_object(
             'scope',
             CASE
               WHEN "filters"->>'scope' = 'all' THEN 'all'
               ELSE 'filtered'
             END
           ),
           "updatedAt" = NOW()
     WHERE "status" IN (
       'READY'::"OrderExportStatus",
       'FAILED'::"OrderExportStatus",
       'EXPIRED'::"OrderExportStatus"
     )
       AND jsonb_typeof("filters") = 'object'
       AND "filters" IS DISTINCT FROM jsonb_build_object(
             'scope',
             CASE
               WHEN "filters"->>'scope' = 'all' THEN 'all'
               ELSE 'filtered'
             END
           )
  `;
}
