import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueBackgroundJobMock, runOrderExportCleanupTaskMock } = vi.hoisted(
  () => ({
    enqueueBackgroundJobMock: vi.fn(),
    runOrderExportCleanupTaskMock: vi.fn(),
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
