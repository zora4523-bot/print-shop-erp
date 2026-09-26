import 'server-only';

import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { db } from '../db';

// 60 attempts/minute with 30 requests of burst tolerance. CDR uses a distinct key namespace in the shared bucket table. GCRA represents
// the bucket with one timestamp, so concurrent web processes serialize on a
// single PostgreSQL row instead of each process maintaining a bypassable
// in-memory counter.
const ATTEMPT_INTERVAL_MS = 1_000;
const BURST_TOLERANCE_MS = 30 * ATTEMPT_INTERVAL_MS;

/**
 * The reverse proxy overwrites X-Real-IP on every public route. X-Forwarded-For
 * is only a fallback for local/test proxies; taking its final hop avoids
 * trusting a client-supplied prefix. The address is hashed before persistence.
 */
function cdrDownloadRateLimitBucketKey(headers: Headers): string {
  const realIp = headers.get('x-real-ip')?.trim();
  const forwardedFor = headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  const address = realIp || forwardedFor || 'unresolved-client';
  return createHash('sha256')
    .update(`print-shop-erp:cdr-download-ip:v1:${address}`)
    .digest('hex');
}

/**
 * Atomically consumes one CDR download-attempt token using the database clock.
 * An empty RETURNING set means the bucket is over limit. Database failures are
 * deliberately allowed to propagate: downloads must fail closed rather
 * than silently disabling brute-force protection.
 */
export async function consumeCdrDownloadRateLimit(headers: Headers): Promise<boolean> {
  const key = cdrDownloadRateLimitBucketKey(headers);
  const rows = await db.$queryRaw<Array<{ key: string }>>(Prisma.sql`
    WITH db_clock AS (
      SELECT clock_timestamp() AS at
    )
    INSERT INTO "LoginRateLimitBucket" (
      "key",
      "theoreticalArrivalAt",
      "updatedAt"
    )
    SELECT
      ${key},
      at + (${ATTEMPT_INTERVAL_MS}::integer * interval '1 millisecond'),
      at
    FROM db_clock
    ON CONFLICT ("key") DO UPDATE
      SET "theoreticalArrivalAt" =
            GREATEST(
              "LoginRateLimitBucket"."theoreticalArrivalAt",
              EXCLUDED."updatedAt"
            ) + (${ATTEMPT_INTERVAL_MS}::integer * interval '1 millisecond'),
          "updatedAt" = EXCLUDED."updatedAt"
      WHERE "LoginRateLimitBucket"."theoreticalArrivalAt"
            <= EXCLUDED."updatedAt"
               + (${BURST_TOLERANCE_MS}::integer * interval '1 millisecond')
    RETURNING "key"
  `);
  return rows.length === 1;
}
