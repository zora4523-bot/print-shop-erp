import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    backgroundJob: {
      createMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    backgroundJobAttempt: {
      create: vi.fn(),
      update: vi.fn(),
    },
    notificationLog: { updateMany: vi.fn() },
    designBundle: { updateMany: vi.fn() },
    orderExport: { updateMany: vi.fn() },
    agentMonthlyBillExport: { updateMany: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  AgentMonthlyBillExportStatus,
  BackgroundJobQueue,
  BackgroundJobStatus,
  Prisma,
} from '../../../generated/prisma/client';
import {
  BACKGROUND_JOB_UNDISPATCHED_CLAIM_ERROR_CODE,
  BackgroundJobLeaseLostError,
  cancelPendingBackgroundJob,
  claimNextBackgroundJob,
  completeBackgroundJob,
  enqueueBackgroundJob,
  failBackgroundJob,
  heartbeatBackgroundJob,
  releaseUndispatchedBackgroundJobClaim,
  RetiredBackgroundJobTypeError,
  retryDeadBackgroundJob,
} from '../repository';
import { backgroundJobErrorCode, retryDelayMs } from '../policy';
import type { ClaimedBackgroundJob } from '../types';

/** 数据库现在是时钟：所有非 claim 路径都靠这行 `SELECT now()` 决定时间。 */
const DB_NOW = new Date('2026-07-17T08:00:00.000Z');

/**
 * 抓出一条 SQL 里所有「往时间戳列写值」的赋值。RHS 取到行尾而不是逗号，
 * 因为 `"startedAt" = COALESCE(job."startedAt", now())` 自己带逗号。
 */
const TIMESTAMP_ASSIGNMENT =
  /"(finishedAt|updatedAt|lockedAt|heartbeatAt|startedAt)"\s*=\s*([^\n]+)/g;

beforeEach(() => {
  for (const group of [
    dbMock.backgroundJob,
    dbMock.backgroundJobAttempt,
    dbMock.notificationLog,
    dbMock.designBundle,
    dbMock.orderExport,
    dbMock.agentMonthlyBillExport,
  ]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
  dbMock.designBundle.updateMany.mockResolvedValue({ count: 0 });
  dbMock.orderExport.updateMany.mockResolvedValue({ count: 0 });
  dbMock.agentMonthlyBillExport.updateMany.mockResolvedValue({ count: 0 });
  dbMock.notificationLog.updateMany.mockResolvedValue({ count: 0 });
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$queryRaw.mockReset().mockResolvedValue([{ now: DB_NOW }]);
  dbMock.$transaction.mockReset().mockImplementation(async (callback) =>
    callback(dbMock),
  );
});

function input() {
  return {
    type: 'CRON_DAILY_SALARY' as const,
    queue: BackgroundJobQueue.LIGHT,
    dedupeKey: 'cron:daily:2026-07-16',
    payload: { date: '2026-07-16' },
    maxAttempts: 4,
  };
}

describe('enqueueBackgroundJob', () => {
  it('caps a channel test at one execution even when a caller requests retries', async () => {
    dbMock.backgroundJob.createMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      id: 'test-1',
      status: BackgroundJobStatus.PENDING,
    });

    await enqueueBackgroundJob({
      ...input(),
      type: 'NOTIFICATION_CHANNEL_TEST',
      payload: { channelId: 'channel-1' },
      maxAttempts: 5,
    });

    expect(dbMock.backgroundJob.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ maxAttempts: 1 })],
      skipDuplicates: true,
    });
  });

  it('re-arms a channel test for one execution and discards a legacy retry budget', async () => {
    const terminal = {
      id: 'test-1',
      type: 'NOTIFICATION_CHANNEL_TEST',
      status: BackgroundJobStatus.DEAD,
      attempts: 2,
      maxAttempts: 5,
    };
    dbMock.backgroundJob.createMany.mockResolvedValue({ count: 0 });
    dbMock.backgroundJob.findUnique.mockResolvedValue(terminal);
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });

    await enqueueBackgroundJob({
      ...input(),
      type: 'NOTIFICATION_CHANNEL_TEST',
      payload: { channelId: 'channel-1' },
      maxAttempts: 5,
    });

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ maxAttempts: 3 }),
      }),
    );
  });

  it('creates a fresh ledger row', async () => {
    const job = { id: 'job-1', status: BackgroundJobStatus.PENDING };
    dbMock.backgroundJob.createMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJob.findUnique.mockResolvedValue(job);

    await expect(enqueueBackgroundJob(input())).resolves.toEqual({
      job,
      created: true,
      requeued: false,
    });
  });

  it('keeps an active/succeeded duplicate idempotent', async () => {
    const job = {
      id: 'job-1',
      status: BackgroundJobStatus.SUCCEEDED,
      attempts: 1,
      maxAttempts: 4,
    };
    dbMock.backgroundJob.createMany.mockResolvedValue({ count: 0 });
    dbMock.backgroundJob.findUnique.mockResolvedValue(job);

    await expect(enqueueBackgroundJob(input())).resolves.toEqual({
      job,
      created: false,
      requeued: false,
    });
    expect(dbMock.backgroundJob.updateMany).not.toHaveBeenCalled();
  });

  it(
    're-arms a DEAD duplicate with a fresh retry budget',
    async () => {
      const status = BackgroundJobStatus.DEAD;
      const terminal = {
        id: 'job-1',
        status,
        attempts: 4,
        maxAttempts: 4,
      };
      const pending = {
        ...terminal,
        status: BackgroundJobStatus.PENDING,
        maxAttempts: 8,
      };
      dbMock.backgroundJob.createMany.mockResolvedValue({ count: 0 });
      dbMock.backgroundJob.findUnique
        .mockResolvedValueOnce(terminal)
        .mockResolvedValueOnce(pending);
      dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });

      await expect(enqueueBackgroundJob(input())).resolves.toEqual({
        job: pending,
        created: false,
        requeued: true,
      });
      expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'job-1',
            status,
            attempts: 4,
            maxAttempts: 4,
          },
          data: expect.objectContaining({
            status: BackgroundJobStatus.PENDING,
            maxAttempts: 8,
            lastErrorCode: null,
            // 复活的 availableAt 必须是**库时钟**。用 Node 的 new Date()
            // 写、用 claim 的 `availableAt <= now()` 读，两套时间源在多机
            // 部署下会让本该立刻执行的重试白等一个时钟偏差。
            availableAt: DB_NOW,
          }),
        }),
      );
    },
  );

  it('keeps an operator-cancelled duplicate terminal', async () => {
    const cancelled = {
      id: 'job-1',
      status: BackgroundJobStatus.CANCELLED,
      attempts: 1,
      maxAttempts: 4,
    };
    dbMock.backgroundJob.createMany.mockResolvedValue({ count: 0 });
    dbMock.backgroundJob.findUnique.mockResolvedValue(cancelled);

    await expect(enqueueBackgroundJob(input())).resolves.toEqual({
      job: cancelled,
      created: false,
      requeued: false,
    });
    expect(dbMock.backgroundJob.updateMany).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous notification DEAD when the business event is enqueued again', async () => {
    const unknown = {
      id: 'job-notification-unknown',
      type: 'NOTIFICATION',
      status: BackgroundJobStatus.DEAD,
      attempts: 1,
      maxAttempts: 5,
      lastErrorCode: 'NotificationDeliveryUnknownError',
      payload: {
        event: 'ORDER_SUBMITTED',
        payload: { orderId: 'order-1', orderNo: 'GD-1' },
      },
    };
    dbMock.backgroundJob.createMany.mockResolvedValue({ count: 0 });
    dbMock.backgroundJob.findUnique.mockResolvedValue(unknown);

    await expect(
      enqueueBackgroundJob({
        type: 'NOTIFICATION',
        queue: BackgroundJobQueue.LIGHT,
        dedupeKey: 'notification:order-submitted:order-1',
        // A repeated caller may now render a different body. It must not
        // overwrite the payload that the owner is reviewing.
        payload: {
          event: 'ORDER_SUBMITTED',
          payload: { orderId: 'order-1', orderNo: 'CHANGED' },
        },
      }),
    ).resolves.toEqual({ job: unknown, created: false, requeued: false });

    expect(dbMock.backgroundJob.updateMany).not.toHaveBeenCalled();
    expect(dbMock.backgroundJob.findUnique).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale terminal reader overwrite a newer generation', async () => {
    const stale = {
      id: 'job-1',
      status: BackgroundJobStatus.DEAD,
      attempts: 5,
      maxAttempts: 5,
    };
    const newer = {
      id: 'job-1',
      status: BackgroundJobStatus.CANCELLED,
      attempts: 10,
      maxAttempts: 10,
    };
    dbMock.backgroundJob.createMany.mockResolvedValue({ count: 0 });
    dbMock.backgroundJob.findUnique
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(newer);
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 0 });

    await expect(enqueueBackgroundJob(input())).resolves.toEqual({
      job: newer,
      created: false,
      requeued: false,
    });
    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'job-1',
          status: BackgroundJobStatus.DEAD,
          attempts: 5,
          maxAttempts: 5,
        },
      }),
    );
  });

  it('复活时显式传入的 availableAt 优先于库时钟', async () => {
    const at = new Date('2026-09-01T00:00:00.000Z');
    dbMock.backgroundJob.createMany.mockResolvedValue({ count: 0 });
    dbMock.backgroundJob.findUnique
      .mockResolvedValueOnce({
        id: 'job-1',
        status: BackgroundJobStatus.DEAD,
        attempts: 4,
        maxAttempts: 4,
      })
      .mockResolvedValueOnce({
        id: 'job-1',
        status: BackgroundJobStatus.PENDING,
        attempts: 4,
        maxAttempts: 8,
      });
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });

    await enqueueBackgroundJob({ ...input(), availableAt: at });

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ availableAt: at }),
      }),
    );
  });
});

