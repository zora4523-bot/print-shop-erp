import {
  BackgroundJobAttemptStatus,
  BackgroundJobStatus,
  OrderExportStatus,
  Prisma,
  type BackgroundJob,
  type BackgroundJobQueue,
} from '../../generated/prisma/client';
import { db } from '../db';
import { scrubOrderExportFiltersForBackgroundJob } from '../order/export-retention';
import type {
  BackgroundJobResult,
  ClaimedBackgroundJob,
  EnqueueBackgroundJobInput,
} from './types';
import { backgroundJobErrorCode, retryDelayMs } from './policy';

type EnqueueClient = Pick<Prisma.TransactionClient, 'backgroundJob'>;

export type EnqueueBackgroundJobResult = {
  job: BackgroundJob;
  created: boolean;
  requeued: boolean;
};

export class BackgroundJobLeaseLostError extends Error {
  constructor(jobId: string) {
    super(`background job lease lost: ${jobId}`);
    this.name = 'BackgroundJobLeaseLostError';
  }
}

export async function enqueueBackgroundJob(
  input: EnqueueBackgroundJobInput,
  client: EnqueueClient = db,
): Promise<EnqueueBackgroundJobResult> {
  try {
    const job = await client.backgroundJob.create({
      data: {
        type: input.type,
        queue: input.queue,
        dedupeKey: input.dedupeKey,
        payload: input.payload,
        priority: input.priority ?? 100,
        maxAttempts: input.maxAttempts ?? 5,
        availableAt: input.availableAt,
      },
    });
    return { job, created: true, requeued: false };
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      throw error;
    }
    const job = await client.backgroundJob.findUnique({
      where: { dedupeKey: input.dedupeKey },
    });
    if (!job) throw error;

    // SUCCEEDED/RUNNING/PENDING are real duplicates and must stay idempotent.
    // DEAD/CANCELLED are terminal delivery failures: keeping their unique key
    // forever would make an operator retry of the same logical scope silently
    // no-op. Re-arm the same ledger row so attempt history stays attached.
    if (
      job.status === BackgroundJobStatus.DEAD ||
      job.status === BackgroundJobStatus.CANCELLED
    ) {
      const retryBudget = input.maxAttempts ?? 5;
      const updated = await client.backgroundJob.updateMany({
        where: {
          id: job.id,
          status: {
            in: [BackgroundJobStatus.DEAD, BackgroundJobStatus.CANCELLED],
          },
        },
        data: {
          type: input.type,
          queue: input.queue,
          payload: input.payload,
          priority: input.priority ?? 100,
          maxAttempts: Math.max(job.maxAttempts, job.attempts + retryBudget),
          availableAt: input.availableAt ?? new Date(),
          result: Prisma.JsonNull,
          status: BackgroundJobStatus.PENDING,
          finishedAt: null,
          lockedBy: null,
          lockedAt: null,
          heartbeatAt: null,
          lastErrorCode: null,
        },
      });
      const current = await client.backgroundJob.findUnique({
        where: { dedupeKey: input.dedupeKey },
      });
      if (!current) throw error;
      return { job: current, created: false, requeued: updated.count === 1 };
    }

    return { job, created: false, requeued: false };
  }
}

type ClaimedRow = {
  id: string;
  type: string;
  queue: BackgroundJobQueue;
  dedupeKey: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
};

