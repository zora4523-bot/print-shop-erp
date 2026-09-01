import {
  AgentMonthlyBillExportStatus,
  BackgroundJobAttemptStatus,
  BackgroundJobStatus,
  OrderExportStatus,
  Prisma,
  type BackgroundJob,
  type BackgroundJobQueue,
} from '../../generated/prisma/client';
import { db } from '../db';
import { scrubAgentMonthlyBillExportFiltersForBackgroundJob } from '../agent-monthly-billing/export-retention';
import { scrubOrderExportFiltersForBackgroundJob } from '../order/export-retention';
import {
  BACKGROUND_JOB_TYPES,
  type BackgroundJobResult,
  type ClaimedBackgroundJob,
  type EnqueueBackgroundJobInput,
} from './types';
import { databaseNow } from './clock';
import { backgroundJobErrorCode, retryDelayMs } from './policy';
import {
  backgroundJobRequiresOwnerResolution,
  isTerminalNotificationFailure,
} from './terminal-policy';

// 带上 `$queryRaw` 是为了让复活分支能用**同一个** client 去取库时钟：
// 调用方传的是事务时，时钟也必须来自那个事务，否则又变成两个时间源。
export type EnqueueClient = Pick<
  Prisma.TransactionClient,
  'backgroundJob' | '$queryRaw'