describe('claim and lease lifecycle', () => {
  const claimed: ClaimedBackgroundJob = {
    id: 'job-lease',
    type: 'NOTIFICATION',
    queue: BackgroundJobQueue.LIGHT,
    dedupeKey: 'notification:1',
    payload: { event: 'ORDER_SUBMITTED' },
    attempts: 1,
    maxAttempts: 5,
    workerId: 'worker-1',
    claimedAt: new Date('2026-07-17T08:00:00Z'),
  };

  it('claims through the transaction and opens an attempt log', async () => {
    // claimedAt 现在由语句自己的 now() 从 RETURNING 带回，所以这一行 mock
    // 就是本用例的时钟。
    dbMock.$queryRaw.mockResolvedValue([
      {
        id: claimed.id,
        type: claimed.type,
        queue: claimed.queue,
        dedupeKey: claimed.dedupeKey,
        payload: claimed.payload,
        attempts: claimed.attempts,
        maxAttempts: claimed.maxAttempts,
        claimedAt: claimed.claimedAt,
      },
    ]);
    dbMock.backgroundJobAttempt.create.mockResolvedValue({});

    await expect(
      claimNextBackgroundJob({
        queue: BackgroundJobQueue.LIGHT,
        workerId: 'worker-1',
        leaseMs: 300_000,
      }),
    ).resolves.toEqual(claimed);

    expect(dbMock.$executeRaw).not.toHaveBeenCalled();
    const claimSql = (
      dbMock.$queryRaw.mock.calls[0]![0] as TemplateStringsArray
    ).join('?');
    expect(claimSql).toContain('UPDATE "BackgroundJob" AS job');
    expect(claimSql).not.toContain('NotificationLog');
    expect(claimSql).not.toContain('DesignBundle');
    expect(claimSql).not.toContain('OrderExport');
    expect(dbMock.backgroundJobAttempt.create).toHaveBeenCalledWith({
      data: {
        jobId: claimed.id,
        attempt: 1,
        workerId: 'worker-1',
        status: 'RUNNING',
        startedAt: claimed.claimedAt,
      },
    });
  });

  it('anchors every lease decision on the database clock', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        id: claimed.id,
        type: claimed.type,
        queue: claimed.queue,
        dedupeKey: claimed.dedupeKey,
        payload: claimed.payload,
        attempts: claimed.attempts,
        maxAttempts: claimed.maxAttempts,
        claimedAt: claimed.claimedAt,
      },
    ]);
    dbMock.backgroundJobAttempt.create.mockResolvedValue({});

    await claimNextBackgroundJob({
      queue: BackgroundJobQueue.LIGHT,
      workerId: 'worker-1',
      leaseMs: 300_000,
    });

    const statements = [
      ...dbMock.$executeRaw.mock.calls,
      ...dbMock.$queryRaw.mock.calls,
    ];
    expect(statements).toHaveLength(1);

    for (const [strings, ...values] of statements) {
      const sql = (strings as TemplateStringsArray).join('?');
      // 整条 claim 事务里没有一个 JS 瞬间被绑进去。谁把 new Date() 塞回租约
      // 路径，谁就在这里变红 —— 这就是本缺陷的回归门。
      expect(
        values.some((value) => value instanceof Date),
        `a JS Date was bound into: ${sql}`,
      ).toBe(false);
      // 而每一个真正被写下的时间戳都由数据库自己产生（清空成 NULL 除外）。
      for (const match of sql.matchAll(TIMESTAMP_ASSIGNMENT)) {
        const assignment = `"${match[1]}" = ${match[2]!.trim().replace(/,$/, '')}`;
        expect(
          assignment.endsWith('NULL') || assignment.includes('now()'),
          `timestamp not written by the database: ${assignment}`,
        ).toBe(true);
      }
    }
  });

  it('parameterizes the lease window and keeps the row lock hand-off intact', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);

    await expect(
      claimNextBackgroundJob({
        queue: BackgroundJobQueue.LIGHT,
        workerId: 'worker-1',
        leaseMs: 300_000,
      }),
    ).resolves.toBeNull();

    const [strings, ...values] = dbMock.$queryRaw.mock.calls[0]!;
    const sql = (strings as TemplateStringsArray).join('?');
    // 并发安全靠这一行，改租约时钟不该顺手把它弄丢。
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('"availableAt" <= now()');
    // claimedAt 与 lockedAt 是同一个 now()，所以 durationMs 两端同源。
    expect(sql).toContain('now() AS "claimedAt"');

    const leaseCutoff = values.find(
      (value): value is Prisma.Sql => value instanceof Prisma.Sql,
    );
    expect(leaseCutoff?.sql).toContain("interval '1 millisecond'");
    // leaseMs 是绑定参数，不是拼进 SQL 的字符串。
    expect(leaseCutoff?.values).toEqual([300_000]);
    // An idle poll must not carry notification/CDR/export reconciliation.
    expect(dbMock.$executeRaw).not.toHaveBeenCalled();
    expect(dbMock.backgroundJobAttempt.create).not.toHaveBeenCalled();
  });

  it('reclaims a stale lease only after locking its job, then abandons the old attempt', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        id: claimed.id,
        type: claimed.type,
        queue: claimed.queue,
        dedupeKey: claimed.dedupeKey,
        payload: claimed.payload,
        attempts: 2,
        maxAttempts: claimed.maxAttempts,
        claimedAt: claimed.claimedAt,
        reclaimed: true,
      },
    ]);
    dbMock.backgroundJobAttempt.create.mockResolvedValue({});

    await claimNextBackgroundJob({
      queue: BackgroundJobQueue.LIGHT,
      workerId: 'worker-1',
      leaseMs: 300_000,
    });

    const claimSql = (
      dbMock.$queryRaw.mock.calls[0]![0] as TemplateStringsArray
    ).join('?');
    const abandonCall = dbMock.$executeRaw.mock.calls[0]!;
    const abandonSql = (abandonCall[0] as TemplateStringsArray).join('?');
    expect(claimSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claimSql).toContain('candidate."reclaimed"');
    expect(abandonSql).toContain('UPDATE "BackgroundJobAttempt" AS attempt');
    expect(abandonSql).toContain('attempt."attempt" = ?');
    expect(abandonCall.slice(1)).toEqual([claimed.id, 1]);
    expect(dbMock.backgroundJobAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ attempt: 2 }),
    });
  });

  it('heartbeat rejects when the worker no longer owns the lease', async () => {
    dbMock.$executeRaw.mockResolvedValue(0);

    await expect(heartbeatBackgroundJob(claimed)).rejects.toBeInstanceOf(
      BackgroundJobLeaseLostError,
    );
  });

  it('heartbeat stamps the database clock, never the worker process clock', async () => {
    dbMock.$executeRaw.mockResolvedValue(1);

    await expect(heartbeatBackgroundJob(claimed)).resolves.toBeUndefined();

    const [strings, ...values] = dbMock.$executeRaw.mock.calls[0]!;
    const sql = (strings as TemplateStringsArray).join('?');
    expect(sql).toContain('"heartbeatAt" = clock_timestamp()');
    // 租约守卫必须原封不动地留在 WHERE 里。
    expect(sql).toContain('"status" = \'RUNNING\'::"BackgroundJobStatus"');
    expect(values).toEqual([claimed.id, claimed.workerId, claimed.attempts]);
    expect(values.some((value) => value instanceof Date)).toBe(false);
  });

  it('releases an undispatched claim without reusing its fencing generation or run budget', async () => {
    const undispatched = {
      ...claimed,
      attempts: 5,
      maxAttempts: 5,
      claimedAt: new Date('2026-07-17T07:59:59.250Z'),
    };
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});

    await releaseUndispatchedBackgroundJobClaim(undispatched);

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: undispatched.id,
        status: BackgroundJobStatus.RUNNING,
        lockedBy: undispatched.workerId,
        attempts: 5,
        maxAttempts: 5,
      },
      data: {
        status: BackgroundJobStatus.PENDING,
        maxAttempts: 6,
        availableAt: DB_NOW,
        finishedAt: null,
        lockedBy: null,
        lockedAt: null,
        heartbeatAt: null,
        lastErrorCode: BACKGROUND_JOB_UNDISPATCHED_CLAIM_ERROR_CODE,
      },
    });
    expect(dbMock.backgroundJobAttempt.update).toHaveBeenCalledWith({
      where: {
        jobId_attempt: { jobId: undispatched.id, attempt: 5 },
      },
      data: {
        status: 'ABANDONED',
        errorCode: BACKGROUND_JOB_UNDISPATCHED_CLAIM_ERROR_CODE,
        finishedAt: DB_NOW,
        durationMs: 750,
      },
    });
    expect(
      dbMock.backgroundJob.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(dbMock.backgroundJobAttempt.update.mock.invocationCallOrder[0]!);
  });

  it('does not abandon another worker generation when release loses its lease CAS', async () => {
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      releaseUndispatchedBackgroundJobClaim(claimed, DB_NOW),
    ).rejects.toBeInstanceOf(BackgroundJobLeaseLostError);

    expect(dbMock.backgroundJobAttempt.update).not.toHaveBeenCalled();
  });

  it('completes the owned job and its attempt atomically', async () => {
    const finishedAt = new Date('2026-07-17T08:00:01Z');
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});

    await completeBackgroundJob(claimed, { delivered: true }, finishedAt);

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: claimed.id,
          lockedBy: claimed.workerId,
          attempts: claimed.attempts,
        }),
        data: expect.objectContaining({
          status: BackgroundJobStatus.SUCCEEDED,
          result: { delivered: true },
          finishedAt,
        }),
      }),
    );
    expect(dbMock.backgroundJobAttempt.update).toHaveBeenCalledWith({
      where: { jobId_attempt: { jobId: claimed.id, attempt: 1 } },
      data: {
        status: 'SUCCEEDED',
        finishedAt,
        durationMs: 1_000,
      },
    });
    expect(
      dbMock.backgroundJob.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(dbMock.backgroundJobAttempt.update.mock.invocationCallOrder[0]!);
  });

  it('takes the completion instant from the database when none is injected', async () => {
    const started = {
      ...claimed,
      claimedAt: new Date('2026-07-17T07:59:58.500Z'),
    };
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});

    await completeBackgroundJob(started, { delivered: true });

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BackgroundJobStatus.SUCCEEDED,
          finishedAt: DB_NOW,
        }),
      }),
    );
    expect(dbMock.backgroundJobAttempt.update).toHaveBeenCalledWith({
      where: { jobId_attempt: { jobId: started.id, attempt: 1 } },
      data: {
        status: 'SUCCEEDED',
        finishedAt: DB_NOW,
        // claimedAt 也来自库时钟，所以这个差值才是真实耗时而不是时钟偏差。
        durationMs: 1_500,
      },
    });
  });

  it('returns a retryable failure to PENDING with bounded backoff', async () => {
    const retryable = { ...claimed, attempts: 2 };
    const failedAt = new Date('2026-07-17T08:00:01Z');
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});

    await failBackgroundJob(
      retryable,
      Object.assign(new Error('private'), { name: 'TemporaryError' }),
      failedAt,
    );

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BackgroundJobStatus.PENDING,
          availableAt: new Date(failedAt.getTime() + 60_000),
          lastErrorCode: 'TemporaryError',
        }),
      }),
    );
    expect(
      dbMock.backgroundJob.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(dbMock.backgroundJobAttempt.update.mock.invocationCallOrder[0]!);
  });

  it('persists typed partial progress before scheduling a retry', async () => {
    const partialResult = {
      attempted: 2,
      delivered: 1,
      failed: 1,
      errorCodes: ['http 429'],
    };
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});

    await failBackgroundJob(
      claimed,
      Object.assign(new Error('private'), {
        name: 'NotificationDeliveryFailedError',
        partialResult,
      }),
      DB_NOW,
    );

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: partialResult }),
      }),
    );
  });

  it.each(['http 429', 'wecom errcode=45009'])(
    'last notification attempt for %s makes the job DEAD without rewriting its RETRYING log',
    async (providerError) => {
      const exhausted = { ...claimed, attempts: 5, maxAttempts: 5 };
      const partialResult = {
        event: 'ORDER_SUBMITTED',
        attempted: 1,
        delivered: 0,
        failed: 1,
        unknown: 0,
        errorCodes: [providerError],
      };
      dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
      dbMock.backgroundJobAttempt.update.mockResolvedValue({});

      await failBackgroundJob(
        exhausted,
        Object.assign(new Error('retry budget exhausted'), {
          name: 'NotificationDeliveryFailedError',
          partialResult,
        }),
        DB_NOW,
      );

      expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ attempts: 5 }),
          data: expect.objectContaining({
            status: BackgroundJobStatus.DEAD,
            finishedAt: DB_NOW,
            lastErrorCode: 'NotificationDeliveryFailedError',
            result: partialResult,
          }),
        }),
      );
      // 只允许兜底仍卡在 SENDING 的账本；已经落好的 RETRYING 不匹配，
      // 不得被改成 FAILED 或 UNKNOWN。
      expect(dbMock.notificationLog.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'SENDING' }),
          data: expect.objectContaining({ status: 'UNKNOWN' }),
        }),
      );
    },
  );

  it('moves an ambiguous notification straight to DEAD for owner resolution', async () => {
    const partialResult = {
      event: 'ORDER_SUBMITTED',
      attempted: 1,
      delivered: 0,
      unknown: 1,
      errorCodes: ['HTTP 500'],
    };
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});

    await failBackgroundJob(
      claimed,
      Object.assign(new Error('ambiguous'), {
        name: 'NotificationDeliveryUnknownError',
        partialResult,
      }),
      DB_NOW,
    );

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BackgroundJobStatus.DEAD,
          finishedAt: DB_NOW,
          lastErrorCode: 'NotificationDeliveryUnknownError',
          result: partialResult,
        }),
      }),
    );
  });

  it('never schedules another channel test after an unconfirmed send, even with a legacy retry budget', async () => {
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});

    await failBackgroundJob(
      {
        ...claimed,
        type: 'NOTIFICATION_CHANNEL_TEST',
        payload: { channelId: 'channel-1' },
        attempts: 2,
        maxAttempts: 4,
      },
      Object.assign(new Error('notification channel test delivery failed'), {
        name: 'NotificationChannelTestDeliveryError',
      }),
      DB_NOW,
    );

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BackgroundJobStatus.DEAD,
          finishedAt: DB_NOW,
          lastErrorCode: 'NotificationChannelTestDeliveryError',
        }),
      }),
    );
  });

  it('makes a stranded SENDING delivery owner-visible and terminal atomically', async () => {
    const strandedJob = { ...claimed, attempts: 1, maxAttempts: 5 };
    const partialResult = {
      event: 'ORDER_SUBMITTED',
      attempted: 1,
      delivered: 0,
      failed: 0,
      unknown: 0,
      errorCodes: ['NotificationDeliveryLedgerError'],
    };
    dbMock.notificationLog.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});

    await failBackgroundJob(
      strandedJob,
      Object.assign(new Error('database unavailable'), {
        name: 'NotificationDeliveryFailedError',
        partialResult,
      }),
      DB_NOW,
    );

    expect(dbMock.notificationLog.updateMany).toHaveBeenCalledWith({
      where: {
        deliveryKey: strandedJob.dedupeKey,
        status: 'SENDING',
        OR: [
          { deliveryJobAttempt: null },
          { deliveryJobAttempt: { lte: strandedJob.attempts } },
        ],
      },
      data: expect.objectContaining({
        status: 'UNKNOWN',
        deliveryAttemptId: null,
        deliveryJobAttempt: null,
        deliveryStateVersion: { increment: 1 },
      }),
    });
    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BackgroundJobStatus.DEAD,
          lastErrorCode: 'NotificationDeliveryUnknownError',
          result: expect.objectContaining({
            unknown: 1,
            errorCodes: expect.arrayContaining([
              'background job ended before delivery finalization could be persisted',
            ]),
          }),
        }),
      }),
    );
    expect(dbMock.backgroundJobAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorCode: 'NotificationDeliveryUnknownError',
        }),
      }),
    );
  });

  it('moves a manual replay conflict straight to DEAD and preserves RETRYING evidence', async () => {
    const partialResult = {
      event: 'ORDER_SUBMITTED',
      attempted: 1,
      delivered: 0,
      failed: 2,
      unknown: 0,
      errorCodes: ['http 429', 'NotificationReplayConflictError'],
    };
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});

    await failBackgroundJob(
      { ...claimed, attempts: 2, maxAttempts: 5 },
      Object.assign(new Error('stale manual replay'), {
        name: 'NotificationReplayTerminalError',
        partialResult,
      }),
      DB_NOW,
    );

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BackgroundJobStatus.DEAD,
          finishedAt: DB_NOW,
          lastErrorCode: 'NotificationReplayTerminalError',
          result: partialResult,
        }),
      }),
    );
    // The already-finalized 429 row remains RETRYING. The terminal fallback
    // targets only stranded SENDING rows, so it cannot rewrite this evidence.
    expect(dbMock.notificationLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'SENDING' }),
      }),
    );
  });

  it('does not burn the remaining retry budget for a pure replay conflict', async () => {
    const partialResult = {
      event: 'ORDER_SUBMITTED',
      attempted: 0,
      delivered: 0,
      failed: 1,
      unknown: 0,
      errorCodes: ['NotificationReplayConflictError'],
    };
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});

    await failBackgroundJob(
      { ...claimed, attempts: 1, maxAttempts: 5 },
      Object.assign(new Error('stale manual replay'), {
        name: 'NotificationReplayTerminalError',
        partialResult,
      }),
      DB_NOW,
    );

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ attempts: 1 }),
        data: expect.objectContaining({
          status: BackgroundJobStatus.DEAD,
          lastErrorCode: 'NotificationReplayTerminalError',
          result: partialResult,
        }),
      }),
    );
  });

  it('anchors retry backoff on the database clock when none is injected', async () => {
    const retryable = { ...claimed, attempts: 2 };
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});

    await failBackgroundJob(
      retryable,
      Object.assign(new Error('private'), { name: 'TemporaryError' }),
    );

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BackgroundJobStatus.PENDING,
          // 退避锚在库时钟上：claim 稍后拿 `availableAt <= now()` 比较，
          // 用 worker 自己的钟做锚点等于让偏差决定重试早晚。
          availableAt: new Date(DB_NOW.getTime() + 60_000),
        }),
      }),
    );
  });

  it('re-arms a dead job at the database instant', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      status: BackgroundJobStatus.DEAD,
      type: 'NOTIFICATION',
      attempts: 5,
      maxAttempts: 5,
    });
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });

    await expect(retryDeadBackgroundJob(claimed.id)).resolves.toBe(true);

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: claimed.id,
        status: BackgroundJobStatus.DEAD,
        attempts: 5,
        maxAttempts: 5,
      },
      data: {
        status: BackgroundJobStatus.PENDING,
        maxAttempts: 8,
        availableAt: DB_NOW,
        finishedAt: null,
        lockedBy: null,
        lockedAt: null,
        heartbeatAt: null,
        lastErrorCode: null,
      },
    });
  });

  it('rejects a direct retry of an ambiguous notification on the server', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      status: BackgroundJobStatus.DEAD,
      type: 'NOTIFICATION',
      attempts: 1,
      maxAttempts: 5,
      lastErrorCode: 'NotificationDeliveryUnknownError',
    });

    await expect(retryDeadBackgroundJob(claimed.id)).resolves.toBe(false);

    expect(dbMock.backgroundJob.updateMany).not.toHaveBeenCalled();
  });

  it.each(['CRON_HOURLY_PAYROLL', 'CRON_CS_SETTLE', 'CRON_CS_PERIOD_ENDING'])(
    'refuses to requeue a dead %s job whose handler was removed, keeping the history row',
    async (type) => {
      dbMock.backgroundJob.findUnique.mockResolvedValue({
        status: BackgroundJobStatus.DEAD,
        type,
        attempts: 5,
        maxAttempts: 5,
        lastErrorCode: 'SalaryRuleMissingError',
      });
      dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });

      await expect(retryDeadBackgroundJob('retired-1')).rejects.toBeInstanceOf(
        RetiredBackgroundJobTypeError,
      );

      expect(dbMock.backgroundJob.updateMany).not.toHaveBeenCalled();
      expect(dbMock.backgroundJob.update).not.toHaveBeenCalled();
    },
  );

  it('refuses to requeue a dead notification whose event was retired', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      status: BackgroundJobStatus.DEAD,
      type: 'NOTIFICATION',
      attempts: 5,
      maxAttempts: 5,
      lastErrorCode: 'NotificationDeliveryFailedError',
      payload: { event: 'CS_PERIOD_ENDING', payload: { periodId: 'p-1' } },
    });
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });

    await expect(retryDeadBackgroundJob('retired-n')).rejects.toBeInstanceOf(
      RetiredBackgroundJobTypeError,
    );
    expect(dbMock.backgroundJob.updateMany).not.toHaveBeenCalled();
  });

  it('an operator channel-test retry authorizes exactly one more execution', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      status: BackgroundJobStatus.DEAD,
      type: 'NOTIFICATION_CHANNEL_TEST',
      attempts: 2,
      maxAttempts: 5,
      lastErrorCode: 'NotificationChannelTestDeliveryError',
    });
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });

    await expect(retryDeadBackgroundJob('test-1')).resolves.toBe(true);

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BackgroundJobStatus.PENDING,
          maxAttempts: 3,
        }),
      }),
    );
  });

  it('loses a concurrent DEAD retry CAS without resetting the new owner or child ledger', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      status: BackgroundJobStatus.DEAD,
      type: 'CDR_BUNDLE',
      attempts: 3,
      maxAttempts: 3,
    });
    // 另一事务已先把 DEAD 移走；本事务的条件更新必须成为 no-op。
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 0 });

    await expect(retryDeadBackgroundJob('job-cdr')).resolves.toBe(false);

    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'job-cdr',
          status: BackgroundJobStatus.DEAD,
          attempts: 3,
          maxAttempts: 3,
        },
      }),
    );
    expect(dbMock.designBundle.updateMany).not.toHaveBeenCalled();
  });

  it('allows exactly one of two simultaneous operator retries to win', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      status: BackgroundJobStatus.DEAD,
      type: 'NOTIFICATION',
      attempts: 5,
      maxAttempts: 5,
    });
    let alreadyMoved = false;
    dbMock.backgroundJob.updateMany.mockImplementation(async () => {
      // Model PostgreSQL's conditional UPDATE: both callers observed the same
      // DEAD generation, but only the first statement can move it.
      if (alreadyMoved) return { count: 0 };
      alreadyMoved = true;
      return { count: 1 };
    });

    const results = await Promise.all([
      retryDeadBackgroundJob('job-dead'),
      retryDeadBackgroundJob('job-dead'),
    ]);

    expect(results.sort()).toEqual([false, true]);
    expect(dbMock.backgroundJob.updateMany).toHaveBeenCalledTimes(2);
  });
});

