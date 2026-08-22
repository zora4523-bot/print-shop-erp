import { hostname } from 'node:os';
import * as Sentry from '@sentry/nextjs';
import { BackgroundJobQueue } from '../generated/prisma/client';
import { backgroundJobHandlers } from '../lib/background-jobs/handlers';
import { backgroundJobErrorCode } from '../lib/background-jobs/policy';
import { startWorkerHeartbeat } from '../lib/background-jobs/heartbeat';
import { runBackgroundWorker } from '../lib/background-jobs/worker';
import { db } from '../lib/db';

export async function runBackgroundWorkerProcess(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(`[worker] fatal: ${backgroundJobErrorCode(error)}`);
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(new Error(backgroundJobErrorCode(error)));
      await Sentry.flush(2_000);
    }
    await db.$disconnect().catch(() => undefined);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const queue = parseQueue(
    process.env.BACKGROUND_JOB_QUEUE ??
      process.argv.find((arg) => arg.startsWith('--queue='))?.slice(8),
  );
  const workerId = `${hostname()}:${process.pid}:${queue.toLowerCase()}`;
  const controller = new AbortController();

  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      release: process.env.APP_VERSION || 'dev',
      environment: process.env.NODE_ENV || 'development',
      sendDefaultPii: false,
      tracesSampleRate: 0.05,
    });
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      console.info(`[worker] ${signal} received; draining ${queue} queue`);
      controller.abort();
    });
  }

  console.info(`[worker] starting ${workerId}`);
  const stopHeartbeat = await startWorkerHeartbeat({
    workerId,
    queue,
    version: process.env.APP_VERSION || 'dev',
    intervalMs: intEnv('WORKER_HEARTBEAT_MS', 15_000, 5_000, 60_000),
    onError(error) {
      console.error(
        `[worker] heartbeat failed: ${backgroundJobErrorCode(error)}`,
      );
    },
  });

  try {
    await runBackgroundWorker({
      queue,
      workerId,
      handlers: backgroundJobHandlers,
      concurrency: intEnv(
        queue === BackgroundJobQueue.HEAVY
          ? 'HEAVY_WORKER_CONCURRENCY'
          : 'LIGHT_WORKER_CONCURRENCY',
        queue === BackgroundJobQueue.HEAVY ? 1 : 2,
        1,
        8,
      ),
      pollIntervalMs: intEnv('BACKGROUND_JOB_POLL_MS', 1_000, 100, 60_000),
      leaseMs: intEnv(
        'BACKGROUND_JOB_LEASE_MS',
        5 * 60_000,
        30_000,
        60 * 60_000,
      ),
      signal: controller.signal,
      onError(error, job) {
        const code = backgroundJobErrorCode(error);
        console.error(
          `[worker] ${queue} ${job?.type ?? 'poll'} failed: ${code}`,
        );
        if (process.env.SENTRY_DSN) {
          Sentry.captureException(new Error(code), {
            tags: {
              component: 'background-worker',
              queue,
              jobType: job?.type ?? 'poll',
            },
            extra: job
              ? {
                  jobId: job.id,
                  attempt: job.attempts,
                  maxAttempts: job.maxAttempts,
                }
              : undefined,
          });
        }
      },
    });
  } finally {
    await stopHeartbeat();
    await db.$disconnect();
    if (process.env.SENTRY_DSN) await Sentry.flush(2_000);
    console.info(`[worker] stopped ${workerId}`);
  }
}

function parseQueue(value: string | undefined): BackgroundJobQueue {
  const normalized = value?.trim().toUpperCase();
  if (normalized === BackgroundJobQueue.LIGHT) return BackgroundJobQueue.LIGHT;
  if (normalized === BackgroundJobQueue.HEAVY) return BackgroundJobQueue.HEAVY;
  throw new Error('BACKGROUND_JOB_QUEUE must be LIGHT or HEAVY');
}

function intEnv(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number.parseInt(process.env[key] ?? '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