>;

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
  // Do not use create -> catch P2002 here.  PostgreSQL marks an interactive
  // transaction aborted after a unique violation, so the duplicate lookup
  // itself fails when this helper is used as a transactional outbox.  Prisma's
  // createMany(skipDuplicates) compiles to ON CONFLICT DO NOTHING: duplicates
  // are an ordinary result and the owning business transaction remains usable.
  const inserted = await client.backgroundJob.createMany({
    data: [{
      type: input.type,
      queue: input.queue,
      dedupeKey: input.dedupeKey,
      payload: input.payload,
      priority: input.priority ?? 100,
      maxAttempts: input.maxAttempts ?? 5,
      availableAt: input.availableAt,
    }],
    skipDuplicates: true,
  });
  const job = await client.backgroundJob.findUnique({
    where: { dedupeKey: input.dedupeKey },
  });
  if (!job) {
    throw new Error(`background job insert was not observable: ${input.dedupeKey}`);
  }
  if (inserted.count === 1) {
    return { job, created: true, requeued: false };
  }

  // SUCCEEDED/RUNNING/PENDING are real duplicates and must stay idempotent.
  // DEAD may be re-triggered through the same logical scope, keeping attempt
  // history attached. CANCELLED is an explicit operator decision and remains
  // terminal; a duplicate webhook/cron POST must not silently undo it.
  if (job.status === BackgroundJobStatus.DEAD) {
    // An UNKNOWN notification is a deliberate do-not-resend state. A repeated
    // business event with the same dedupe key must not move its job away from
    // the owner-resolution queue; only resolveUnknownNotification may re-arm
    // it after every ambiguous channel has an explicit decision.
    if (backgroundJobRequiresOwnerResolution(job)) {
      return { job, created: false, requeued: false };
    }
    const retryBudget = input.maxAttempts ?? 5;
    const updated = await client.backgroundJob.updateMany({
      where: {
        id: job.id,
        // Generation CAS: a concurrent re-arm/run/cancel must make this stale
        // reader lose. Matching either terminal status would let an old DEAD
        // reader overwrite a newer CANCELLED generation (ABA), possibly with
        // attempts === maxAttempts and a permanently unclaimable PENDING row.
        status: BackgroundJobStatus.DEAD,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
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
    if (!current) {
      throw new Error(`background job disappeared while re-arming: ${input.dedupeKey}`);
    }
    return { job: current, created: false, requeued: updated.count === 1 };
  }

  return { job, created: false, requeued: false };
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
  reclaimed: boolean;
};

export async function claimNextBackgroundJob(input: {
  queue: BackgroundJobQueue;
  workerId: string;
  leaseMs: number;
}): Promise<ClaimedBackgroundJob | null> {
  // 租约判定只用数据库时钟。终态回收由 queue-local lease
  // reaper 独立调度；claim 热路径只领取一条任务并开启 attempt。
  const leaseCutoff = Prisma.sql`(now() - (${input.leaseMs}::int * interval '1 millisecond'))`;

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ClaimedRow[]>`
      WITH candidate AS (
        SELECT "id", ("status" = 'RUNNING'::"BackgroundJobStatus") AS "reclaimed"
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
                now() AS "claimedAt", candidate."reclaimed"
    `;

    const row = rows[0];
    if (!row) return null;

    if (row.reclaimed) {
      // The UPDATE above still holds the job row lock. Close the abandoned
      // attempt before inserting its successor, so all lease transitions use
      // the same job -> attempt locking order.
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
         WHERE attempt."jobId" = ${row.id}
           AND attempt."attempt" = ${row.attempts - 1}
           AND attempt."status" = 'RUNNING'::"BackgroundJobAttemptStatus"
      `;
    }

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
      id: row.id,
      type: row.type,
      queue: row.queue,
      dedupeKey: row.dedupeKey,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      claimedAt: row.claimedAt,
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
  const partialResult = backgroundJobPartialResult(error);
  // UNKNOWN and stale manual-replay authorization are not retryable transport
  // failures. Retrying either payload cannot make it safe or current, so keep
  // the ledger evidence and terminate the owning job without burning attempts.
  const terminalNotificationFailure = isTerminalNotificationFailure({
    type: job.type,
    lastErrorCode: errorCode,
  });
  const exhausted =
    job.attempts >= job.maxAttempts || terminalNotificationFailure;

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
        ...(partialResult === undefined ? {} : { result: partialResult }),
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

    if (
      exhausted &&
      job.type === BACKGROUND_JOB_TYPES.AGENT_MONTHLY_BILL_EXPORT
    ) {
      const failed = await tx.agentMonthlyBillExport.updateMany({
        where: {
          backgroundJobId: job.id,
          status: AgentMonthlyBillExportStatus.PENDING,
        },
        data: {
          status: AgentMonthlyBillExportStatus.FAILED,
          artifactName: null,
          byteSize: null,
          lastErrorCode: errorCode,
        },
      });
      if (failed.count > 0) {
        await scrubAgentMonthlyBillExportFiltersForBackgroundJob(job.id, tx);
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
      select: {
        status: true,
        type: true,
        attempts: true,
        maxAttempts: true,
        lastErrorCode: true,
      },
    });
    if (!job || job.status !== BackgroundJobStatus.DEAD) return false;
    // Terminal export rows no longer retain their raw filter params. Reusing
    // the old job would therefore be both invalid and misleading; the admin
    // must request a fresh export from the order list with current filters.
    if (
      job.type === BACKGROUND_JOB_TYPES.ORDER_EXPORT ||
      job.type === BACKGROUND_JOB_TYPES.AGENT_MONTHLY_BILL_EXPORT
    ) {
      if (job.type === BACKGROUND_JOB_TYPES.ORDER_EXPORT) {
        await scrubOrderExportFiltersForBackgroundJob(jobId, tx);
      } else {
        await scrubAgentMonthlyBillExportFiltersForBackgroundJob(jobId, tx);
      }
      return false;
    }
    if (backgroundJobRequiresOwnerResolution(job)) {
      return false;
    }
    // 「立刻可跑」必须用库时钟表达：web 进程的 new Date() 快了就把重试
    // 推迟到未来，慢了则无所谓 —— 两种都不该由 web 的时钟说了算。
    const at = await databaseNow(tx);
    const updated = await tx.backgroundJob.updateMany({
      // CAS: two operators (or a stale browser double-submit) may both read
      // DEAD above. Only the first is allowed to move the ledger row; a later
      // request must not overwrite a job that has already been claimed.
      where: {
        id: jobId,
        status: BackgroundJobStatus.DEAD,
        // Include the generation as well as the state. A fast worker could
        // otherwise take the first retry through PENDING/RUNNING back to DEAD
        // before a stale second request executes (the classic ABA race).
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
      },
      data: {
        status: BackgroundJobStatus.PENDING,
        maxAttempts: Math.max(job.maxAttempts, job.attempts + 3),
        availableAt: at,
        finishedAt: null,
        lockedBy: null,
        lockedAt: null,
        heartbeatAt: null,
        lastErrorCode: null,
      },
    });
    if (updated.count !== 1) return false;
    if (job.type === 'CDR_BUNDLE') {
      await tx.designBundle.updateMany({
        where: { backgroundJobId: jobId },
        data: { status: 'PENDING', lastErrorCode: null },
      });
    }
    return true;
  });
}

function backgroundJobPartialResult(
  error: unknown,
): Prisma.InputJsonValue | undefined {
  if (
    !error ||
    typeof error !== 'object' ||
    !('partialResult' in error) ||
    error.partialResult === undefined
  ) {
    return undefined;
  }
  // Durable handlers attach plain JSON progress snapshots to their typed
  // errors (batch results and notification delivery counts). Persist that
  // snapshot on the authoritative job row before retrying or marking DEAD.
  return error.partialResult as Prisma.InputJsonValue;
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
    const failedAgentBillExports =
      await tx.agentMonthlyBillExport.updateMany({
        where: {
          backgroundJobId: jobId,
          status: AgentMonthlyBillExportStatus.PENDING,
        },
        data: {
          status: AgentMonthlyBillExportStatus.FAILED,
          artifactName: null,
          byteSize: null,
          lastErrorCode: 'CancelledByOperator',
        },
      });
    if (failedAgentBillExports.count > 0) {
      await scrubAgentMonthlyBillExportFiltersForBackgroundJob(jobId, tx);
    }
    return true;
  });
}