describe('terminal CDR state', () => {
  const claimed: ClaimedBackgroundJob = {
    id: 'job-cdr',
    type: 'CDR_BUNDLE',
    queue: BackgroundJobQueue.HEAVY,
    dedupeKey: 'cdr-bundle:b1',
    payload: { bundleId: 'b1' },
    attempts: 3,
    maxAttempts: 3,
    workerId: 'worker-1',
    claimedAt: new Date('2026-07-17T08:00:00Z'),
  };

  it('marks its bundle FAILED when attempts are exhausted', async () => {
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});
    dbMock.designBundle.updateMany.mockResolvedValue({ count: 1 });

    await failBackgroundJob(
      claimed,
      Object.assign(new Error('private details'), { name: 'CdrUploadError' }),
      new Date('2026-07-17T08:01:00Z'),
    );

    expect(dbMock.designBundle.updateMany).toHaveBeenCalledWith({
      where: { backgroundJobId: 'job-cdr', status: 'PENDING' },
      data: { status: 'FAILED', lastErrorCode: 'CdrUploadError' },
    });
  });

  it('keeps a retryable CDR failure pending with its error code', async () => {
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});
    await failBackgroundJob({ ...claimed, attempts: 1 }, new Error('temporary'), new Date('2026-07-17T08:01:00Z'));
    expect(dbMock.designBundle.updateMany).toHaveBeenCalledWith({
      where: { backgroundJobId: 'job-cdr', status: 'PENDING' },
      data: { status: 'PENDING', lastErrorCode: 'Error' },
    });
  });

  it('operator cancellation marks a pending bundle FAILED', async () => {
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.designBundle.updateMany.mockResolvedValue({ count: 1 });

    await expect(cancelPendingBackgroundJob('job-cdr')).resolves.toBe(true);
    expect(dbMock.designBundle.updateMany).toHaveBeenCalledWith({
      where: { backgroundJobId: 'job-cdr', status: 'PENDING' },
      data: { status: 'FAILED', lastErrorCode: 'CancelledByOperator' },
    });
  });

  it('manual retry returns a dead CDR bundle to PENDING', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      status: BackgroundJobStatus.DEAD,
      type: 'CDR_BUNDLE',
      attempts: 3,
      maxAttempts: 3,
    });
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.designBundle.updateMany.mockResolvedValue({ count: 1 });

    await expect(retryDeadBackgroundJob('job-cdr')).resolves.toBe(true);
    expect(dbMock.designBundle.updateMany).toHaveBeenCalledWith({
      where: { backgroundJobId: 'job-cdr' },
      data: { status: 'PENDING', lastErrorCode: null },
    });
  });
});

