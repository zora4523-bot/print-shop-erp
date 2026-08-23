import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  claimNextBackgroundJobMock,
  completeBackgroundJobMock,
  failBackgroundJobMock,
  heartbeatBackgroundJobMock,
  reconcileExpiredBackgroundJobLeasesMock,
} = vi.hoisted(() => ({
  claimNextBackgroundJobMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  completeBackgroundJobMock: vi.fn<(...args: unknown[]) => Promise<void>>(),
  failBackgroundJobMock: vi.fn<(...args: unknown[]) => Promise<void>>(),
  heartbeatBackgroundJobMock: vi.fn<(...args: unknown[]) => Promise<void>>(),
  reconcileExpiredBackgroundJobLeasesMock: vi.fn<
    (...args: unknown[]) => Promise<number>
  >(),
}));

vi.mock('../repository', () => ({
  claimNextBackgroundJob: claimNextBackgroundJobMock,
  completeBackgroundJob: completeBackgroundJobMock,
  failBackgroundJob: failBackgroundJobMock,
  heartbeatBackgroundJob: heartbeatBackgroundJobMock,
}));
vi.mock('../lease-reaper', () => ({
  reconcileExpiredBackgroundJobLeases:
    reconcileExpiredBackgroundJobLeasesMock,
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
  reconcileExpiredBackgroundJobLeasesMock.mockReset().mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
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

    expect(completeBackgroundJobMock).toHaveBeenCalledWith(
      knownJob,
      { ok: true },
    );
    expect(failBackgroundJobMock).not.toHaveBeenCalled();
  });

  it('aborts the handler and never writes with a stale lease when heartbeat fencing fails', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const knownJob = { ...job, type: 'KNOWN', maxAttempts: 5 };
    const leaseError = Object.assign(new Error('lease stolen'), {
      name: 'BackgroundJobLeaseLostError',
    });
    claimNextBackgroundJobMock.mockResolvedValueOnce(knownJob);
    heartbeatBackgroundJobMock.mockRejectedValueOnce(leaseError);
    const handler = vi.fn(async (claimed: ClaimedBackgroundJob) => {
      await new Promise<void>((resolve) => {
        claimed.signal?.addEventListener('abort', () => resolve(), {
          once: true,
        });
      });
      expect(claimed.signal?.reason).toBe(leaseError);
      throw claimed.signal?.reason;
    });
    const onError = vi.fn(() => controller.abort());

    const running = runBackgroundWorker({
      queue: BackgroundJobQueue.LIGHT,
      workerId: 'worker-1',
      handlers: { KNOWN: handler },
      concurrency: 1,
      leaseMs: 3_000,
      signal: controller.signal,
      onError,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await running;

    expect(handler).toHaveBeenCalledTimes(1);
    expect(completeBackgroundJobMock).not.toHaveBeenCalled();
    expect(failBackgroundJobMock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(leaseError, knownJob);
  });

  it('runs one queue-local reaper per process instead of one per concurrency lane', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    claimNextBackgroundJobMock.mockResolvedValue(null);

    const running = runBackgroundWorker({
      queue: BackgroundJobQueue.LIGHT,
      workerId: 'worker-1',
      handlers: {},
      concurrency: 3,
      pollIntervalMs: 10_000,
      leaseMs: 3_000,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(claimNextBackgroundJobMock).toHaveBeenCalledTimes(3);
    expect(reconcileExpiredBackgroundJobLeasesMock).toHaveBeenCalledOnce();
    expect(reconcileExpiredBackgroundJobLeasesMock).toHaveBeenCalledWith({
      queue: BackgroundJobQueue.LIGHT,
      leaseMs: 3_000,
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(reconcileExpiredBackgroundJobLeasesMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(reconcileExpiredBackgroundJobLeasesMock).toHaveBeenCalledTimes(2);

    controller.abort();
    await running;
  });

  it('reports a reaper failure and keeps the independent loop alive', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reaperError = new Error('reaper failed');
    const onError = vi.fn();
    claimNextBackgroundJobMock.mockResolvedValue(null);
    reconcileExpiredBackgroundJobLeasesMock
      .mockRejectedValueOnce(reaperError)
      .mockImplementationOnce(async () => {
        controller.abort();
        return 0;
      });

    const running = runBackgroundWorker({
      queue: BackgroundJobQueue.HEAVY,
      workerId: 'worker-heavy',
      handlers: {},
      concurrency: 2,
      pollIntervalMs: 10_000,
      leaseMs: 3_000,
      signal: controller.signal,
      onError,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await running;

    expect(onError).toHaveBeenCalledWith(reaperError);
    expect(reconcileExpiredBackgroundJobLeasesMock).toHaveBeenCalledTimes(2);
  });
});
