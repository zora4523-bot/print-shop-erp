import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    backgroundWorkerHeartbeat: { delete: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { BackgroundJobQueue } from '../../../generated/prisma/enums';
import { startWorkerHeartbeat } from '../heartbeat';

let stop: (() => Promise<void>) | null = null;

beforeEach(() => {
  dbMock.$executeRaw.mockReset().mockResolvedValue(1);
  dbMock.backgroundWorkerHeartbeat.delete.mockReset().mockResolvedValue({});
});

afterEach(async () => {
  // disposer 会 clearInterval；不调用的话 vitest 会挂在这个定时器上。
  await stop?.();
  stop = null;
});

async function start() {
  stop = await startWorkerHeartbeat({
    workerId: 'worker-light-1',
    queue: BackgroundJobQueue.LIGHT,
    version: 'v1',
  });
}

describe('startWorkerHeartbeat', () => {
  it('stamps liveness with the database clock, never with this process clock', async () => {
    await start();

    const [strings, ...values] = dbMock.$executeRaw.mock.calls[0]!;
    const sql = (strings as TemplateStringsArray).join('?');
    expect(sql).toContain('INSERT INTO "BackgroundWorkerHeartbeat"');
    expect(sql).toContain('ON CONFLICT ("workerId") DO UPDATE');
    // startedAt 与 lastSeenAt 都由数据库产生。lastSeenAt 稍后要被 web 进程拿
    // 45 秒窗口读回（lib/background-jobs/health.ts），两端必须是同一把钟。
    expect(sql).toContain('clock_timestamp()');
    expect(values).toEqual([
      'worker-light-1',
      BackgroundJobQueue.LIGHT,
      'v1',
    ]);
    expect(values.some((value) => value instanceof Date)).toBe(false);
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
});
