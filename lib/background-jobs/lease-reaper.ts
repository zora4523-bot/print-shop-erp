import {
  Prisma,
  type BackgroundJobQueue,
} from '../../generated/prisma/client';
import { db } from '../db';
import { NOTIFICATION_DELIVERY_UNKNOWN_ERROR_CODE } from './terminal-policy';

type TerminalJobRow = {
  id: string;
  type: string;
  dedupeKey: string;
  attempts: number;
  lastErrorCode: string | null;
};

type FencedNotificationRow = {
  dedupeKey: string;
};

/**
 * Reconciles final-attempt leases for one queue. The returned job rows are the
 * only authority for dependent ledger cleanup; no later statement scans the
 * global DEAD set or infers identity from timestamps/error text.
 */
export async function reconcileExpiredBackgroundJobLeases(input: {
  queue: BackgroundJobQueue;
  leaseMs: number;
}): Promise<number> {
  if (
    !Number.isSafeInteger(input.leaseMs) ||
    input.leaseMs < 1 ||
    input.leaseMs > 2_147_483_647
  ) {
    throw new RangeError('background job leaseMs must be a positive int32');
  }

  const leaseCutoff = Prisma.sql`(now() - (${input.leaseMs}::int * interval '1 millisecond'))`;

  return db.$transaction(async (tx) => {
    // Lock/update the authoritative job before touching its attempt or domain
    // ledger. SKIP LOCKED lets multiple processes reap the same queue safely.
    const terminalJobs = await tx.$queryRaw<TerminalJobRow[]>(Prisma.sql`
      WITH "terminal_candidates" AS MATERIALIZED (
        SELECT job."id"
          FROM "BackgroundJob" AS job
         WHERE job."queue" = ${input.queue}::"BackgroundJobQueue"
           AND job."status" = 'RUNNING'::"BackgroundJobStatus"
           AND job."attempts" >= job."maxAttempts"
           AND COALESCE(job."heartbeatAt", job."lockedAt") < ${leaseCutoff}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE "BackgroundJob" AS job
         SET "status" = 'DEAD'::"BackgroundJobStatus",
             "finishedAt" = now(),
             "lockedBy" = NULL,
             "lockedAt" = NULL,
             "heartbeatAt" = NULL,
             "lastErrorCode" = COALESCE(
               job."lastErrorCode",
               'WorkerLeaseExpired'
             ),
             "updatedAt" = now()
        FROM "terminal_candidates" AS candidate
       WHERE job."id" = candidate."id"
      RETURNING job."id", job."type", job."dedupeKey", job."attempts",
                job."lastErrorCode"
    `);

    if (terminalJobs.length === 0) return 0;

    const terminalJobsCte = terminalJobValuesCte(terminalJobs);
    // Only a SENDING reservation can be ambiguous. FAILED stays monotonic and
    // definitively retryable evidence is owned by its existing ledger state.
    const fencedNotifications = await tx.$queryRaw<FencedNotificationRow[]>(
      Prisma.sql`
        WITH ${terminalJobsCte}
        UPDATE "NotificationLog" AS log
           SET "status" = 'UNKNOWN'::"NotificationStatus",
               "errorMessage" = 'worker lease expired after webhook may have been sent; owner confirmation required',
               "deliveryAttemptId" = NULL,
               "deliveryJobAttempt" = NULL,
               "deliveryStateVersion" = log."deliveryStateVersion" + 1,
               "lastAttemptAt" = now(),
               "updatedAt" = now()
          FROM "terminal_jobs" AS job
         WHERE job."type" = 'NOTIFICATION'
           AND log."deliveryKey" = job."dedupeKey"
           AND log."status" = 'SENDING'::"NotificationStatus"
           AND (
             log."deliveryJobAttempt" IS NULL
             OR log."deliveryJobAttempt" <= job."attempts"
           )
        RETURNING log."deliveryKey" AS "dedupeKey"
      `,
    );

    // UPDATE RETURNING is the proof that this reaper actually fenced an
    // ambiguous send. Never diagnose a job by matching human-facing text.
    const fencedKeys = new Set(
      fencedNotifications.map((notification) => notification.dedupeKey),
    );
    const fencedJobs = terminalJobs.filter(
      (job) => job.type === 'NOTIFICATION' && fencedKeys.has(job.dedupeKey),
    );
    if (fencedJobs.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        WITH ${terminalJobValuesCte(fencedJobs)}
        UPDATE "BackgroundJob" AS job
           SET "lastErrorCode" = ${NOTIFICATION_DELIVERY_UNKNOWN_ERROR_CODE},
               "result" = (
                 CASE
                   WHEN jsonb_typeof(job."result") = 'object' THEN job."result"
                   ELSE '{}'::jsonb
                 END
               ) || jsonb_build_object(
                 'event', job."payload"->>'event',
                 'unknown', (
                   SELECT COUNT(*)::integer
                     FROM "NotificationLog" AS unresolved
                    WHERE unresolved."deliveryKey" = job."dedupeKey"
                      AND unresolved."status" = 'UNKNOWN'::"NotificationStatus"
                 ),
                 'unlogged', 0,
                 'errorCodes', jsonb_build_array(
                   'WorkerLeaseExpiredAfterNotificationSend'
                 )
               ),
               "updatedAt" = now()
          FROM "terminal_jobs" AS fenced
         WHERE job."id" = fenced."id"
           AND job."status" = 'DEAD'::"BackgroundJobStatus"
           AND job."type" = 'NOTIFICATION'
      `);
    }

    // These statements are all driven by the exact rows returned by the job
    // transition above, preserving the global job -> child lock order.
    await tx.$executeRaw(Prisma.sql`
      WITH ${terminalJobsCte}
      UPDATE "BackgroundJobAttempt" AS attempt
         SET "status" = 'ABANDONED'::"BackgroundJobAttemptStatus",
             "finishedAt" = now(),
             "durationMs" = LEAST(
               2147483647,
               GREATEST(
                 0,
                 FLOOR(EXTRACT(EPOCH FROM (now() - attempt."startedAt")) * 1000)
               )
             )::integer
        FROM "terminal_jobs" AS job
       WHERE attempt."jobId" = job."id"
         AND attempt."status" = 'RUNNING'::"BackgroundJobAttemptStatus"
         AND attempt."attempt" = job."attempts"
    `);

    await tx.$executeRaw(Prisma.sql`
      WITH ${terminalJobsCte}
      UPDATE "DesignBundle" AS bundle
         SET "status" = 'FAILED'::"DesignBundleStatus",
             "lastErrorCode" = COALESCE(
               job."lastErrorCode",
               'WorkerLeaseExpired'
             )
        FROM "terminal_jobs" AS job
       WHERE bundle."backgroundJobId" = job."id"
         AND bundle."status" = 'PENDING'::"DesignBundleStatus"
         AND job."type" = 'CDR_BUNDLE'
    `);

    await tx.$executeRaw(Prisma.sql`
      WITH ${terminalJobsCte}
      UPDATE "OrderExport" AS order_export
         SET "status" = 'FAILED'::"OrderExportStatus",
             "lastErrorCode" = COALESCE(
               job."lastErrorCode",
               'WorkerLeaseExpired'
             ),
             "filters" = jsonb_build_object(
               'scope',
               CASE
                 WHEN order_export."filters"->>'scope' = 'all' THEN 'all'
                 ELSE 'filtered'
               END
             ),
             "updatedAt" = now()
        FROM "terminal_jobs" AS job
       WHERE order_export."backgroundJobId" = job."id"
         AND order_export."status" = 'PENDING'::"OrderExportStatus"
         AND job."type" = 'ORDER_EXPORT'
    `);

    await tx.$executeRaw(Prisma.sql`
      WITH ${terminalJobsCte}
      UPDATE "AgentMonthlyBillExport" AS bill_export
         SET "status" = 'FAILED'::"AgentMonthlyBillExportStatus",
             "lastErrorCode" = COALESCE(
               job."lastErrorCode",
               'WorkerLeaseExpired'
             ),
             "filters" = '{}'::jsonb,
             "artifactName" = NULL,
             "byteSize" = NULL,
             "updatedAt" = now()
        FROM "terminal_jobs" AS job
       WHERE bill_export."backgroundJobId" = job."id"
         AND bill_export."status" = 'PENDING'::"AgentMonthlyBillExportStatus"
         AND job."type" = 'AGENT_MONTHLY_BILL_EXPORT'
    `);

    return terminalJobs.length;
  });
}

function terminalJobValuesCte(rows: readonly TerminalJobRow[]): Prisma.Sql {
  return Prisma.sql`
    "terminal_jobs" (
      "id",
      "type",
      "dedupeKey",
      "attempts",
      "lastErrorCode"
    ) AS (
      VALUES ${Prisma.join(
        rows.map(
          (job) => Prisma.sql`(
            ${job.id}::text,
            ${job.type}::text,
            ${job.dedupeKey}::text,
            ${job.attempts}::integer,
            ${job.lastErrorCode}::text
          )`,
        ),
      )}
    )
  `;
}
