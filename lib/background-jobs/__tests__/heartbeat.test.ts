import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    backgroundWorkerHeartbeat: { delete: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { BackgroundJobQueue } from '../../../generated/prisma/enums';
import {
  startWorkerHeartbeat,
  type WorkerSmartBotConnectionStatus,
} from '../heartbeat';
import { WORKER_HEARTBEAT_MAX_INTERVAL_MS } from '../heartbeat-policy';

let stop: (() => Promise<void>) | null = null;

beforeEach(() => {
  dbMock.$executeRaw.mockReset().mockResolvedValue(1);
  dbMock.backgroundWorkerHeartbeat.delete.mockReset().mockResolvedValue({});
});

afterEach(async () => {
  // disposer 会 clearInterval；不调用的话 vitest 会挂在这个定时器上。
  await stop?.();
  stop = null;
  vi.useRealTimers();
});

async function start(
  overrides: Partial<Parameters<typeof startWorkerHeartbeat>[0]> = {},
) {
  stop = await startWorkerHeartbeat({
    workerId: 'worker-light-1',
    queue: BackgroundJobQueue.LIGHT,
    version: 'v1',
    ...overrides,
  });
}

describe('startWorkerHeartbeat', () => {
  it('stamps liveness with the database clock, never with this process clock', async () => {
    await start();

    const [strings, ...values] = dbMock.$executeRaw.mock.calls[0]!;
    const sql = (strings as TemplateStringsArray).join('?');
    expect(sql).toContain('INSERT INTO "BackgroundWorkerHeartbeat"');
    expect(sql).toContain('ON CONFLICT ("workerId") DO UPDATE');
    expect(sql).toContain('"smartBotStatus" = EXCLUDED."smartBotStatus"');
    expect(sql).toContain(
      '"smartBotBotDigest" = EXCLUDED."smartBotBotDigest"',
    );
    // startedAt 与 lastSeenAt 都由数据库产生。lastSeenAt 稍后要被 web 进程拿
    // 共享策略窗口读回（lib/background-jobs/health.ts），两端必须是同一把钟。
    expect(sql).toContain('clock_timestamp()');
    expect(values).toEqual([
      'worker-light-1',
      BackgroundJobQueue.LIGHT,
      'v1',
      null,
      null,
      null,
    ]);
    expect(values.some((value) => value instanceof Date)).toBe(false);
  });

  it('publishes the current smart-bot status on every beat', async () => {
    vi.useFakeTimers();
    let smartBotStatus: WorkerSmartBotConnectionStatus = 'CONNECTING';
    const smartBotBotDigest = 'a'.repeat(64);
    await start({
      intervalMs: 5_000,
      smartBotStatus: () => smartBotStatus,
      smartBotBotDigest: () => smartBotBotDigest,
    });

    expect(dbMock.$executeRaw.mock.calls[0]!.slice(1)).toEqual([
      'worker-light-1',
      BackgroundJobQueue.LIGHT,
      'v1',
      'CONNECTING',
      smartBotBotDigest,
      null,
    ]);

    smartBotStatus = 'CONNECTED';
    await vi.advanceTimersByTimeAsync(5_000);

    expect(dbMock.$executeRaw.mock.calls[2]!.slice(1)).toEqual([
      'worker-light-1',
      BackgroundJobQueue.LIGHT,
      'v1',
      'CONNECTED',
      smartBotBotDigest,
      null,
    ]);
  });

  it('publishes null for a worker without a smart-bot connector', async () => {
    await start({
      workerId: 'worker-heavy-1',
      queue: BackgroundJobQueue.HEAVY,
    });

    expect(dbMock.$executeRaw.mock.calls[0]!.slice(1)).toEqual([
      'worker-heavy-1',
      BackgroundJobQueue.HEAVY,
      'v1',
      null,
      null,
      null,
    ]);
  });

  it('caps direct interval requests at the maximum covered by health checks', async () => {
    vi.useFakeTimers();
    await start({ intervalMs: WORKER_HEARTBEAT_MAX_INTERVAL_MS + 1 });

    await vi.advanceTimersByTimeAsync(WORKER_HEARTBEAT_MAX_INTERVAL_MS - 1);
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('prunes long-dead worker rows against the database clock', async () => {
    await start();

    const [strings, ...values] = dbMock.$executeRaw.mock.calls[1]!;
    const sql = (strings as TemplateStringsArray).join('?');
    expect(sql).toContain('DELETE FROM "BackgroundWorkerHeartbeat"');
    expect(sql).toContain("clock_timestamp() - interval '7 days'");
    expect(values).toEqual([]);
  });

  it('the disposer drops this worker row', async () => {
    await start();
    await stop?.();
    stop = null;

    expect(dbMock.backgroundWorkerHeartbeat.delete).toHaveBeenCalledWith({
      where: { workerId: 'worker-light-1' },
    });
  });

  it('drains an in-flight beat before deleting the worker row', async () => {
    vi.useFakeTimers();
    let resolveBeat!: (value: number) => void;
    const pendingBeat = new Promise<number>((resolve) => {
      resolveBeat = resolve;
    });
    dbMock.$executeRaw
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockImplementationOnce(() => pendingBeat);

    await start({ intervalMs: 5_000 });
    vi.advanceTimersByTime(5_000);
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(3);

    const stopping = stop!();
    await Promise.resolve();
    expect(dbMock.backgroundWorkerHeartbeat.delete).not.toHaveBeenCalled();

    resolveBeat(1);
    await stopping;
    stop = null;
    expect(dbMock.backgroundWorkerHeartbeat.delete).toHaveBeenCalledOnce();
  });

  it('keeps shutdown reliable when the heartbeat error reporter throws', async () => {
    vi.useFakeTimers();
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    dbMock.$executeRaw
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(new Error('heartbeat unavailable'));

    await start({
      intervalMs: 5_000,
      onError: () => {
        throw new Error('reporter unavailable');
      },
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await stop?.();
    stop = null;

    expect(consoleSpy).toHaveBeenCalledWith(
      '[worker] heartbeat error reporter failed:',
      'Error',
    );
    expect(dbMock.backgroundWorkerHeartbeat.delete).toHaveBeenCalledOnce();
  });
});
