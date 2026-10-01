import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getHealth, digest } = vi.hoisted(() => ({
  getHealth: vi.fn(),
  digest: 'a'.repeat(64),
}));

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/background-jobs/health', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/background-jobs/health')>(),
  getBackgroundJobHealth: getHealth,
}));
vi.mock('@/lib/notification/smart-bot-identity', () => ({
  configuredSmartBotIdDigest: () => digest,
}));

import { GET } from '@/app/api/health/jobs/route';
import { BackgroundJobQueue, SmartBotConnectionStatus } from '@/generated/prisma/enums';
import type { BackgroundJobHealth } from '@/lib/background-jobs/health';
import { assessDeployJobsGate } from '../deploy-jobs-gate.mjs';

function health(): BackgroundJobHealth {
  const now = new Date('2026-09-10T00:00:00Z');
  return {
    observedAt: now,
    activeWorkers: [
      {
        queue: BackgroundJobQueue.LIGHT, version: 'candidate',
        smartBotStatus: SmartBotConnectionStatus.CONNECTED,
        smartBotBotDigest: digest, lastSeenAt: now,
      },
      {
        queue: BackgroundJobQueue.HEAVY, pdfReady: true, version: 'candidate',
        smartBotStatus: null, smartBotBotDigest: null, lastSeenAt: now,
      },
    ],
    activeSmartBotChannels: [{
      smartBotBotDigest: digest, smartBotTargetId: 'test-group',
      smartBotChatType: 'GROUP', smartBotBoundAt: now,
    }],
    pending: { LIGHT: 0, HEAVY: 0 },
    oldestPendingAt: { LIGHT: null, HEAVY: null },
    running: 0, staleRunning: 0, deadLast24h: 0, deadNotificationLast24h: 0,
  };
}

beforeEach(() => {
  getHealth.mockReset();
  vi.stubEnv('APP_VERSION', 'candidate');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('BACKGROUND_JOBS_MODE', 'durable');
});

afterEach(() => vi.unstubAllEnvs());

describe('real jobs route to deploy gate contract', () => {
  it('accepts the complete optional null status only in explicit non-production inline mode', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BACKGROUND_JOBS_MODE', 'inline');
    const snapshot = health();
    snapshot.activeWorkers = [];
    snapshot.activeSmartBotChannels = [];
    getHealth.mockResolvedValue(snapshot);

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'ok', mode: 'inline',
      smartBot: { status: null, required: false, configurationValid: true,
        identityMatch: null, operational: true, recoveryWaitMs: 0 },
    });
    expect(assessDeployJobsGate(body, { runtimeEnvironment: 'development' }))
      .toMatchObject({ ok: true, ready: true, status: null, required: false });
    for (const runtimeEnvironment of [undefined, 'production', 'unknown']) {
      expect(assessDeployJobsGate(body, { runtimeEnvironment }).ok).toBe(false);
    }
  });

  it('accepts healthy production durable workers and a connected required bot', async () => {
    getHealth.mockResolvedValue(health());
    const response = await GET();
    expect(response.status).toBe(200);
    expect(assessDeployJobsGate(await response.json()))
      .toMatchObject({ ok: true, ready: true, status: 'CONNECTED' });
  });

  it.each(['missing', 'old-version'] as const)('blocks a %s HEAVY worker even with a connected bot', async (failure) => {
    const snapshot = health();
    if (failure === 'missing') snapshot.activeWorkers.pop();
    else snapshot.activeWorkers[1]!.version = 'old-release';
    getHealth.mockResolvedValue(snapshot);
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.smartBot.operational).toBe(true);
    expect(assessDeployJobsGate(body))
      .toMatchObject({ ok: false, ready: false, reason: 'worker-unavailable' });
  });

  it('never accepts absent durable workers just because the bot is optional', async () => {
    const snapshot = health();
    snapshot.activeWorkers = [];
    snapshot.activeSmartBotChannels = [];
    getHealth.mockResolvedValue(snapshot);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(assessDeployJobsGate(await response.json(), { runtimeEnvironment: 'development' }).ok)
      .toBe(false);
  });

  it.each(['binding', 'credentials', 'identity', 'auth', 'conflict'] as const)(
    'blocks production required bot failure: %s', async (failure) => {
      const snapshot = health();
      const channel = snapshot.activeSmartBotChannels[0]!;
      const worker = snapshot.activeWorkers[0]!;
      if (failure === 'binding') channel.smartBotBoundAt = null;
      if (failure === 'credentials') worker.smartBotStatus = SmartBotConnectionStatus.NOT_CONFIGURED;
      if (failure === 'identity') worker.smartBotBotDigest = 'b'.repeat(64);
      if (failure === 'auth') worker.smartBotStatus = SmartBotConnectionStatus.AUTH_FAILED;
      if (failure === 'conflict') worker.smartBotStatus = SmartBotConnectionStatus.CONNECTION_CONFLICT;
      getHealth.mockResolvedValue(snapshot);
      const response = await GET();
      expect(response.status).toBe(503);
      expect(assessDeployJobsGate(await response.json()).ok).toBe(false);
    },
  );

  it('retains the historical queue alert exception with healthy durable workers', async () => {
    const snapshot = health();
    snapshot.deadLast24h = 2;
    getHealth.mockResolvedValue(snapshot);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(assessDeployJobsGate(await response.json()))
      .toMatchObject({ ok: true, ready: true });
  });

  it('rejects the real database-error response', async () => {
    getHealth.mockRejectedValue(new Error('test database unavailable'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(assessDeployJobsGate(await response.json()).ok).toBe(false);
  });
});
