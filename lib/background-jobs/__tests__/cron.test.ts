import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  enqueueBackgroundJobMock,
  runOrderExportCleanupTaskMock,
  runPendingFactoryBacklogTaskMock,
  runProductionAlertNotificationTaskMock,
} = vi.hoisted(
  () => ({
    enqueueBackgroundJobMock: vi.fn(),
    runOrderExportCleanupTaskMock: vi.fn(),
    runPendingFactoryBacklogTaskMock: vi.fn(),
    runProductionAlertNotificationTaskMock: vi.fn(),
  }),
);

vi.mock('../repository', () => ({
  enqueueBackgroundJob: enqueueBackgroundJobMock,
}));
vi.mock('@/lib/cron/tasks', () => ({
  runCsPeriodEndingTask: vi.fn(),
  runCsSettleTask: vi.fn(),
  runDailySalaryTask: vi.fn(),
  runGenerateBillsTask: vi.fn(),
  runHourlyPayrollTask: vi.fn(),
  runOrderExportCleanupTask: runOrderExportCleanupTaskMock,
  runOrderOverdueTask: vi.fn(),
  runOutsourceOverdueTask: vi.fn(),
}));
vi.mock('@/lib/cron/pending-factory-backlog', () => ({
  runPendingFactoryBacklogTask: runPendingFactoryBacklogTaskMock,
}));
vi.mock('@/lib/notification/production-alerts', () => ({
  runProductionAlertNotificationTask: runProductionAlertNotificationTaskMock,
}));

import { BackgroundJobQueue } from '../../../generated/prisma/enums';
import {
  enqueueCronJob,
  handleCronJob,
  InvalidCronJobPayloadError,
} from '../cron';
import { BACKGROUND_JOB_TYPES, type ClaimedBackgroundJob } from '../types';

beforeEach(() => {
  enqueueBackgroundJobMock.mockReset().mockResolvedValue({
    job: { id: 'job-cleanup-1' },
    created: true,
    requeued: false,
  });
  runOrderExportCleanupTaskMock.mockReset().mockResolvedValue({
    status: 'ok',
    runDate: '2026-08-07',
    expiredCount: 3,
    scrubbedFilterCount: 2,
  });
  runPendingFactoryBacklogTaskMock.mockReset().mockResolvedValue({
    status: 'ok',
    runDate: '2026-08-07',
    enabled: true,
    pendingCount: 7,
    notified: true,
  });
  runProductionAlertNotificationTaskMock.mockReset().mockResolvedValue({
    status: 'ok',
    runDate: '2026-08-07',
    anomalyCount: 1,
    stagnationCount: 2,
  });
});

function cleanupJob(payload: ClaimedBackgroundJob['payload']) {
  return {
    id: 'job-cleanup-1',
    type: BACKGROUND_JOB_TYPES.CRON_ORDER_EXPORT_CLEANUP,
    queue: BackgroundJobQueue.LIGHT,
    dedupeKey: 'cron:CRON_ORDER_EXPORT_CLEANUP:2026-08-07',
    payload,
    attempts: 1,
    maxAttempts: 4,
    workerId: 'light-worker:1',
    claimedAt: new Date('2026-08-07T09:00:00.000Z'),
  } satisfies ClaimedBackgroundJob;
}

describe('order export cleanup cron job', () => {
  it('enqueues once per Shanghai calendar day on the LIGHT queue', async () => {
    await expect(
      enqueueCronJob({
        type: BACKGROUND_JOB_TYPES.CRON_ORDER_EXPORT_CLEANUP,
        scope: '2026-08-07',
        payload: { runDate: '2026-08-07' },
      }),
    ).resolves.toEqual({
      jobId: 'job-cleanup-1',
      created: true,
      requeued: false,
    });

    expect(enqueueBackgroundJobMock).toHaveBeenCalledExactlyOnceWith({
      type: BACKGROUND_JOB_TYPES.CRON_ORDER_EXPORT_CLEANUP,
      queue: BackgroundJobQueue.LIGHT,
      dedupeKey: 'cron:CRON_ORDER_EXPORT_CLEANUP:2026-08-07',
      payload: { runDate: '2026-08-07' },
      priority: 150,
      maxAttempts: 4,
    });
  });

  it('runs the bounded cleanup and returns counts only', async () => {
    await expect(
      handleCronJob(cleanupJob({ runDate: '2026-08-07' })),
    ).resolves.toEqual({
      status: 'ok',
      runDate: '2026-08-07',
      expiredCount: 3,
      scrubbedFilterCount: 2,
    });
    expect(runOrderExportCleanupTaskMock).toHaveBeenCalledExactlyOnceWith(
      '2026-08-07',
      {},
    );
  });

  it.each([{}, { runDate: '' }, { runDate: 20260807 }])(
    'rejects an invalid cleanup payload: %j',
    async (payload) => {
      await expect(handleCronJob(cleanupJob(payload))).rejects.toBeInstanceOf(
        InvalidCronJobPayloadError,
      );
      expect(runOrderExportCleanupTaskMock).not.toHaveBeenCalled();
    },
  );

  it('rejects a non-cron job type before enqueueing', async () => {
    await expect(
      enqueueCronJob({
        type: BACKGROUND_JOB_TYPES.ORDER_EXPORT,
        scope: '2026-08-07',
      }),
    ).rejects.toBeInstanceOf(InvalidCronJobPayloadError);
    expect(enqueueBackgroundJobMock).not.toHaveBeenCalled();
  });
});

describe('pending factory backlog cron job', () => {
  it('accepts the protected daily cron type and invokes the task through the worker', async () => {
    await expect(
      enqueueCronJob({
        type: BACKGROUND_JOB_TYPES.CRON_PENDING_FACTORY_BACKLOG,
        scope: '2026-08-07',
        payload: { runDate: '2026-08-07' },
      }),
    ).resolves.toMatchObject({ jobId: 'job-cleanup-1', created: true });

    const job = {
      ...cleanupJob({ runDate: '2026-08-07' }),
      type: BACKGROUND_JOB_TYPES.CRON_PENDING_FACTORY_BACKLOG,
      dedupeKey: 'cron:CRON_PENDING_FACTORY_BACKLOG:2026-08-07',
    } satisfies ClaimedBackgroundJob;
    await handleCronJob(job);

    expect(runPendingFactoryBacklogTaskMock).toHaveBeenCalledExactlyOnceWith(
      '2026-08-07',
      {},
    );
  });
});

describe('production alert cron job', () => {
  it('每个扫描时间桶入队一个 durable LIGHT 任务并使用默认真实事实源', async () => {
    await expect(
      enqueueCronJob({
        type: BACKGROUND_JOB_TYPES.CRON_PRODUCTION_ALERTS,
        scope: '2026-08-07T09:00Z',
        payload: { runDate: '2026-08-07' },
      }),
    ).resolves.toMatchObject({ jobId: 'job-cleanup-1', created: true });

    const job = {
      ...cleanupJob({ runDate: '2026-08-07' }),
      type: BACKGROUND_JOB_TYPES.CRON_PRODUCTION_ALERTS,
      dedupeKey: 'cron:CRON_PRODUCTION_ALERTS:2026-08-07',
    } satisfies ClaimedBackgroundJob;
    await handleCronJob(job);

    expect(runProductionAlertNotificationTaskMock).toHaveBeenCalledExactlyOnceWith(
      '2026-08-07',
      undefined,
      {},
    );
  });
});
