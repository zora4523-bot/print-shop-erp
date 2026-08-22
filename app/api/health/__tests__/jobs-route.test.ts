import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getBackgroundJobHealthMock } = vi.hoisted(() => ({
  getBackgroundJobHealthMock: vi.fn(),
}));

// 本路由不碰 db，但 health.ts 会 import lib/db；桩掉避免建真实 PrismaClient。
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/background-jobs/health', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/background-jobs/health')>();
  // 只替换回库的那一步，assessBackgroundJobHealth / classifyBackgroundJobAlerts
  // 保持真实实现——本文件要验的正是这条真实链路的分档。
  return { ...actual, getBackgroundJobHealth: getBackgroundJobHealthMock };
});
vi.mock('@/lib/background-jobs/mode', () => ({
  backgroundJobsMode: () => 'durable',
}));

import { BackgroundJobQueue } from '@/generated/prisma/enums';
import type { BackgroundJobHealth } from '@/lib/background-jobs/health';
import { GET } from '../jobs/route';

const VERSION = 'v1';

function fixture(): BackgroundJobHealth {
  const now = new Date();
  return {
    activeWorkers: [
      { queue: BackgroundJobQueue.LIGHT, version: VERSION, lastSeenAt: now },
      { queue: BackgroundJobQueue.HEAVY, version: VERSION, lastSeenAt: now },
    ],
    pending: { LIGHT: 0, HEAVY: 0 },
    oldestPendingAt: { LIGHT: null, HEAVY: null },
    running: 0,
    staleRunning: 0,
    deadLast24h: 0,
    deadNotificationLast24h: 0,
  };
}

beforeEach(() => {
  getBackgroundJobHealthMock.mockReset();
  vi.stubEnv('APP_VERSION', VERSION);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/health/jobs', () => {
  it('健康队列 → 200 {status:ok}，无告警', async () => {
    getBackgroundJobHealthMock.mockResolvedValue(fixture());
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', mode: 'durable' });
    expect(body.alerts).toEqual([]);
    expect(body.warnings).toEqual([]);
  });

  it('有死信 → 503 {status:alert}，并回出计数', async () => {
    const health = fixture();
    health.deadLast24h = 3;
    getBackgroundJobHealthMock.mockResolvedValue(health);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('alert');
    expect(body.alerts).toContain('dead-jobs-last-24h');
    expect(body.jobs.deadLast24h).toBe(3);
  });

  it('有卡死的 RUNNING → 503 {status:alert}', async () => {
    const health = fixture();
    health.staleRunning = 1;
    health.running = 1;
    getBackgroundJobHealthMock.mockResolvedValue(health);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('alert');
    expect(body.alerts).toContain('stale-running-jobs');
    expect(body.jobs.staleRunning).toBe(1);
  });

  it('只有会自愈的积压 → 200 {status:degraded}，不 page', async () => {
    const health = fixture();
    health.pending.LIGHT = 12;
    health.oldestPendingAt.LIGHT = new Date(Date.now() - 6 * 60_000);
    getBackgroundJobHealthMock.mockResolvedValue(health);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.alerts).toEqual([]);
    expect(body.warnings).toContain('light-backlog-old');
  });

  it('查询抛错 → 503 {status:error, db:down}，不泄漏错误详情', async () => {
    getBackgroundJobHealthMock.mockRejectedValue(
      new Error('connection refused: 密码错误'),
    );

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'error', db: 'down' });
    expect(JSON.stringify(body)).not.toMatch(/connection refused|密码/);
  });

  it('匿名 surface 收敛：只回计数与告警码，不回 worker 明细', async () => {
    getBackgroundJobHealthMock.mockResolvedValue(fixture());
    const res = await GET();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      'alerts',
      'jobs',
      'mode',
      'status',
      'time',
      'warnings',
    ]);
    expect(JSON.stringify(body)).not.toMatch(
      /activeWorkers|workerId|lastSeenAt/,
    );
  });
});