export async function claimNextBackgroundJob(input: {
  queue: BackgroundJobQueue;
  workerId: string;
  leaseMs: number;
  now?: Date;
}): Promise<ClaimedBackgroundJob | null> {
  const now = input.now ?? new Date();
  const leaseCutoff = new Date(now.getTime() - input.leaseMs);

  return db.$transaction(async (tx) => {
    // Close the attempt left behind by a worker that stopped heartbeating.
    await tx.$executeRaw`
      UPDATE "BackgroundJobAttempt" AS attempt
         SET "status" = 'ABANDONED'::"BackgroundJobAttemptStatus",
             "finishedAt" = ${now},
             "durationMs" = LEAST(
               2147483647,
               GREATEST(
                 0,
                 FLOOR(EXTRACT(EPOCH FROM (${now} - attempt."startedAt")) * 1000)
               )
             )::integer
        FROM "BackgroundJob" AS job
       WHERE attempt."jobId" = job."id"
         AND attempt."status" = 'RUNNING'::"BackgroundJobAttemptStatus"
         AND job."status" = 'RUNNING'::"BackgroundJobStatus"
         AND COALESCE(job."heartbeatAt", job."lockedAt") < ${leaseCutoff}
    `;

    // A final-attempt worker may die before it can mark DEAD. The lease
    // sweeper makes that terminal state observable instead of leaving RUNNING
    // forever.
    await tx.$executeRaw`
      UPDATE "BackgroundJob"
         SET "status" = 'DEAD'::"BackgroundJobStatus",
             "finishedAt" = ${now},
             "lockedBy" = NULL,
             "lockedAt" = NULL,
             "heartbeatAt" = NULL,
             "lastErrorCode" = COALESCE("lastErrorCode", 'WorkerLeaseExpired'),
             "updatedAt" = ${now}
       WHERE "status" = 'RUNNING'::"BackgroundJobStatus"
         AND "attempts" >= "maxAttempts"
         AND COALESCE("heartbeatAt", "lockedAt") < ${leaseCutoff}
    `;

    // A final-attempt CDR worker can disappear before its handler records the
    // terminal bundle state. Reconcile from the authoritative job ledger so
    // the download page never remains PENDING forever.
    await tx.$executeRaw`
      UPDATE "DesignBundle" AS bundle
         SET "status" = 'FAILED'::"DesignBundleStatus",
             "lastErrorCode" = COALESCE(job."lastErrorCode", 'WorkerLeaseExpired')
        FROM "BackgroundJob" AS job
       WHERE bundle."backgroundJobId" = job."id"
         AND bundle."status" = 'PENDING'::"DesignBundleStatus"
         AND job."status" = 'DEAD'::"BackgroundJobStatus"
         AND job."type" = 'CDR_BUNDLE'
    `;

    // Export handlers deliberately leave retryable failures PENDING. When a
    // worker disappears on its final attempt, reconcile the user-facing
    // export ledger from the authoritative background-job terminal state.
    await tx.$executeRaw`
      UPDATE "OrderExport" AS order_export
         SET "status" = 'FAILED'::"OrderExportStatus",
             "lastErrorCode" = COALESCE(job."lastErrorCode", 'WorkerLeaseExpired'),
             "filters" = jsonb_build_object(
               'scope',
               CASE
                 WHEN order_export."filters"->>'scope' = 'all' THEN 'all'
                 ELSE 'filtered'
               END
             ),
             "updatedAt" = ${now}
        FROM "BackgroundJob" AS job
       WHERE order_export."backgroundJobId" = job."id"
         AND order_export."status" = 'PENDING'::"OrderExportStatus"
         AND job."status" = 'DEAD'::"BackgroundJobStatus"
         AND job."type" = 'ORDER_EXPORT'
    `;

    const rows = await tx.$queryRaw<ClaimedRow[]>`
      WITH candidate AS (
        SELECT "id"
          FROM "BackgroundJob"
         WHERE "queue" = ${input.queue}::"BackgroundJobQueue"
           AND "attempts" < "maxAttempts"
           AND (
             (
               "status" = 'PENDING'::"BackgroundJobStatus"
               AND "availableAt" <= ${now}
             )
             OR (
               "status" = 'RUNNING'::"BackgroundJobStatus"
               AND COALESCE("heartbeatAt", "lockedAt") < ${leaseCutoff}
             )
           )
         ORDER BY "priority" DESC, "availableAt" ASC, "createdAt" ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      UPDATE "BackgroundJob" AS job
         SET "status" = 'RUNNING'::"BackgroundJobStatus",
             "attempts" = job."attempts" + 1,
             "lockedBy" = ${input.workerId},
             "lockedAt" = ${now},
             "heartbeatAt" = ${now},
             "startedAt" = COALESCE(job."startedAt", ${now}),
             "finishedAt" = NULL,
             "lastErrorCode" = NULL,
             "updatedAt" = ${now}
        FROM candidate
       WHERE job."id" = candidate."id"
      RETURNING job."id", job."type", job."queue", job."dedupeKey",
                job."payload", job."attempts", job."maxAttempts"
    `;

    const row = rows[0];
    if (!row) return null;

    await tx.backgroundJobAttempt.create({
      data: {
        jobId: row.id,
        attempt: row.attempts,
        workerId: input.workerId,
        status: BackgroundJobAttemptStatus.RUNNING,
        startedAt: now,
      },
    });

    return {
      ...row,
      workerId: input.workerId,
      claimedAt: now,
    };
  });
}

export async function heartbeatBackgroundJob(
  job: ClaimedBackgroundJob,
  now: Date = new Date(),
): Promise<void> {
  const updated = await db.backgroundJob.updateMany({
    where: {
      id: job.id,
      status: BackgroundJobStatus.RUNNING,
      lockedBy: job.workerId,
      attempts: job.attempts,
    },
    data: { heartbeatAt: now },
  });
  if (updated.count !== 1) throw new BackgroundJobLeaseLostError(job.id);
}

export async function completeBackgroundJob(
  job: ClaimedBackgroundJob,
  result?: BackgroundJobResult,
  now: Date = new Date(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const updated = await tx.backgroundJob.updateMany({
      where: {
        id: job.id,
        status: BackgroundJobStatus.RUNNING,
        lockedBy: job.workerId,
        attempts: job.attempts,
      },
      data: {
        status: BackgroundJobStatus.SUCCEEDED,
        result: result ?? Prisma.JsonNull,
        finishedAt: now,
        lockedBy: null,
        lockedAt: null,
        heartbeatAt: null,
        lastErrorCode: null,
      },
    });
    if (updated.count !== 1) throw new BackgroundJobLeaseLostError(job.id);

    await tx.backgroundJobAttempt.update({
      where: {
        jobId_attempt: { jobId: job.id, attempt: job.attempts },
      },
      data: {
        status: BackgroundJobAttemptStatus.SUCCEEDED,
        finishedAt: now,
        durationMs: durationMs(job.claimedAt, now),
      },
    });
  });
}

