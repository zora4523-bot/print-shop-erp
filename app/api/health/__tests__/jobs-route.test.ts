import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getBackgroundJobHealthMock, botDigest } = vi.hoisted(() => ({
  getBackgroundJobHealthMock: vi.fn(),
  botDigest: 'a'.repeat(64),
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
vi.mock('@/lib/notification/smart-bot-identity', () => ({
  configuredSmartBotIdDigest: () => botDigest,
}));

import {
  BackgroundJobQueue,
  SmartBotConnectionStatus,
} from '@/generated/prisma/enums';
import type { BackgroundJobHealth } from '@/lib/background-jobs/health';
import { GET } from '../jobs/route';

const VERSION = 'v1';

function fixture(): BackgroundJobHealth {
  const now = new Date();
  return {
    observedAt: now,
    activeWorkers: [
      {
        queue: BackgroundJobQueue.LIGHT,
        version: VERSION,
        smartBotStatus: SmartBotConnectionStatus.CONNECTED,
        smartBotBotDigest: botDigest,
        lastSeenAt: now,
      },
      {
        queue: BackgroundJobQueue.HEAVY,
        version: VERSION,
        smartBotStatus: null,
        smartBotBotDigest: null,
        lastSeenAt: now,
      },
    ],
    activeSmartBotChannels: [
      {
        smartBotBotDigest: botDigest,
        smartBotTargetId: 'group-1',
        smartBotChatType: 'GROUP',
        smartBotBoundAt: now,
      },
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
    expect(body.smartBot).toEqual({
      status: 'CONNECTED',
      required: true,
      configurationValid: true,
      identityMatch: true,
      operational: true,
      recoveryWaitMs: 0,
    });
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
    health.oldestPendingAt.LIGHT = new Date(
      health.observedAt.getTime() - 6 * 60_000,
    );
    getBackgroundJobHealthMock.mockResolvedValue(health);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.time).toBe(health.observedAt.toISOString());
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

  it('智能机器人普通断线仅 degraded，状态码保持 200', async () => {
    const health = fixture();
    health.activeWorkers[0]!.smartBotStatus =
      SmartBotConnectionStatus.DISCONNECTED;
    getBackgroundJobHealthMock.mockResolvedValue(health);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'degraded',
      smartBot: { status: 'DISCONNECTED', required: true, operational: false },
      alerts: [],
    });
    expect(body.warnings).toContain('smart-bot-disconnected');
  });

  it('worker Bot ID 与启用目标不一致时匿名返回安全布尔值并报警', async () => {
    const health = fixture();
    health.activeWorkers[0]!.smartBotBotDigest = 'b'.repeat(64);
    getBackgroundJobHealthMock.mockResolvedValue(health);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.smartBot).toMatchObject({
      required: true,
      identityMatch: false,
      operational: false,
    });
    expect(body.alerts).toContain('smart-bot-identity-mismatch');
    expect(JSON.stringify(body)).not.toContain('a'.repeat(64));
    expect(JSON.stringify(body)).not.toContain('b'.repeat(64));
  });

  it('智能机器人认证失败是可操作告警，jobs 返回 503', async () => {
    const health = fixture();
    health.activeWorkers[0]!.smartBotStatus =
      SmartBotConnectionStatus.AUTH_FAILED;
    getBackgroundJobHealthMock.mockResolvedValue(health);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'alert',
      smartBot: { status: 'AUTH_FAILED' },
      alerts: ['smart-bot-auth-failed'],
    });
  });

  it('匿名 surface 收敛：只回计数与告警码，不回 worker 明细', async () => {
    getBackgroundJobHealthMock.mockResolvedValue(fixture());
    const res = await GET();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      'alerts',
      'jobs',
      'mode',
      'smartBot',
      'status',
      'time',
      'warnings',
    ]);
    expect(JSON.stringify(body)).not.toMatch(
      /activeWorkers|workerId|lastSeenAt/,
    );
  });

  it('only exposes a relative recovery wait for a still-active old worker', async () => {
    const health = fixture();
    health.activeWorkers.push({
      ...health.activeWorkers[0]!,
      version: 'previous-release',
      lastSeenAt: new Date(health.observedAt.getTime() - 50_000),
    });
    getBackgroundJobHealthMock.mockResolvedValue(health);
    const response = await GET();
    const body = await response.json();
    expect(body.smartBot).toMatchObject({
      status: 'CONNECTED', identityMatch: true, operational: false,
      recoveryWaitMs: 130_000,
    });
    expect(JSON.stringify(body)).not.toMatch(/previous-release|lastSeenAt|workerId|group-1/);
    expect(JSON.stringify(body)).not.toContain(botDigest);
  });
});
