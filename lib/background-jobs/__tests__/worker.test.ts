import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  claimNextBackgroundJobMock,
  completeBackgroundJobMock,
  failBackgroundJobMock,
  heartbeatBackgroundJobMock,
} = vi.hoisted(() => ({
  claimNextBackgroundJobMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  completeBackgroundJobMock: vi.fn<(...args: unknown[]) => Promise<void>>(),
  failBackgroundJobMock: vi.fn<(...args: unknown[]) => Promise<void>>(),
  heartbeatBackgroundJobMock: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

vi.mock('../repository', () => ({
  claimNextBackgroundJob: claimNextBackgroundJobMock,
  completeBackgroundJob: completeBackgroundJobMock,
  failBackgroundJob: failBackgroundJobMock,
  heartbeatBackgroundJob: heartbeatBackgroundJobMock,
}));

import { BackgroundJobQueue } from '../../../generated/prisma/enums';
import {
  runBackgroundWorker,
  UnknownBackgroundJobTypeError,
} from '../worker';
import type { ClaimedBackgroundJob } from '../types';

const job: ClaimedBackgroundJob = {
  id: 'job-1',
  type: 'UNKNOWN_JOB_TYPE',
  queue: BackgroundJobQueue.LIGHT,
  dedupeKey: 'unknown:1',
  payload: {},
  attempts: 1,
  maxAttempts: 1,
  workerId: 'worker-1:1',
  claimedAt: new Date('2026-07-17T08:00:00Z'),
};

beforeEach(() => {
  claimNextBackgroundJobMock.mockReset();
  completeBackgroundJobMock.mockReset().mockResolvedValue(undefined);
  failBackgroundJobMock.mockReset().mockResolvedValue(undefined);
  heartbeatBackgroundJobMock.mockReset().mockResolvedValue(undefined);
});

describe('runBackgroundWorker', () => {
  it('routes an unknown claimed type through failBackgroundJob', async () => {
    const controller = new AbortController();
    const onError = vi.fn();
    claimNextBackgroundJobMock.mockResolvedValueOnce(job);
    failBackgroundJobMock.mockImplementationOnce(async () => {
      controller.abort();
    });

    await runBackgroundWorker({
      queue: BackgroundJobQueue.LIGHT,
      workerId: 'worker-1',
      handlers: {},
      concurrency: 1,
      leaseMs: 3_000,
      signal: controller.signal,
      onError,
    });

    expect(failBackgroundJobMock).toHaveBeenCalledWith(
      job,
      expect.any(UnknownBackgroundJobTypeError),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.any(UnknownBackgroundJobTypeError),
      job,
    );
    expect(completeBackgroundJobMock).not.toHaveBeenCalled();
  });

  it('completes a registered handler result', async () => {
    const controller = new AbortController();
    const knownJob = { ...job, type: 'KNOWN' };
    claimNextBackgroundJobMock.mockResolvedValueOnce(knownJob);
    const handler = vi.fn(async () => {
      controller.abort();
      return { ok: true };
    });

    await runBackgroundWorker({
      queue: BackgroundJobQueue.LIGHT,
      workerId: 'worker-1',
      handlers: { KNOWN: handler },
      concurrency: 1,
      leaseMs: 3_000,
      signal: controller.signal,
    });

    expect(completeBackgroundJobMock).toHaveBeenCalledWith(knownJob, {
      ok: true,
    });
    expect(failBackgroundJobMock).not.toHaveBeenCalled();
  });
});
