import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    backgroundJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    backgroundJobAttempt: {
      create: vi.fn(),
      update: vi.fn(),
    },
    designBundle: { updateMany: vi.fn() },
    orderExport: { updateMany: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  BackgroundJobQueue,
  BackgroundJobStatus,
  Prisma,
} from '../../../generated/prisma/client';
import {
  BackgroundJobLeaseLostError,
  cancelPendingBackgroundJob,
  claimNextBackgroundJob,
  completeBackgroundJob,
  enqueueBackgroundJob,
  failBackgroundJob,
  heartbeatBackgroundJob,
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
    dbMock.designBundle,
    dbMock.orderExport,
  ]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
  dbMock.designBundle.updateMany.mockResolvedValue({ count: 0 });
  dbMock.orderExport.updateMany.mockResolvedValue({ count: 0 });
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

function duplicateError() {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: '7.7.0',
    meta: { target: ['dedupeKey'] },
  });
}

describe('enqueueBackgroundJob', () => {
  it('creates a fresh ledger row', async () => {
    const job = { id: 'job-1', status: BackgroundJobStatus.PENDING };
    dbMock.backgroundJob.create.mockResolvedValue(job);

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
    dbMock.backgroundJob.create.mockRejectedValue(duplicateError());
    dbMock.backgroundJob.findUnique.mockResolvedValue(job);

    await expect(enqueueBackgroundJob(input())).resolves.toEqual({
      job,
      created: false,
      requeued: false,
    });
    expect(dbMock.backgroundJob.updateMany).not.toHaveBeenCalled();
  });

  it.each([BackgroundJobStatus.DEAD, BackgroundJobStatus.CANCELLED])(
    're-arms a %s duplicate with a fresh retry budget',
    async (status) => {
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
      dbMock.backgroundJob.create.mockRejectedValue(duplicateError());
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
          where: expect.objectContaining({ id: 'job-1' }),
          data: expect.objectContaining({
            status: BackgroundJobStatus.PENDING,
            maxAttempts: 8,
            lastErrorCode: null,
          }),
        }),
      );
    },
  );
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

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(4);
    const exportReconciliationSql = (
      dbMock.$executeRaw.mock.calls[3]![0] as TemplateStringsArray
    ).join('?');
    expect(exportReconciliationSql).toContain(
      'UPDATE "OrderExport" AS order_export',
    );
    expect(exportReconciliationSql).toContain(
      'order_export."status" = \'PENDING\'::"OrderExportStatus"',
    );
    expect(exportReconciliationSql).toContain(
      '"filters" = jsonb_build_object(',
    );
    expect(exportReconciliationSql).toContain(
      "WHEN order_export.\"filters\"->>'scope' = 'all' THEN 'all'",
    );
    expect(exportReconciliationSql).toContain("ELSE 'filtered'");
    expect(exportReconciliationSql).not.toContain('filterHash');
    expect(exportReconciliationSql).not.toContain("- 'params'");
    expect(exportReconciliationSql).toContain(
      'job."status" = \'DEAD\'::"BackgroundJobStatus"',
    );
    expect(exportReconciliationSql).toContain("job.\"type\" = 'ORDER_EXPORT'");
    expect(exportReconciliationSql).toContain('WorkerLeaseExpired');
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
    expect(statements).toHaveLength(5);

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
    dbMock.backgroundJob.update.mockResolvedValue({});

    await expect(retryDeadBackgroundJob(claimed.id)).resolves.toBe(true);

    expect(dbMock.backgroundJob.update).toHaveBeenCalledWith({
      where: { id: claimed.id },
      data: {
        status: BackgroundJobStatus.PENDING,
        maxAttempts: 8,
        availableAt: DB_NOW,
        finishedAt: null,
        lastErrorCode: null,
      },
    });
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
      where: { backgroundJobId: 'job-cdr' },
      data: { status: 'FAILED', lastErrorCode: 'CdrUploadError' },
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
    dbMock.backgroundJob.update.mockResolvedValue({});
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
    expect(dbMock.backgroundJob.update).not.toHaveBeenCalled();
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
