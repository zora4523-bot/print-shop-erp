import type { BackgroundJobQueue } from '../../generated/prisma/enums';
import { normalizeWorkerHeartbeatIntervalMs } from './heartbeat-policy';
import { db } from '../db';

export type WorkerSmartBotConnectionStatus =
  | 'NOT_CONFIGURED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'AUTH_FAILED'
  | 'CONNECTION_CONFLICT';

export async function startWorkerHeartbeat(input: {
  workerId: string;
  queue: BackgroundJobQueue;
  version: string;
  intervalMs?: number;
  pdfReady?: () => boolean;
  smartBotStatus?: () => WorkerSmartBotConnectionStatus | null;
  smartBotBotDigest?: () => string | null;
  onError?: (error: unknown) => void;
}): Promise<() => Promise<void>> {
  // lastSeenAt 由 web 进程（lib/background-jobs/health.ts）按共享策略窗口读回。
  // 用本 worker 的 Node 时钟盖戳，两台机器一漂就把活着的 worker 判成 missing。
  // clock_timestamp() 是这条语句的真实瞬间，「还活着」对每个读者含义相同。
  // 必须走 raw：类型化 upsert 只能送 JS Date。
  const beat = async () => {
    // Read immediately before every statement: the connector can transition
    // independently between beats. Workers without a connector (including
    // the HEAVY worker) deliberately publish NULL.
    const pdfReady = input.pdfReady?.() ?? null;
    const smartBotStatus = input.smartBotStatus?.() ?? null;
    const smartBotBotDigest = input.smartBotBotDigest?.() ?? null;
    await db.$executeRaw`
      INSERT INTO "BackgroundWorkerHeartbeat"
             ("workerId", "queue", "version", "smartBotStatus", "smartBotBotDigest", "pdfReady", "startedAt", "lastSeenAt")
      VALUES (
        ${input.workerId},
        ${input.queue}::"BackgroundJobQueue",
        ${input.version},
        ${smartBotStatus}::"SmartBotConnectionStatus",
        ${smartBotBotDigest},
        ${pdfReady},
        clock_timestamp(),
        clock_timestamp()
      )
      ON CONFLICT ("workerId") DO UPDATE
         SET "queue" = EXCLUDED."queue",
             "version" = EXCLUDED."version",
             "smartBotStatus" = EXCLUDED."smartBotStatus",
             "smartBotBotDigest" = EXCLUDED."smartBotBotDigest",
             "pdfReady" = EXCLUDED."pdfReady",
             "lastSeenAt" = EXCLUDED."lastSeenAt"
    `;
  };

  await beat();
  await db.$executeRaw`
    DELETE FROM "BackgroundWorkerHeartbeat"
     WHERE "lastSeenAt" < clock_timestamp() - interval '7 days'
  `;

  const intervalMs = normalizeWorkerHeartbeatIntervalMs(input.intervalMs);
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    const task = beat()
      .catch((error) => {
        try {
          input.onError?.(error);
        } catch (reportError) {
          console.error(
            '[worker] heartbeat error reporter failed:',
            reportError instanceof Error ? reportError.name : 'UnknownError',
          );
        }
      })
      .finally(() => {
        if (inFlight === task) inFlight = null;
      });
    inFlight = task;
  }, intervalMs);
  timer.unref();

  let stopPromise: Promise<void> | null = null;
  return () => {
    stopPromise ??= (async () => {
      stopped = true;
      clearInterval(timer);
      // A timer callback may already be inside its UPSERT. Deleting first would
      // let that older write recreate this worker's row after shutdown. Drain
      // the single tracked heartbeat before removing the durable liveness row.
      await inFlight;
      await db.backgroundWorkerHeartbeat
        .delete({ where: { workerId: input.workerId } })
        .catch((error) => input.onError?.(error));
    })();
    return stopPromise;
  };
}
