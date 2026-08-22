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
import { databaseNow } from './clock';
import { backgroundJobErrorCode, retryDelayMs } from './policy';

// 带上 `$queryRaw` 是为了让复活分支能用**同一个** client 去取库时钟：
// 调用方传的是事务时，时钟也必须来自那个事务，否则又变成两个时间源。
type EnqueueClient = Pick<Prisma.TransactionClient, 'backgroundJob' | '$queryRaw'>;

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
          // 库时钟，不是 new Date()：这一行写下的 availableAt 之后要被
          // claimNextBackgroundJob 拿 `availableAt <= now()` 比较（同文件
          // 的 SQL）。用 Node 时钟写、用库时钟读，就是本模块专门要消除的
          // 两套时间源——web 机快 5 分钟时，本该立刻执行的 re-arm 会白等
          // 5 分钟。failBackgroundJob / retryDeadBackgroundJob 早已切到
          // databaseNow，唯独这条 DEAD/CANCELLED 复活路径漏了。
          availableAt: input.availableAt ?? (await databaseNow(client)),
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
  claimedAt: Date;
};

export async function claimNextBackgroundJob(input: {
  queue: BackgroundJobQueue;
  workerId: string;
  leaseMs: number;
}): Promise<ClaimedBackgroundJob | null> {
  // 下面每一个瞬间都来自数据库，绝不来自本 worker 的 Node 时钟。两台机器上的
  // worker 会拿各自的 new Date() 去比对方写下的 heartbeatAt —— 时钟快的那台
  // 会把对方还在跑的租约判成过期并重新 claim，同一个导出/通知执行两次。
  //
  // 这里用 now()（= transaction_timestamp）而不是 clock_timestamp()：整个事务
  // 一个固定瞬间，下面 4 条清扫语句和最后的 claim 必须对同一个瞬间达成一致。
  // clock_timestamp() 会随语句间的往返前进，于是租约可能在「清扫 attempt 之后、
  // claim 之前」过期 —— 旧 attempt 行永远停在 RUNNING，新 attempt 行却已插进来。
  // 代价是 now() 略早于真实时间（事务开始时刻），这只会让清扫更保守，是安全方向。
  const leaseCutoff = Prisma.sql`(now() - (${input.leaseMs}::int * interval '1 millisecond'))`;

  return db.$transaction(async (tx) => {
    // Close the attempt left behind by a worker that stopped heartbeating.
    await tx.$executeRaw`
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
             "finishedAt" = now(),
             "lockedBy" = NULL,
             "lockedAt" = NULL,
             "heartbeatAt" = NULL,
             "lastErrorCode" = COALESCE("lastErrorCode", 'WorkerLeaseExpired'),
             "updatedAt" = now()
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
             "updatedAt" = now()
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
               AND "availableAt" <= now()
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
             "lockedAt" = now(),
             "heartbeatAt" = now(),
             "startedAt" = COALESCE(job."startedAt", now()),
             "finishedAt" = NULL,
             "lastErrorCode" = NULL,
             "updatedAt" = now()
        FROM candidate
       WHERE job."id" = candidate."id"
      RETURNING job."id", job."type", job."queue", job."dedupeKey",
                job."payload", job."attempts", job."maxAttempts",
                now() AS "claimedAt"
    `;

    const row = rows[0];
    if (!row) return null;

    await tx.backgroundJobAttempt.create({
      data: {
        jobId: row.id,
        attempt: row.attempts,
        workerId: input.workerId,
        status: BackgroundJobAttemptStatus.RUNNING,
        // 与上面 UPDATE 的 lockedAt 同一个 now()，逐字节相等。
        startedAt: row.claimedAt,
      },
    });

    return {
      ...row,
      workerId: input.workerId,
    };
  });
}

/**
 * 心跳只有一句话要说：「此刻我还活着」。这里用 clock_timestamp() 而不是
 * now()：单语句下二者等价，但如果将来这句被裹进某个更大的事务，now() 会
 * 悄悄盖上事务开始时刻的戳、低估租约剩余时间，clock_timestamp() 两种情形
 * 下都对。改 raw 是必需的 —— 类型化 updateMany 只能送一个 JS Date。
 */
export async function heartbeatBackgroundJob(
  job: ClaimedBackgroundJob,
): Promise<void> {
  // raw 绕过 Prisma 的 @updatedAt，必须自己写，否则心跳不再推进 updatedAt。
  const updated = await db.$executeRaw`
    UPDATE "BackgroundJob"
       SET "heartbeatAt" = clock_timestamp(),
           "updatedAt" = clock_timestamp()
     WHERE "id" = ${job.id}
       AND "status" = 'RUNNING'::"BackgroundJobStatus"
       AND "lockedBy" = ${job.workerId}
       AND "attempts" = ${job.attempts}
  `;
  if (updated !== 1) throw new BackgroundJobLeaseLostError(job.id);
}

export async function completeBackgroundJob(
  job: ClaimedBackgroundJob,
  result?: BackgroundJobResult,
  /**
   * 仅供测试注入时钟。生产必须留空，让时间戳来自数据库 —— 跨机器可比。
   * 注意这里刻意不是 `= new Date()`：默认值一旦是 Node 时钟，忘记传就等于
   * 悄悄退回本缺陷。
   */
  now?: Date,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const at = now ?? (await databaseNow(tx));
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
        finishedAt: at,
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
        finishedAt: at,
        // job.claimedAt 现在也是库时钟（claim 的 RETURNING now()），两端同源。
        durationMs: durationMs(job.claimedAt, at),
      },
    });
  });
}

export async function failBackgroundJob(
  job: ClaimedBackgroundJob,
  error: unknown,
  /** 仅供测试注入时钟；生产留空，见 completeBackgroundJob。 */
  now?: Date,
): Promise<void> {
  const errorCode = backgroundJobErrorCode(error);
  const exhausted = job.attempts >= job.maxAttempts;

  await db.$transaction(async (tx) => {
    // availableAt 之后要被 claim 拿 `availableAt <= now()` 比较，所以退避
    // 的锚点必须是库时钟；偏移量本身是常数，在 JS 里加没有问题。
    const at = now ?? (await databaseNow(tx));
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
          ? at
          : new Date(at.getTime() + retryDelayMs(job.attempts)),
        finishedAt: exhausted ? at : null,
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
        finishedAt: at,
        durationMs: durationMs(job.claimedAt, at),
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
      // 成功但「一条也没送出去」的任务（通知的永久性投递失败）只在 result
      // 里留证据：completeBackgroundJob 在成功路径会把 lastErrorCode 置 null，
      // 光看状态列它就是一行绿色的 SUCCEEDED。ops 页据此渲染错误码列。
      result: true,
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
    // 「立刻可跑」必须用库时钟表达：web 进程的 new Date() 快了就把重试
    // 推迟到未来，慢了则无所谓 —— 两种都不该由 web 的时钟说了算。
    const at = await databaseNow(tx);
    await tx.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: BackgroundJobStatus.PENDING,
        maxAttempts: Math.max(job.maxAttempts, job.attempts + 3),
        availableAt: at,
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
    const at = await databaseNow(tx);
    const updated = await tx.backgroundJob.updateMany({
      where: { id: jobId, status: BackgroundJobStatus.PENDING },
      data: {
        status: BackgroundJobStatus.CANCELLED,
        finishedAt: at,
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
