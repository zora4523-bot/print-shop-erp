import type { BackgroundJobQueue } from '../../generated/prisma/enums';
import { reconcileExpiredBackgroundJobLeases } from './lease-reaper';
import {
  claimNextBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  heartbeatBackgroundJob,
} from './repository';
import type {
  BackgroundJobResult,
  ClaimedBackgroundJob,
} from './types';

export type BackgroundJobHandler = (
  job: ClaimedBackgroundJob,
) => Promise<BackgroundJobResult>;

export type BackgroundJobHandlers = Readonly<
  Record<string, BackgroundJobHandler | undefined>
>;

export type BackgroundWorkerOptions = {
  queue: BackgroundJobQueue;
  workerId: string;
  handlers: BackgroundJobHandlers;
  concurrency?: number;
  pollIntervalMs?: number;
  leaseMs?: number;
  signal?: AbortSignal;
  onError?: (error: unknown, job?: ClaimedBackgroundJob) => void | Promise<void>;
};

export async function runBackgroundWorker(
  options: BackgroundWorkerOptions,
): Promise<void> {
  const concurrency = positiveInt(options.concurrency, 1);
  const leaseMs = positiveInt(options.leaseMs, 5 * 60_000);
  await Promise.all([
    // One queue-local reaper belongs to this worker process. It is deliberately
    // not multiplied by handler concurrency and never consumes a work lane.
    runLeaseReaper(options, leaseMs),
    ...Array.from({ length: concurrency }, (_, index) =>
      runLane(options, `${options.workerId}:${index + 1}`, leaseMs),
    ),
  ]);
}

async function runLane(
  options: BackgroundWorkerOptions,
  laneWorkerId: string,
  leaseMs: number,
): Promise<void> {
  const pollIntervalMs = positiveInt(options.pollIntervalMs, 1_000);

  while (!options.signal?.aborted) {
    let job: ClaimedBackgroundJob | null = null;
    try {
      job = await claimNextBackgroundJob({
        queue: options.queue,
        workerId: laneWorkerId,
        leaseMs,
      });
      if (!job) {
        await abortableDelay(pollIntervalMs, options.signal);
        continue;
      }

      const claimedJob = job;
      const leaseController = new AbortController();
      const runtimeJob: ClaimedBackgroundJob = {
        ...claimedJob,
        signal: leaseController.signal,
        assertLease: async () => {
          leaseController.signal.throwIfAborted();
          try {
            await heartbeatBackgroundJob(claimedJob);
            leaseController.signal.throwIfAborted();
          } catch (error) {
            abortLease(leaseController, error);
            throw error;
          }
        },
      };
      const heartbeat = startHeartbeat(
        claimedJob,
        leaseMs,
        leaseController,
        options.onError,
      );
      try {
        const handler = options.handlers[claimedJob.type];
        if (!handler) {
          throw new UnknownBackgroundJobTypeError(claimedJob.type);
        }

        const result = await handler(runtimeJob);
        await heartbeat.stop();
        // Close the race between the handler's last side effect and the final
        // state transition. This also prevents a heartbeat failure from being
        // reported as SUCCEEDED merely because the handler ignored its signal.
        await runtimeJob.assertLease?.();
        await completeBackgroundJob(claimedJob, result);
      } catch (error) {
        await heartbeat.stop();
        // Once the lease is lost, writing FAILED/PENDING with the stale token
        // is both guaranteed to fail and risks obscuring the original fencing
        // error. Leave the row RUNNING for the sweeper/new owner.
        if (!leaseController.signal.aborted) {
          await failBackgroundJob(claimedJob, error);
        }
        await options.onError?.(error, claimedJob);
      } finally {
        await heartbeat.stop();
      }
    } catch (error) {
      await options.onError?.(error, job ?? undefined);
      if (!options.signal?.aborted) {
        await abortableDelay(pollIntervalMs, options.signal);
      }
    }
  }
}

async function runLeaseReaper(
  options: BackgroundWorkerOptions,
  leaseMs: number,
): Promise<void> {
  const intervalMs = Math.max(
    1_000,
    Math.min(60_000, Math.floor(leaseMs / 3)),
  );

  while (!options.signal?.aborted) {
    try {
      await reconcileExpiredBackgroundJobLeases({
        queue: options.queue,
        leaseMs,
      });
    } catch (error) {
      try {
        await options.onError?.(error);
      } catch (reportError) {
        console.error(
          '[worker] lease reaper error reporter failed:',
          reportError instanceof Error ? reportError.name : 'UnknownError',
        );
      }
    }
    if (!options.signal?.aborted) {
      await abortableDelay(intervalMs, options.signal);
    }
  }
}

function startHeartbeat(
  job: ClaimedBackgroundJob,
  leaseMs: number,
  leaseController: AbortController,
  onError: BackgroundWorkerOptions['onError'],
): { stop: () => Promise<void> } {
  const intervalMs = Math.max(1_000, Math.floor(leaseMs / 3));
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (inFlight || stopped || leaseController.signal.aborted) return;
    const task = (async () => {
      try {
        await heartbeatBackgroundJob(job);
      } catch (error) {
        abortLease(leaseController, error);
        try {
          await onError?.(error, job);
        } catch (reportError) {
          console.error(
            '[worker] heartbeat error reporter failed:',
            reportError instanceof Error ? reportError.name : 'UnknownError',
          );
        }
      }
    })();
    inFlight = task;
    void task.finally(() => {
      if (inFlight === task) inFlight = null;
    });
  }, intervalMs);
  timer.unref();
  return {
    async stop() {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
      }
      await inFlight;
    },
  };
}

function abortLease(controller: AbortController, error: unknown): void {
  if (controller.signal.aborted) return;
  controller.abort(
    error instanceof Error ? error : new Error('background job lease lost'),
  );
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.floor(value);
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export class UnknownBackgroundJobTypeError extends Error {
  constructor(type: string) {
    super(`unknown background job type: ${type}`);
    this.name = 'UnknownBackgroundJobTypeError';
  }
}
