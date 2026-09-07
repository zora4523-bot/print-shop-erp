import {
  BackgroundJobQueue,
  SmartBotConnectionStatus,
} from '../../generated/prisma/enums';
import { db } from '../db';
import { databaseNow } from './clock';
import { WORKER_HEARTBEAT_ACTIVE_WINDOW_MS } from './heartbeat-policy';

/**
 * Binding and real test sends are useful only while exactly one current
 * LIGHT worker owns an authenticated connector. Counting every active LIGHT
 * worker also prevents a second, stale-version worker from being hidden by a
 * healthy current-version heartbeat.
 */
export async function hasExclusiveConnectedSmartBotWorker(
  expectedBotDigest: string | null,
  options: { expectedVersion?: string } = {},
): Promise<boolean> {
  if (!expectedBotDigest) return false;
  const expectedVersion =
    options.expectedVersion ?? (process.env.APP_VERSION || 'dev');

  return db.$transaction(async (tx) => {
    const observedAt = await databaseNow(tx);
    const cutoff = new Date(
      observedAt.getTime() - WORKER_HEARTBEAT_ACTIVE_WINDOW_MS,
    );
    const workers = await tx.backgroundWorkerHeartbeat.findMany({
      where: {
        queue: BackgroundJobQueue.LIGHT,
        lastSeenAt: { gte: cutoff },
      },
      select: {
        version: true,
        smartBotStatus: true,
        smartBotBotDigest: true,
      },
      take: 2,
    });

    return (
      workers.length === 1 &&
      workers[0]?.version === expectedVersion &&
      workers[0].smartBotStatus === SmartBotConnectionStatus.CONNECTED &&
      workers[0].smartBotBotDigest === expectedBotDigest
    );
  });
}
