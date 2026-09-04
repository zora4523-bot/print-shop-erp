import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, databaseNowMock } = vi.hoisted(() => ({
  dbMock: {
    $queryRaw: vi.fn(),
    backgroundWorkerHeartbeat: { findMany: vi.fn() },
    notificationChannel: { findMany: vi.fn() },
    backgroundJob: { count: vi.fn(), findFirst: vi.fn() },
  },
  databaseNowMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('../clock', () => ({ databaseNow: databaseNowMock }));

import {
  BackgroundJobQueue,
  BackgroundJobStatus,
  SmartBotConnectionStatus,
} from '../../../generated/prisma/enums';
import {
  assessBackgroundJobHealth,
  classifyBackgroundJobAlerts,
  getBackgroundJobHealth,
} from '../health';
import {
  WORKER_HEARTBEAT_ACTIVE_WINDOW_MS,
  WORKER_HEARTBEAT_MAX_INTERVAL_MS,
} from '../heartbeat-policy';
import { BACKGROUND_JOB_TYPES } from '../types';

const DB_NOW = new Date('2026-08-22T03:04:05.000Z');

beforeEach(() => {
  databaseNowMock.mockReset().mockResolvedValue(DB_NOW);
  dbMock.$queryRaw.mockReset().mockResolvedValue([
    { deadLast24h: 2, deadNotificationLast24h: 1 },
  ]);
  dbMock.backgroundWorkerHeartbeat.findMany.mockReset().mockResolvedValue([]);
  dbMock.notificationChannel.findMany.mockReset().mockResolvedValue([]);
  dbMock.backgroundJob.count
    .mockReset()
    .mockResolvedValueOnce(3)
    .mockResolvedValueOnce(4)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(0);
  dbMock.backgroundJob.findFirst
    .mockReset()
    .mockResolvedValueOnce({ availableAt: new Date(DB_NOW.getTime() - 90_000) })
    .mockResolvedValueOnce({ availableAt: new Date(DB_NOW.getTime() - 30_000) });
});

describe('getBackgroundJobHealth', () => {
  it('uses one database observation and classifies notification delivery/test dead jobs together', async () => {
    const health = await getBackgroundJobHealth();

    expect(databaseNowMock).toHaveBeenCalledOnce();
    expect(health.observedAt).toBe(DB_NOW);
    expect(health.pending).toEqual({ LIGHT: 3, HEAVY: 4 });
    expect(health.oldestPendingAt).toEqual({
      LIGHT: new Date(DB_NOW.getTime() - 90_000),
      HEAVY: new Date(DB_NOW.getTime() - 30_000),
    });

    for (const [index, queue] of [
      BackgroundJobQueue.LIGHT,
      BackgroundJobQueue.HEAVY,
    ].entries()) {
      expect(dbMock.backgroundJob.count).toHaveBeenNthCalledWith(index + 1, {
        where: {
          queue,
          status: BackgroundJobStatus.PENDING,
          availableAt: { lte: DB_NOW },
        },
      });
      expect(dbMock.backgroundJob.findFirst).toHaveBeenNthCalledWith(index + 1, {
        where: {
          queue,
          status: BackgroundJobStatus.PENDING,
          availableAt: { lte: DB_NOW },
        },
        select: { availableAt: true },
        orderBy: { availableAt: 'asc' },
      });
    }

    expect(dbMock.backgroundWorkerHeartbeat.findMany).toHaveBeenCalledWith(
      {
        where: {
          lastSeenAt: {
            gte: new Date(
              DB_NOW.getTime() - WORKER_HEARTBEAT_ACTIVE_WINDOW_MS,
            ),
          },
        },
        select: {
          queue: true,
          version: true,
          smartBotStatus: true,
          smartBotBotDigest: true,
          lastSeenAt: true,
        },
        orderBy: { lastSeenAt: 'desc' },
      },
    );
    expect(dbMock.notificationChannel.findMany).toHaveBeenCalledWith({
      where: { transport: 'WECOM_SMART_BOT', isActive: true },
      select: {
        smartBotBotDigest: true,
        smartBotTargetId: true,
        smartBotChatType: true,
        smartBotBoundAt: true,
      },
    });

    expect(dbMock.backgroundJob.count).toHaveBeenCalledTimes(4);
    expect(dbMock.$queryRaw).toHaveBeenCalledOnce();
    expect(WORKER_HEARTBEAT_ACTIVE_WINDOW_MS).toBe(
      WORKER_HEARTBEAT_MAX_INTERVAL_MS * 3,
    );
    const deadCountCall = dbMock.$queryRaw.mock.calls[0]!;
    expect((deadCountCall[0] as TemplateStringsArray).join('?')).toMatch(
      /count\(\*\).*FILTER[\s\S]*FROM "BackgroundJob"[\s\S]*"finishedAt" >=/,
    );
    expect(deadCountCall.slice(1)).toEqual([
      BACKGROUND_JOB_TYPES.NOTIFICATION,
      BACKGROUND_JOB_TYPES.NOTIFICATION_CHANNEL_TEST,
      BackgroundJobStatus.DEAD,
      new Date(DB_NOW.getTime() - 24 * 60 * 60_000),
    ]);
  });

  it('returns the persisted connector status from the active worker heartbeat', async () => {
    dbMock.backgroundWorkerHeartbeat.findMany.mockResolvedValueOnce([
      {
        queue: BackgroundJobQueue.LIGHT,
        version: 'v1',
        smartBotStatus: SmartBotConnectionStatus.AUTH_FAILED,
        smartBotBotDigest: 'a'.repeat(64),
        lastSeenAt: DB_NOW,
      },
    ]);

    const health = await getBackgroundJobHealth();

    expect(health.activeWorkers[0]).toMatchObject({
      queue: BackgroundJobQueue.LIGHT,
      smartBotStatus: SmartBotConnectionStatus.AUTH_FAILED,
    });
  });

  it('keeps a non-notification DEAD job actionable when notification DEAD volume is high', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([
      { deadLast24h: 201, deadNotificationLast24h: 200 },
    ]);

    const health = await getBackgroundJobHealth();
    const assessment = assessBackgroundJobHealth(health, {
      requireWorkers: false,
    });
    const alerts = classifyBackgroundJobAlerts(assessment.warnings);

    expect(assessment.warnings).toEqual(
      expect.arrayContaining([
        'dead-jobs-last-24h',
        'dead-notification-jobs-last-24h',
      ]),
    );
    expect(alerts.alerts).toContain('dead-jobs-last-24h');
    expect(alerts.warnings).toContain('dead-notification-jobs-last-24h');
  });
});