export async function failBackgroundJob(
  job: ClaimedBackgroundJob,
  error: unknown,
  now: Date = new Date(),
): Promise<void> {
  const errorCode = backgroundJobErrorCode(error);
  const exhausted = job.attempts >= job.maxAttempts;

  await db.$transaction(async (tx) => {
    const updated = await tx.backgroundJob.updateMany({
      where: {
        id: job.id,
        status: BackgroundJobStatus.RUNNING,
        lockedBy: job.workerId,
        attempts: job.attempts,
      },
      data: {
        status: exhausted
          ? BackgroundJobStatus.DEAD
          : BackgroundJobStatus.PENDING,
        availableAt: exhausted
          ? now
          : new Date(now.getTime() + retryDelayMs(job.attempts)),
        finishedAt: exhausted ? now : null,
        lockedBy: null,
        lockedAt: null,
        heartbeatAt: null,
        lastErrorCode: errorCode,
      },
    });
    if (updated.count !== 1) throw new BackgroundJobLeaseLostError(job.id);

    if (exhausted && job.type === 'CDR_BUNDLE') {
      await tx.designBundle.updateMany({
        where: { backgroundJobId: job.id },
        data: {
          status: 'FAILED',
          lastErrorCode: errorCode,
        },
      });
    }

    if (exhausted && job.type === 'ORDER_EXPORT') {
      const failed = await tx.orderExport.updateMany({
        where: {
          backgroundJobId: job.id,
          status: OrderExportStatus.PENDING,
        },
        data: {
          status: OrderExportStatus.FAILED,
          lastErrorCode: errorCode,
        },
      });
      if (failed.count > 0) {
        await scrubOrderExportFiltersForBackgroundJob(job.id, tx);
      }
    }

    await tx.backgroundJobAttempt.update({
      where: {
        jobId_attempt: { jobId: job.id, attempt: job.attempts },
      },
      data: {
        status: BackgroundJobAttemptStatus.FAILED,
        errorCode,
        finishedAt: now,
        durationMs: durationMs(job.claimedAt, now),
      },
    });
  });
}

function durationMs(start: Date, end: Date): number {
  return Math.min(2_147_483_647, Math.max(0, end.getTime() - start.getTime()));
}

export async function listBackgroundJobs(limit = 100) {
  return db.backgroundJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, Math.max(1, limit)),
    select: {
      id: true,
      type: true,
      queue: true,
      status: true,
      priority: true,
      attempts: true,
      maxAttempts: true,
      availableAt: true,
      startedAt: true,
      finishedAt: true,
      lastErrorCode: true,
      createdAt: true,
      attemptLogs: {
        orderBy: { attempt: 'desc' },
        take: 1,
        select: { durationMs: true },
      },
    },
  });
}

export async function retryDeadBackgroundJob(jobId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const job = await tx.backgroundJob.findUnique({
      where: { id: jobId },
      select: { status: true, type: true, attempts: true, maxAttempts: true },
    });
    if (!job || job.status !== BackgroundJobStatus.DEAD) return false;
    // Terminal export rows no longer retain their raw filter params. Reusing
    // the old job would therefore be both invalid and misleading; the admin
    // must request a fresh export from the order list with current filters.
    if (job.type === 'ORDER_EXPORT') {
      await scrubOrderExportFiltersForBackgroundJob(jobId, tx);
      return false;
    }
    await tx.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: BackgroundJobStatus.PENDING,
        maxAttempts: Math.max(job.maxAttempts, job.attempts + 3),
        availableAt: new Date(),
        finishedAt: null,
        lastErrorCode: null,
      },
    });
    if (job.type === 'CDR_BUNDLE') {
      await tx.designBundle.updateMany({
        where: { backgroundJobId: jobId },
        data: { status: 'PENDING', lastErrorCode: null },
      });
    }
    return true;
  });
}

export async function cancelPendingBackgroundJob(jobId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const updated = await tx.backgroundJob.updateMany({
      where: { id: jobId, status: BackgroundJobStatus.PENDING },
      data: {
        status: BackgroundJobStatus.CANCELLED,
        finishedAt: new Date(),
        lockedBy: null,
        lockedAt: null,
        heartbeatAt: null,
        lastErrorCode: 'CancelledByOperator',
      },
    });
    if (updated.count !== 1) return false;
    await tx.designBundle.updateMany({
      where: { backgroundJobId: jobId, status: 'PENDING' },
      data: { status: 'FAILED', lastErrorCode: 'CancelledByOperator' },
    });
    const failedExports = await tx.orderExport.updateMany({
      where: {
        backgroundJobId: jobId,
        status: OrderExportStatus.PENDING,
      },
      data: {
        status: OrderExportStatus.FAILED,
        lastErrorCode: 'CancelledByOperator',
      },
    });
    if (failedExports.count > 0) {
      await scrubOrderExportFiltersForBackgroundJob(jobId, tx);
    }
    return true;
  });
}