describe('terminal order export state', () => {
  const claimed: ClaimedBackgroundJob = {
    id: 'job-export',
    type: 'ORDER_EXPORT',
    queue: BackgroundJobQueue.HEAVY,
    dedupeKey: 'order-export:export-1',
    payload: { exportId: 'export-1' },
    attempts: 3,
    maxAttempts: 3,
    workerId: 'worker-1',
    claimedAt: new Date('2026-08-07T08:00:00Z'),
  };

  it('marks the export FAILED only after attempts are exhausted', async () => {
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});
    dbMock.orderExport.updateMany.mockResolvedValue({ count: 1 });

    await failBackgroundJob(
      claimed,
      Object.assign(new Error('private details'), { name: 'OrderExportError' }),
      new Date('2026-08-07T08:01:00Z'),
    );

    expect(dbMock.orderExport.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        backgroundJobId: 'job-export',
        status: 'PENDING',
      },
      data: { status: 'FAILED', lastErrorCode: 'OrderExportError' },
    });
    const scrubCall = dbMock.$executeRaw.mock.calls.at(-1);
    expect((scrubCall?.[0] as TemplateStringsArray).join('?')).toContain(
      '"filters" = jsonb_build_object(',
    );
    expect((scrubCall?.[0] as TemplateStringsArray).join('?')).not.toContain(
      'filterHash',
    );
    expect(scrubCall?.[1]).toBe('job-export');
  });

  it('keeps the export PENDING while the job remains retryable', async () => {
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});

    await failBackgroundJob(
      { ...claimed, attempts: 1 },
      Object.assign(new Error('private details'), { name: 'TemporaryError' }),
      new Date('2026-08-07T08:01:00Z'),
    );

    expect(dbMock.orderExport.updateMany).not.toHaveBeenCalled();
  });

  it('operator cancellation marks a pending export FAILED', async () => {
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.designBundle.updateMany.mockResolvedValue({ count: 0 });
    dbMock.orderExport.updateMany.mockResolvedValue({ count: 1 });

    await expect(cancelPendingBackgroundJob('job-export')).resolves.toBe(true);
    expect(dbMock.orderExport.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { backgroundJobId: 'job-export', status: 'PENDING' },
      data: { status: 'FAILED', lastErrorCode: 'CancelledByOperator' },
    });
    const scrubCall = dbMock.$executeRaw.mock.calls.at(-1);
    expect((scrubCall?.[0] as TemplateStringsArray).join('?')).toContain(
      '"filters" = jsonb_build_object(',
    );
    expect((scrubCall?.[0] as TemplateStringsArray).join('?')).not.toContain(
      'filterHash',
    );
    expect(scrubCall?.[1]).toBe('job-export');
  });

  it('rejects manual retry after terminal export filters have been scrubbed', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      status: BackgroundJobStatus.DEAD,
      type: 'ORDER_EXPORT',
      attempts: 3,
      maxAttempts: 3,
    });
    await expect(retryDeadBackgroundJob('job-export')).resolves.toBe(false);
    expect(dbMock.backgroundJob.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderExport.updateMany).not.toHaveBeenCalled();
    const scrubCall = dbMock.$executeRaw.mock.calls.at(-1);
    expect((scrubCall?.[0] as TemplateStringsArray).join('?')).toContain(
      '"filters" = jsonb_build_object(',
    );
    expect((scrubCall?.[0] as TemplateStringsArray).join('?')).not.toContain(
      'filterHash',
    );
    expect(scrubCall?.[1]).toBe('job-export');
  });
});

