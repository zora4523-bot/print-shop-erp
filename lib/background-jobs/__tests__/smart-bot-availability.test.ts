import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, txMock, databaseNowMock } = vi.hoisted(() => {
  const tx = {
    backgroundWorkerHeartbeat: { findMany: vi.fn() },
  };
  return {
    txMock: tx,
    dbMock: {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    },
    databaseNowMock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseNow: databaseNowMock,
}));

import { hasExclusiveConnectedSmartBotWorker } from '../smart-bot-availability';

beforeEach(() => {
  databaseNowMock.mockReset().mockResolvedValue(
    new Date('2026-09-04T15:00:00.000Z'),
  );
  txMock.backgroundWorkerHeartbeat.findMany.mockReset();
  dbMock.$transaction.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe('hasExclusiveConnectedSmartBotWorker', () => {
  const expectedBotDigest = 'a'.repeat(64);

  it('accepts exactly one fresh, current-version authenticated LIGHT worker', async () => {
    txMock.backgroundWorkerHeartbeat.findMany.mockResolvedValue([
      {
        version: 'release-1',
        smartBotStatus: 'CONNECTED',
        smartBotBotDigest: expectedBotDigest,
      },
    ]);

    await expect(
      hasExclusiveConnectedSmartBotWorker(expectedBotDigest, {
        expectedVersion: 'release-1',
      }),
    ).resolves.toBe(true);
    expect(txMock.backgroundWorkerHeartbeat.findMany).toHaveBeenCalledWith({
      where: {
        queue: 'LIGHT',
        lastSeenAt: { gte: new Date('2026-09-04T14:57:00.000Z') },
      },
      select: {
        version: true,
        smartBotStatus: true,
        smartBotBotDigest: true,
      },
      take: 2,
    });
  });

  it('uses the worker runtime dev fallback when APP_VERSION is blank', async () => {
    vi.stubEnv('APP_VERSION', '');
    txMock.backgroundWorkerHeartbeat.findMany.mockResolvedValue([
      {
        version: 'dev',
        smartBotStatus: 'CONNECTED',
        smartBotBotDigest: expectedBotDigest,
      },
    ]);

    await expect(
      hasExclusiveConnectedSmartBotWorker(expectedBotDigest),
    ).resolves.toBe(true);
  });

  it.each([
    { name: 'missing', workers: [] },
    {
      name: 'unhealthy',
      workers: [
        {
          version: 'release-1',
          smartBotStatus: 'CONNECTING',
          smartBotBotDigest: expectedBotDigest,
        },
      ],
    },
    {
      name: 'stale-version',
      workers: [
        {
          version: 'old-release',
          smartBotStatus: 'CONNECTED',
          smartBotBotDigest: expectedBotDigest,
        },
      ],
    },
    {
      name: 'duplicate',
      workers: [
        {
          version: 'release-1',
          smartBotStatus: 'CONNECTED',
          smartBotBotDigest: expectedBotDigest,
        },
        {
          version: 'old-release',
          smartBotStatus: 'AUTH_FAILED',
          smartBotBotDigest: 'b'.repeat(64),
        },
      ],
    },
  ])('rejects $name owners', async ({ workers }) => {
    txMock.backgroundWorkerHeartbeat.findMany.mockResolvedValue(
      workers as Array<{
        version: string;
        smartBotStatus: string;
        smartBotBotDigest: string;
      }>,
    );

    await expect(
      hasExclusiveConnectedSmartBotWorker(expectedBotDigest, {
        expectedVersion: 'release-1',
      }),
    ).resolves.toBe(false);
  });

  it('rejects a connected worker that owns another Bot ID', async () => {
    txMock.backgroundWorkerHeartbeat.findMany.mockResolvedValue([
      {
        version: 'release-1',
        smartBotStatus: 'CONNECTED',
        smartBotBotDigest: 'b'.repeat(64),
      },
    ]);

    await expect(
      hasExclusiveConnectedSmartBotWorker(expectedBotDigest, {
        expectedVersion: 'release-1',
      }),
    ).resolves.toBe(false);
  });

  it('fails closed before querying when no configured Bot ID digest exists', async () => {
    await expect(hasExclusiveConnectedSmartBotWorker(null)).resolves.toBe(false);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });
});
