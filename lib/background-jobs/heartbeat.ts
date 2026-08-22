import type { BackgroundJobQueue } from '../../generated/prisma/enums';
import { db } from '../db';

export async function startWorkerHeartbeat(input: {
  workerId: string;
  queue: BackgroundJobQueue;
  version: string;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}): Promise<() => Promise<void>> {
  // lastSeenAt 由 web 进程（lib/background-jobs/health.ts）拿 45 秒窗口读回。
  // 用本 worker 的 Node 时钟盖戳，两台机器一漂就把活着的 worker 判成 missing。
  // clock_timestamp() 是这条语句的真实瞬间，「还活着」对每个读者含义相同。
  // 必须走 raw：类型化 upsert 只能送 JS Date。
  const beat = async () => {
    await db.$executeRaw`
      INSERT INTO "BackgroundWorkerHeartbeat"
             ("workerId", "queue", "version", "startedAt", "lastSeenAt")
      VALUES (
        ${input.workerId},
        ${input.queue}::"BackgroundJobQueue",
        ${input.version},
        clock_timestamp(),
        clock_timestamp()
      )
      ON CONFLICT ("workerId") DO UPDATE
         SET "queue" = EXCLUDED."queue",
             "version" = EXCLUDED."version",
             "lastSeenAt" = EXCLUDED."lastSeenAt"
    `;
  };

  await beat();
  await db.$executeRaw`
    DELETE FROM "BackgroundWorkerHeartbeat"
     WHERE "lastSeenAt" < clock_timestamp() - interval '7 days'
  `;

  const intervalMs = Math.max(5_000, input.intervalMs ?? 15_000);
  const timer = setInterval(() => {
    void beat().catch((error) => input.onError?.(error));
  }, intervalMs);
  timer.unref();

  return async () => {
    clearInterval(timer);
    await db.backgroundWorkerHeartbeat
      .delete({ where: { workerId: input.workerId } })
      .catch((error) => input.onError?.(error));
  };
}
