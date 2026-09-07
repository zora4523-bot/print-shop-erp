import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, getBackgroundJobHealthMock, botDigest } = vi.hoisted(() => ({
  dbMock: { $queryRaw: vi.fn() },
  getBackgroundJobHealthMock: vi.fn(),
  botDigest: 'a'.repeat(64),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/background-jobs/health', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/background-jobs/health')>();
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
import { GET } from '../ready/route';

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
  dbMock.$queryRaw.mockReset();
  // BigInt(0) 而不是 0n —— tsconfig 的 target 是 ES2017，BigInt 字面量会被
  // tsc 拒绝（TS2737）。仓库既有写法同样是 BigInt(...)，见 lib/order/export.ts:272。
  dbMock.$queryRaw.mockResolvedValue([{ mismatchCount: BigInt(0) }]);
  getBackgroundJobHealthMock.mockReset();
  vi.stubEnv('APP_VERSION', VERSION);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/health/ready', () => {
  it('死信与卡死 RUNNING 只降级、不改状态码（deploy/update.sh 靠它判发布成败）', async () => {
    const health = fixture();
    health.deadLast24h = 5;
    health.staleRunning = 2;
    health.running = 2;
    getBackgroundJobHealthMock.mockResolvedValue(health);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.time).toBe(health.observedAt.toISOString());
    expect(body.warnings).toContain('dead-jobs-last-24h');
    expect(body.warnings).toContain('stale-running-jobs');
    expect(body.jobs.deadLast24h).toBe(5);
    expect(body.jobs.staleRunning).toBe(2);
  });

  it('worker 缺失仍然 503：本次改动没有削弱原有的 worker 门禁', async () => {
    const health = fixture();
    health.activeWorkers = health.activeWorkers.filter(
      (worker) => worker.queue !== BackgroundJobQueue.HEAVY,
    );
    getBackgroundJobHealthMock.mockResolvedValue(health);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.warnings).toContain('heavy-worker-missing');
  });

  it('智能机器人普通断线只降级并暴露状态，不让 ready 返回 503', async () => {
    const health = fixture();
    health.activeWorkers[0]!.smartBotStatus =
      SmartBotConnectionStatus.DISCONNECTED;
    getBackgroundJobHealthMock.mockResolvedValue(health);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'degraded',
      smartBot: { status: 'DISCONNECTED' },
    });
    expect(body.warnings).toContain('smart-bot-disconnected');
  });

  it('智能机器人认证失败仍不改变 Web ready 可用性', async () => {
    const health = fixture();
    health.activeWorkers[0]!.smartBotStatus =
      SmartBotConnectionStatus.AUTH_FAILED;
    getBackgroundJobHealthMock.mockResolvedValue(health);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.smartBot).toMatchObject({
      status: 'AUTH_FAILED',
      required: true,
      operational: false,
    });
    expect(body.warnings).toContain('smart-bot-auth-failed');
  });
});
