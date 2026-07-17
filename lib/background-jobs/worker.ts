import type { BackgroundJobQueue } from '../../generated/prisma/enums';
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
  await Promise.all(
    Array.from({ length: concurrency }, (_, index) =>
      runLane(options, `${options.workerId}:${index + 1}`),
    ),
  );
}

async function runLane(
  options: BackgroundWorkerOptions,
  laneWorkerId: string,
): Promise<void> {
  const pollIntervalMs = positiveInt(options.pollIntervalMs, 1_000);
  const leaseMs = positiveInt(options.leaseMs, 5 * 60_000);

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

      const handler = options.handlers[job.type];
      if (!handler) throw new UnknownBackgroundJobTypeError(job.type);

      const heartbeat = startHeartbeat(job, leaseMs, options.onError);
      try {
        const result = await handler(job);
        await completeBackgroundJob(job, result);
      } catch (error) {
        await failBackgroundJob(job, error);
        await options.onError?.(error, job);
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      await options.onError?.(error, job ?? undefined);
      if (!options.signal?.aborted) {
        await abortableDelay(pollIntervalMs, options.signal);
      }
    }
  }
}

function startHeartbeat(
  job: ClaimedBackgroundJob,
  leaseMs: number,
  onError: BackgroundWorkerOptions['onError'],
): ReturnType<typeof setInterval> {
  const intervalMs = Math.max(1_000, Math.floor(leaseMs / 3));
  const timer = setInterval(() => {
    void heartbeatBackgroundJob(job).catch((error) => onError?.(error, job));
  }, intervalMs);
  timer.unref();
  return timer;
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
