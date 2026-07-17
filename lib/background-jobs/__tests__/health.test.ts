import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));
import { BackgroundJobQueue } from '../../../generated/prisma/enums';
import {
  assessBackgroundJobHealth,
  type BackgroundJobHealth,
} from '../health';

const now = new Date('2026-07-17T08:00:00.000Z');

function fixture(): BackgroundJobHealth {
  return {
    activeWorkers: [
      { queue: BackgroundJobQueue.LIGHT, version: 'v1', lastSeenAt: now },
      { queue: BackgroundJobQueue.HEAVY, version: 'v1', lastSeenAt: now },
    ],
    pending: { LIGHT: 0, HEAVY: 0 },
    oldestPendingAt: { LIGHT: null, HEAVY: null },
    running: 0,
    staleRunning: 0,
    deadLast24h: 0,
  };
}

describe('assessBackgroundJobHealth', () => {
  it('two fresh worker queues are ready', () => {
    expect(assessBackgroundJobHealth(fixture(), { requireWorkers: true, now })).toEqual({
      available: true,
      status: 'ok',
      warnings: [],
    });
  });

  it('missing heavy worker makes durable mode unavailable', () => {
    const health = fixture();
    health.activeWorkers = health.activeWorkers.filter(
      (worker) => worker.queue !== BackgroundJobQueue.HEAVY,
    );
    expect(assessBackgroundJobHealth(health, { requireWorkers: true, now })).toMatchObject({
      available: false,
      status: 'error',
      warnings: ['heavy-worker-missing'],
    });
  });

  it('old backlog and dead jobs are degraded but keep web available', () => {
    const health = fixture();
    health.oldestPendingAt.LIGHT = new Date(now.getTime() - 6 * 60_000);
    health.deadLast24h = 1;
    expect(assessBackgroundJobHealth(health, { requireWorkers: true, now })).toMatchObject({
      available: true,
      status: 'degraded',
      warnings: expect.arrayContaining(['light-backlog-old', 'dead-jobs-last-24h']),
    });
  });

  it('workers from only an old release are unavailable', () => {
    expect(
      assessBackgroundJobHealth(fixture(), {
        requireWorkers: true,
        expectedVersion: 'v2',
        now,
      }),
    ).toMatchObject({
      available: false,
      status: 'error',
      warnings: expect.arrayContaining([
        'light-worker-version-mismatch',
        'heavy-worker-version-mismatch',
      ]),
    });
  });
});
