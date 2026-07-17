import {
  BackgroundJobQueue,
  BackgroundJobStatus,
} from '../../generated/prisma/client';
import { db } from '../db';

export type BackgroundJobHealth = {
  activeWorkers: Array<{
    queue: BackgroundJobQueue;
    version: string;
    lastSeenAt: Date;
  }>;
  pending: Record<BackgroundJobQueue, number>;
  oldestPendingAt: Record<BackgroundJobQueue, Date | null>;
  running: number;
  staleRunning: number;
  deadLast24h: number;
};

export async function getBackgroundJobHealth(
  now = new Date(),
): Promise<BackgroundJobHealth> {
  const workerCutoff = new Date(now.getTime() - 45_000);
  const staleCutoff = new Date(now.getTime() - 6 * 60_000);
  const dayCutoff = new Date(now.getTime() - 24 * 60 * 60_000);

  const [
    workers,
    lightPending,
    heavyPending,
    lightOldest,
    heavyOldest,
    running,
    staleRunning,
    deadLast24h,
  ] = await Promise.all([
    db.backgroundWorkerHeartbeat.findMany({
      where: { lastSeenAt: { gte: workerCutoff } },
      select: { queue: true, version: true, lastSeenAt: true },
      orderBy: { lastSeenAt: 'desc' },
    }),
    db.backgroundJob.count({
      where: { queue: BackgroundJobQueue.LIGHT, status: BackgroundJobStatus.PENDING },
    }),
    db.backgroundJob.count({
      where: { queue: BackgroundJobQueue.HEAVY, status: BackgroundJobStatus.PENDING },
    }),
    db.backgroundJob.findFirst({
      where: { queue: BackgroundJobQueue.LIGHT, status: BackgroundJobStatus.PENDING },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.backgroundJob.findFirst({
      where: { queue: BackgroundJobQueue.HEAVY, status: BackgroundJobStatus.PENDING },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.backgroundJob.count({ where: { status: BackgroundJobStatus.RUNNING } }),
    db.backgroundJob.count({
      where: {
        status: BackgroundJobStatus.RUNNING,
        OR: [
          { heartbeatAt: { lt: staleCutoff } },
          { heartbeatAt: null, lockedAt: { lt: staleCutoff } },
        ],
      },
    }),
    db.backgroundJob.count({
      where: { status: BackgroundJobStatus.DEAD, finishedAt: { gte: dayCutoff } },
    }),
  ]);

  return {
    activeWorkers: workers,
    pending: {
      [BackgroundJobQueue.LIGHT]: lightPending,
      [BackgroundJobQueue.HEAVY]: heavyPending,
    },
    oldestPendingAt: {
      [BackgroundJobQueue.LIGHT]: lightOldest?.createdAt ?? null,
      [BackgroundJobQueue.HEAVY]: heavyOldest?.createdAt ?? null,
    },
    running,
    staleRunning,
    deadLast24h,
  };
}

export function assessBackgroundJobHealth(
  health: BackgroundJobHealth,
  options: { requireWorkers: boolean; expectedVersion?: string; now?: Date },
): { available: boolean; status: 'ok' | 'degraded' | 'error'; warnings: string[] } {
  const warnings: string[] = [];
  if (options.requireWorkers) {
    for (const queue of [BackgroundJobQueue.LIGHT, BackgroundJobQueue.HEAVY]) {
      const workers = health.activeWorkers.filter((worker) => worker.queue === queue);
      if (workers.length === 0) {
        warnings.push(`${queue.toLowerCase()}-worker-missing`);
      } else if (
        options.expectedVersion &&
        !workers.some((worker) => worker.version === options.expectedVersion)
      ) {
        warnings.push(`${queue.toLowerCase()}-worker-version-mismatch`);
      }
    }
  }
  if (health.staleRunning > 0) warnings.push('stale-running-jobs');
  if (health.deadLast24h > 0) warnings.push('dead-jobs-last-24h');

  const now = options.now ?? new Date();
  const lightAge = ageMs(health.oldestPendingAt.LIGHT, now);
  const heavyAge = ageMs(health.oldestPendingAt.HEAVY, now);
  if (lightAge !== null && lightAge > 5 * 60_000) warnings.push('light-backlog-old');
  if (heavyAge !== null && heavyAge > 15 * 60_000) warnings.push('heavy-backlog-old');

  const available = !warnings.some(
    (warning) =>
      warning.endsWith('worker-missing') ||
      warning.endsWith('worker-version-mismatch'),
  );
  return {
    available,
    status: !available ? 'error' : warnings.length ? 'degraded' : 'ok',
    warnings,
  };
}

function ageMs(date: Date | null, now: Date): number | null {
  return date ? Math.max(0, now.getTime() - date.getTime()) : null;
}
