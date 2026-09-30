import { startPdfCapabilityMonitor, PDF_JOB_TYPES, isPdfInfrastructureFailure } from '../lib/pdf/capability';
import { pdfFailure } from '../lib/pdf/status-response';
import { logPdfFailure } from '../lib/pdf/diagnostics';
import { hostname } from 'node:os';
import * as Sentry from '@sentry/nextjs';
import { BackgroundJobQueue } from '../generated/prisma/client';
import { backgroundJobErrorCode } from '../lib/background-jobs/policy';
import {
  startWorkerHeartbeat,
  type WorkerSmartBotConnectionStatus,
} from '../lib/background-jobs/heartbeat';
import {
  WORKER_HEARTBEAT_DEFAULT_INTERVAL_MS,
  WORKER_HEARTBEAT_MAX_INTERVAL_MS,
  WORKER_HEARTBEAT_MIN_INTERVAL_MS,
} from '../lib/background-jobs/heartbeat-policy';
import {
  runBackgroundWorker,
  type BackgroundJobHandlers,
} from '../lib/background-jobs/worker';
import { db } from '../lib/db';
import { databasePoolConfig, assertWorkerPoolCapacity } from '../lib/database-session';
import { SENTRY_SCRUB_HOOKS } from '../lib/observability/sentry-scrub';

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
  const concurrency = intEnv(queue === BackgroundJobQueue.HEAVY ? 'HEAVY_WORKER_CONCURRENCY' : 'LIGHT_WORKER_CONCURRENCY', queue === BackgroundJobQueue.HEAVY ? 1 : 2, 1, 8);
  assertWorkerPoolCapacity(databasePoolConfig(process.env.DATABASE_URL!, { role: 'worker' }).max!, concurrency);
  if (queue === BackgroundJobQueue.HEAVY) {
    if (process.env.PDF_BROWSER_REUSE !== '0') {
      const { enableWorkerPdfBrowserReuse } = await import('../lib/pdf/render');
      enableWorkerPdfBrowserReuse();
    }
  }
  const handlers = await loadBackgroundJobHandlers(queue);
  const smartBotConnector =
    queue === BackgroundJobQueue.LIGHT
      ? await import('../lib/notification/smart-bot')
      : null;
  const smartBotBotDigest =
    smartBotConnector?.configuredSmartBotIdDigest(process.env) ?? null;
  const workerId = `${hostname()}:${process.pid}:${queue.toLowerCase()}`;
  const controller = new AbortController();
  let smartBotStatus: WorkerSmartBotConnectionStatus | null =
    queue === BackgroundJobQueue.LIGHT
      ? initialSmartBotConnectionStatus(process.env)
      : null;
  let shutdownRequested = false;
  let releaseShutdownWait: (() => void) | undefined;
  const shutdownWait = new Promise<void>((resolve) => {
    releaseShutdownWait = resolve;
  });

  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      release: process.env.APP_VERSION || 'dev',
      environment: process.env.NODE_ENV || 'development',
      sendDefaultPii: false,
      tracesSampleRate: 0.05,
      // Same scrubbers as the Web runtime: outgoing fetch breadcrumbs and
      // sampled client spans carry full URLs (legacy webhook ?key=…).
      ...SENTRY_SCRUB_HOOKS,
    });
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      shutdownRequested = true;
      releaseShutdownWait?.();
      console.info(`[worker] ${signal} received; draining ${queue} queue`);
      controller.abort();
    });
  }

  console.info(`[worker] starting ${workerId}`);
  let stopHeartbeat: () => Promise<void> = async () => undefined;
  let stopSmartBotConnector: () => Promise<void> = async () => undefined;
  let smartBotOwnershipLost = false;
  const pdfCapability = queue === BackgroundJobQueue.HEAVY
    ? startPdfCapabilityMonitor(async () => {
        const { checkPdfRuntime } = await import('../lib/pdf/preflight');
        await checkPdfRuntime({ reuseWorker: process.env.PDF_BROWSER_REUSE !== '0' });
      }) : null;

  try {
    stopHeartbeat = await startWorkerHeartbeat({
      workerId,
      queue,
      version: process.env.APP_VERSION || 'dev',
      ...(pdfCapability ? { pdfReady: pdfCapability.ready } : {}),
      intervalMs: intEnv(
        'WORKER_HEARTBEAT_MS',
        WORKER_HEARTBEAT_DEFAULT_INTERVAL_MS,
        WORKER_HEARTBEAT_MIN_INTERVAL_MS,
        WORKER_HEARTBEAT_MAX_INTERVAL_MS,
      ),
      ...(queue === BackgroundJobQueue.LIGHT
        ? {
            smartBotStatus: () => smartBotStatus,
            smartBotBotDigest: () => smartBotBotDigest,
          }
        : {}),
      onError(error) {
        console.error(
          `[worker] heartbeat failed: ${backgroundJobErrorCode(error)}`,
        );
      },
    });
    if (queue === BackgroundJobQueue.LIGHT) {
      // The smart-bot SDK permits one effective long connection per Bot ID.
      // Keep it out of Web and HEAVY processes; the deployment runs exactly
      // one LIGHT worker, which owns connection start through final drain.
      const connector = smartBotConnector;
      if (!connector) throw new Error('smart bot connector unavailable');
      connector.startWecomSmartBotConnector(process.env, {
        onStatusChange(status) {
          smartBotStatus = status;
        },
        onFatal(error) {
          if (
            error.kind ===
            connector.SmartBotConnectorFatalKind.AUTHENTICATION_FAILED
          ) {
            // A bad/expired optional Bot Secret must not stop webhook
            // notifications, payroll, settlement, cron, or cleanup handlers
            // that share the LIGHT queue. The persisted AUTH_FAILED state is
            // actionable; smart-bot deliveries remain safely retryable.
            console.error('[worker] smart bot authentication unavailable');
            return;
          }
          if (smartBotOwnershipLost) return;
          smartBotOwnershipLost = true;
          console.error('[worker] smart bot connection ownership lost');
          // Finish already claimed work, but never let this displaced worker
          // take another job from the shared queue.
          controller.abort(error);
        },
      });
      stopSmartBotConnector = connector.stopWecomSmartBotConnector;
    }
    await runBackgroundWorker({
      queue,
      workerId,
      handlers,
      ...(pdfCapability ? { excludedTypes: () => pdfCapability.ready() ? [] : PDF_JOB_TYPES } : {}),
      concurrency,
      pollIntervalMs: intEnv('BACKGROUND_JOB_POLL_MS', 1_000, 100, 60_000),
      leaseMs: intEnv(
        'BACKGROUND_JOB_LEASE_MS',
        5 * 60_000,
        30_000,
        60 * 60_000,
      ),
      signal: controller.signal,
      onError(error, job) {
        if (job && PDF_JOB_TYPES.some((type) => type === job.type)) {
          logPdfFailure(error, { mode: 'queued', stage: 'render', started: performance.now() - Math.max(0, Date.now() - job.claimedAt.getTime()) });
          if (isPdfInfrastructureFailure(error)) pdfCapability?.invalidate();
        }
        const code = job && PDF_JOB_TYPES.some((type) => type === job.type)
          ? pdfFailure(error instanceof Error ? error.name : null).code : backgroundJobErrorCode(error);
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
    if (smartBotOwnershipLost && !shutdownRequested) {
      // Stay fail-stopped instead of exiting into a process-manager restart
      // loop that would repeatedly kick the healthy Bot connection. Removing
      // this worker's heartbeat makes the missing-owner state observable when
      // there is no legitimate replacement.
      await stopHeartbeat();
      stopHeartbeat = async () => undefined;
      console.error(
        '[worker] smart bot connection ownership lost; waiting for operator shutdown',
      );
      // Awaiting an unresolved Promise does not keep Node's event loop alive.
      // Keep one referenced timer so PM2 cannot observe a clean natural exit
      // and autorestart this displaced process into a connection-kick loop.
      const failStopKeepAlive = setInterval(() => undefined, 60_000);
      failStopKeepAlive.ref();
      try {
        await shutdownWait;
      } finally {
        clearInterval(failStopKeepAlive);
      }
    }
  } finally {
    await pdfCapability?.stop();
    await stopHeartbeat();
    await stopSmartBotConnector();
    if (queue === BackgroundJobQueue.HEAVY) {
      const { closeWorkerPdfBrowser } = await import('../lib/pdf/render');
      await closeWorkerPdfBrowser();
    }
    await db.$disconnect();
    if (process.env.SENTRY_DSN) await Sentry.flush(2_000);
    console.info(`[worker] stopped ${workerId}`);
  }
}

function initialSmartBotConnectionStatus(
  env: NodeJS.ProcessEnv,
): WorkerSmartBotConnectionStatus {
  const hasBotId = Boolean(env.WECOM_SMART_BOT_ID?.trim());
  const hasSecret = Boolean(env.WECOM_SMART_BOT_SECRET?.trim());
  if (!hasBotId && !hasSecret) return 'NOT_CONFIGURED';
  if (!hasBotId || !hasSecret) return 'AUTH_FAILED';
  const mockMode =
    env.NOTIFICATION_MOCK_MODE === 'true' ||
    (env.NOTIFICATION_MOCK_MODE !== 'false' && env.NODE_ENV !== 'production');
  return mockMode ? 'DISCONNECTED' : 'CONNECTING';
}

async function loadBackgroundJobHandlers(
  queue: BackgroundJobQueue,
): Promise<BackgroundJobHandlers> {
  if (queue === BackgroundJobQueue.LIGHT) {
    const { lightBackgroundJobHandlers } = await import(
      '../lib/background-jobs/handlers-light'
    );
    return lightBackgroundJobHandlers;
  }
  const { heavyBackgroundJobHandlers } = await import(
    '../lib/background-jobs/handlers-heavy'
  );
  return heavyBackgroundJobHandlers;
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
