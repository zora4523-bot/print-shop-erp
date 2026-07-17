import type { BackgroundJobQueue } from '../../generated/prisma/client';
import { db } from '../db';

export async function startWorkerHeartbeat(input: {
  workerId: string;
  queue: BackgroundJobQueue;
  version: string;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}): Promise<() => Promise<void>> {
  const startedAt = new Date();
  const beat = async () => {
    const now = new Date();
    await db.backgroundWorkerHeartbeat.upsert({
      where: { workerId: input.workerId },
      create: {
        workerId: input.workerId,
        queue: input.queue,
        version: input.version,
        startedAt,
        lastSeenAt: now,
      },
      update: {
        queue: input.queue,
        version: input.version,
        lastSeenAt: now,
      },
    });
  };

  await beat();
  await db.backgroundWorkerHeartbeat.deleteMany({
    where: {
      lastSeenAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000) },
    },
  });

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