describe('terminal agent monthly bill export state', () => {
  const claimed: ClaimedBackgroundJob = {
    id: 'job-agent-bill-export',
    type: 'AGENT_MONTHLY_BILL_EXPORT',
    queue: BackgroundJobQueue.HEAVY,
    dedupeKey: 'agent-monthly-bill-export:export-1',
    payload: { exportId: 'export-1' },
    attempts: 3,
    maxAttempts: 3,
    workerId: 'worker-1',
    claimedAt: new Date('2026-09-02T08:00:00Z'),
  };

  it('marks the independent export ledger FAILED only after exhaustion', async () => {
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.backgroundJobAttempt.update.mockResolvedValue({});
    dbMock.agentMonthlyBillExport.updateMany.mockResolvedValue({ count: 1 });

    await failBackgroundJob(
      claimed,
      Object.assign(new Error('private financial detail'), {
        name: 'AgentBillExportError',
      }),
      new Date('2026-09-02T08:01:00Z'),
    );

    expect(dbMock.agentMonthlyBillExport.updateMany).toHaveBeenCalledWith({
      where: {
        backgroundJobId: claimed.id,
        status: AgentMonthlyBillExportStatus.PENDING,
      },
      data: {
        status: AgentMonthlyBillExportStatus.FAILED,
        artifactName: null,
        byteSize: null,
        lastErrorCode: 'AgentBillExportError',
      },
    });
    const scrubCall = dbMock.$executeRaw.mock.calls.at(-1);
    expect((scrubCall?.[0] as TemplateStringsArray).join('?')).toContain(
      'UPDATE "AgentMonthlyBillExport"',
    );
    expect(scrubCall?.[1]).toBe(claimed.id);
  });

  it('does not expose an invalid manual retry after filters are scrubbed', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      status: BackgroundJobStatus.DEAD,
      type: 'AGENT_MONTHLY_BILL_EXPORT',
      attempts: 3,
      maxAttempts: 3,
    });
    await expect(
      retryDeadBackgroundJob('job-agent-bill-export'),
    ).resolves.toBe(false);
    expect(dbMock.backgroundJob.updateMany).not.toHaveBeenCalled();
    expect(dbMock.$executeRaw).toHaveBeenCalled();
  });

  it('closes the export ledger when an operator cancels its pending job', async () => {
    dbMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    dbMock.agentMonthlyBillExport.updateMany.mockResolvedValue({ count: 1 });
    await expect(
      cancelPendingBackgroundJob('job-agent-bill-export'),
    ).resolves.toBe(true);
    expect(dbMock.agentMonthlyBillExport.updateMany).toHaveBeenCalledWith({
      where: {
        backgroundJobId: 'job-agent-bill-export',
        status: AgentMonthlyBillExportStatus.PENDING,
      },
      data: {
        status: AgentMonthlyBillExportStatus.FAILED,
        artifactName: null,
        byteSize: null,
        lastErrorCode: 'CancelledByOperator',
      },
    });
  });
});

describe('background job retry policy', () => {
  it('uses bounded exponential backoff', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(120_000);
    expect(retryDelayMs(99)).toBe(30 * 60_000);
  });

  it('normalizes invalid attempts to the first delay', () => {
    expect(retryDelayMs(0)).toBe(30_000);
    expect(retryDelayMs(Number.NaN)).toBe(30_000);
  });

  it('stores only an error code, never the error message', () => {
    const error = new Error('customer phone 13800000000');
    error.name = 'Webhook Timeout/Error';
    expect(backgroundJobErrorCode(error)).toBe('Webhook_Timeout_Error');
    expect(backgroundJobErrorCode(error)).not.toContain('13800000000');
    expect(backgroundJobErrorCode('raw secret')).toBe('UnknownError');
  });
});
