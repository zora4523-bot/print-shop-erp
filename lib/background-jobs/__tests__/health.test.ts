import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));
import {
  BackgroundJobQueue,
  SmartBotConnectionStatus,
} from '../../../generated/prisma/enums';
import {
  assessBackgroundJobHealth,
  classifyBackgroundJobAlerts,
  summarizeSmartBotConnection,
  summarizeSmartBotOperationalHealth,
  type BackgroundJobHealth,
} from '../health';

const now = new Date('2026-07-17T08:00:00.000Z');

afterEach(() => {
  vi.useRealTimers();
});

function fixture(): BackgroundJobHealth {
  return {
    observedAt: now,
    activeWorkers: [
      {
        queue: BackgroundJobQueue.LIGHT,
        version: 'v1',
        smartBotStatus: SmartBotConnectionStatus.CONNECTED,
        smartBotBotDigest: null,
        lastSeenAt: now,
      },
      {
        queue: BackgroundJobQueue.HEAVY,
        version: 'v1',
        smartBotStatus: null,
        smartBotBotDigest: null,
        lastSeenAt: now,
      },
    ],
    activeSmartBotChannels: [],
    pending: { LIGHT: 0, HEAVY: 0 },
    oldestPendingAt: { LIGHT: null, HEAVY: null },
    running: 0,
    staleRunning: 0,
    deadLast24h: 0,
    deadNotificationLast24h: 0,
  };
}

describe('assessBackgroundJobHealth', () => {
  it('two fresh worker queues are ready', () => {
    expect(assessBackgroundJobHealth(fixture(), { requireWorkers: true })).toEqual({
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
    expect(assessBackgroundJobHealth(health, { requireWorkers: true })).toMatchObject({
      available: false,
      status: 'error',
      warnings: ['heavy-worker-missing'],
    });
  });

  it('old backlog and dead jobs are degraded but keep web available', () => {
    const health = fixture();
    health.oldestPendingAt.LIGHT = new Date(now.getTime() - 6 * 60_000);
    health.deadLast24h = 1;
    expect(assessBackgroundJobHealth(health, { requireWorkers: true })).toMatchObject({
      available: true,
      status: 'degraded',
      warnings: expect.arrayContaining(['light-backlog-old', 'dead-jobs-last-24h']),
    });
  });

  it('measures backlog age from observedAt even when the web clock is far ahead', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2035-01-01T00:00:00.000Z'));
    const health = fixture();
    health.oldestPendingAt.LIGHT = new Date(now.getTime() - 4 * 60_000);

    expect(
      assessBackgroundJobHealth(health, { requireWorkers: true }).warnings,
    ).not.toContain('light-backlog-old');
  });

  it('workers from only an old release are unavailable', () => {
    expect(
      assessBackgroundJobHealth(fixture(), {
        requireWorkers: true,
        expectedVersion: 'v2',
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

  it('smart-bot reconnecting is visible degradation but never makes ready unavailable', () => {
    const health = fixture();
    health.activeWorkers[0]!.smartBotStatus =
      SmartBotConnectionStatus.DISCONNECTED;

    expect(assessBackgroundJobHealth(health, { requireWorkers: true })).toEqual({
      available: true,
      status: 'degraded',
      warnings: ['smart-bot-disconnected'],
    });
  });

  it('smart-bot auth failure is actionable for jobs while ready stays available', () => {
    const health = fixture();
    health.activeWorkers[0]!.smartBotStatus =
      SmartBotConnectionStatus.AUTH_FAILED;
    const assessment = assessBackgroundJobHealth(health, {
      requireWorkers: true,
    });

    expect(assessment).toMatchObject({
      available: true,
      status: 'degraded',
      warnings: ['smart-bot-auth-failed'],
    });
    expect(classifyBackgroundJobAlerts(assessment.warnings)).toEqual({
      level: 'alert',
      alerts: ['smart-bot-auth-failed'],
      warnings: [],
    });
  });

  it('does not let a newer healthy LIGHT heartbeat hide a same-version auth failure', () => {
    const health = fixture();
    health.activeWorkers.splice(1, 0, {
      queue: BackgroundJobQueue.LIGHT,
      version: 'v1',
      smartBotStatus: SmartBotConnectionStatus.AUTH_FAILED,
      smartBotBotDigest: null,
      lastSeenAt: new Date(now.getTime() - 1_000),
    });

    expect(
      summarizeSmartBotConnection(health, { expectedVersion: 'v1' }),
    ).toEqual({
      status: SmartBotConnectionStatus.AUTH_FAILED,
      lastSeenAt: new Date(now.getTime() - 1_000),
    });

    const assessment = assessBackgroundJobHealth(health, {
      requireWorkers: true,
      expectedVersion: 'v1',
    });
    expect(assessment).toEqual({
      available: true,
      status: 'degraded',
      warnings: ['duplicate-light-workers', 'smart-bot-auth-failed'],
    });
    expect(classifyBackgroundJobAlerts(assessment.warnings)).toEqual({
      level: 'alert',
      alerts: ['duplicate-light-workers', 'smart-bot-auth-failed'],
      warnings: [],
    });
  });

  it('surfaces a same-version connection conflict and ignores old-release failures', () => {
    const health = fixture();
    health.activeWorkers.splice(
      1,
      0,
      {
        queue: BackgroundJobQueue.LIGHT,
        version: 'v1',
        smartBotStatus: SmartBotConnectionStatus.CONNECTION_CONFLICT,
        smartBotBotDigest: null,
        lastSeenAt: new Date(now.getTime() - 1_000),
      },
      {
        queue: BackgroundJobQueue.LIGHT,
        version: 'old',
        smartBotStatus: SmartBotConnectionStatus.AUTH_FAILED,
        smartBotBotDigest: null,
        lastSeenAt: new Date(now.getTime() - 500),
      },
    );

    expect(
      summarizeSmartBotConnection(health, { expectedVersion: 'v1' }).status,
    ).toBe(SmartBotConnectionStatus.CONNECTION_CONFLICT);

    const assessment = assessBackgroundJobHealth(health, {
      requireWorkers: true,
      expectedVersion: 'v1',
    });
    expect(assessment.warnings).toEqual([
      'duplicate-light-workers',
      'smart-bot-connection-conflict',
    ]);
    expect(classifyBackgroundJobAlerts(assessment.warnings)).toMatchObject({
      level: 'alert',
      alerts: [
        'duplicate-light-workers',
        'smart-bot-connection-conflict',
      ],
    });
  });

  it('requires one connected current-version worker with the same Bot ID as every active destination', () => {
    const health = fixture();
    const digest = 'a'.repeat(64);
    health.activeWorkers[0]!.smartBotBotDigest = digest;
    health.activeSmartBotChannels = [
      {
        smartBotBotDigest: digest,
        smartBotTargetId: 'group-1',
        smartBotChatType: 'GROUP',
        smartBotBoundAt: now,
      },
    ];

    expect(
      summarizeSmartBotOperationalHealth(health, {
        expectedVersion: 'v1',
        expectedBotDigest: digest,
      }),
    ).toEqual({
      required: true,
      configurationValid: true,
      identityMatch: true,
      operational: true,
    });

    health.activeWorkers[0]!.smartBotBotDigest = 'b'.repeat(64);
    const assessment = assessBackgroundJobHealth(health, {
      requireWorkers: true,
      expectedVersion: 'v1',
      expectedSmartBotDigest: digest,
    });
    expect(assessment.warnings).toContain('smart-bot-identity-mismatch');
    expect(classifyBackgroundJobAlerts(assessment.warnings).alerts).toContain(
      'smart-bot-identity-mismatch',
    );
  });

  it('makes missing credentials actionable when an active destination requires the bot', () => {
    const health = fixture();
    const digest = 'a'.repeat(64);
    health.activeWorkers[0]!.smartBotStatus =
      SmartBotConnectionStatus.NOT_CONFIGURED;
    health.activeWorkers[0]!.smartBotBotDigest = digest;
    health.activeSmartBotChannels = [
      {
        smartBotBotDigest: digest,
        smartBotTargetId: 'group-1',
        smartBotChatType: 'GROUP',
        smartBotBoundAt: now,
      },
    ];

    const assessment = assessBackgroundJobHealth(health, {
      requireWorkers: true,
      expectedVersion: 'v1',
      expectedSmartBotDigest: digest,
    });
    expect(assessment.warnings).toContain('smart-bot-not-configured');
    expect(classifyBackgroundJobAlerts(assessment.warnings).alerts).toContain(
      'smart-bot-not-configured',
    );
  });

  it('treats a matching destination without a current worker as not-yet-observed, not an identity mismatch', () => {
    const health = fixture();
    const digest = 'a'.repeat(64);
    health.activeWorkers = health.activeWorkers.filter(
      (worker) => worker.queue !== BackgroundJobQueue.LIGHT,
    );
    health.activeSmartBotChannels = [
      {
        smartBotBotDigest: digest,
        smartBotTargetId: 'group-1',
        smartBotChatType: 'GROUP',
        smartBotBoundAt: now,
      },
    ];

    expect(
      summarizeSmartBotOperationalHealth(health, {
        expectedVersion: 'v1',
        expectedBotDigest: digest,
      }),
    ).toMatchObject({
      required: true,
      identityMatch: null,
      operational: false,
    });
    expect(
      assessBackgroundJobHealth(health, {
        requireWorkers: true,
        expectedVersion: 'v1',
        expectedSmartBotDigest: digest,
      }).warnings,
    ).not.toContain('smart-bot-identity-mismatch');
  });

  it('never treats a current worker as exclusive while an old-release LIGHT heartbeat is active', () => {
    const health = fixture();
    const digest = 'a'.repeat(64);
    health.activeWorkers[0]!.smartBotBotDigest = digest;
    health.activeWorkers.splice(1, 0, {
      queue: BackgroundJobQueue.LIGHT,
      version: 'old',
      smartBotStatus: SmartBotConnectionStatus.CONNECTED,
      smartBotBotDigest: digest,
      lastSeenAt: new Date(now.getTime() - 1_000),
    });
    health.activeSmartBotChannels = [
      {
        smartBotBotDigest: digest,
        smartBotTargetId: 'group-1',
        smartBotChatType: 'GROUP',
        smartBotBoundAt: now,
      },
    ];

    expect(
      summarizeSmartBotOperationalHealth(health, {
        expectedVersion: 'v1',
        expectedBotDigest: digest,
      }),
    ).toMatchObject({ identityMatch: true, operational: false });
    const assessment = assessBackgroundJobHealth(health, {
      requireWorkers: true,
      expectedVersion: 'v1',
      expectedSmartBotDigest: digest,
    });
    expect(assessment.warnings).toContain('duplicate-light-workers');
    expect(classifyBackgroundJobAlerts(assessment.warnings).alerts).toContain(
      'duplicate-light-workers',
    );
  });

  it('an intentionally unconfigured optional smart bot does not degrade queues', () => {
    const health = fixture();
    health.activeWorkers[0]!.smartBotStatus =
      SmartBotConnectionStatus.NOT_CONFIGURED;

    expect(assessBackgroundJobHealth(health, { requireWorkers: true })).toEqual({
      available: true,
      status: 'ok',
      warnings: [],
    });
  });
});

describe('classifyBackgroundJobAlerts', () => {
  it('no warnings at all is ok', () => {
    expect(classifyBackgroundJobAlerts([])).toEqual({
      level: 'ok',
      alerts: [],
      warnings: [],
    });
  });

  it('backlog age never pages: it self-heals once a worker catches up', () => {
    expect(
      classifyBackgroundJobAlerts(['light-backlog-old', 'heavy-backlog-old']),
    ).toEqual({
      level: 'degraded',
      alerts: [],
      warnings: ['light-backlog-old', 'heavy-backlog-old'],
    });
  });

  it('dead jobs are actionable: retries are exhausted, nobody but a human moves them', () => {
    expect(classifyBackgroundJobAlerts(['dead-jobs-last-24h'])).toMatchObject({
      level: 'alert',
      alerts: ['dead-jobs-last-24h'],
    });
  });

  it('stale RUNNING jobs are actionable: the lease expired without reclaim', () => {
    expect(classifyBackgroundJobAlerts(['stale-running-jobs'])).toMatchObject({
      level: 'alert',
      alerts: ['stale-running-jobs'],
    });
  });

  it('missing or stale-version workers are actionable', () => {
    expect(classifyBackgroundJobAlerts(['heavy-worker-missing'])).toMatchObject({
      level: 'alert',
      alerts: ['heavy-worker-missing'],
    });
    expect(
      classifyBackgroundJobAlerts(['light-worker-version-mismatch']),
    ).toMatchObject({
      level: 'alert',
      alerts: ['light-worker-version-mismatch'],
    });
  });

  it('splits a mixed list without swallowing or duplicating anything', () => {
    expect(
      classifyBackgroundJobAlerts(['light-backlog-old', 'dead-jobs-last-24h']),
    ).toEqual({
      level: 'alert',
      alerts: ['dead-jobs-last-24h'],
      warnings: ['light-backlog-old'],
    });
  });

  it('通知类死信只降级、不报警（一次企业微信中断能产出上百条）', () => {
    // deadLast24h 是不分 type 的裸计数。企业微信抖一次，runOrderOverdueTask
    // 单轮就能产出最多 200 条通知死信；让它进 alerts 会把 /api/health/jobs
    // 稳定按在 503 上 24 小时，把真正要 30 分钟响应的结算死信淹掉。
    const health = fixture();
    health.deadLast24h = 200;
    health.deadNotificationLast24h = 200;
    const assessment = assessBackgroundJobHealth(health, {
      requireWorkers: true,
    });
    expect(assessment.warnings).toEqual(['dead-notification-jobs-last-24h']);
    expect(classifyBackgroundJobAlerts(assessment.warnings)).toEqual({
      level: 'degraded',
      alerts: [],
      warnings: ['dead-notification-jobs-last-24h'],
    });
  });

  it('一次性通道测试死信只降级，不让 jobs 探针持续返回 503', () => {
    // SQL 层把 NOTIFICATION_CHANNEL_TEST 计入 deadNotificationLast24h。
    // 这里钉死健康分类：测试没有 provider 幂等键，失败后应重新
    // 由管理员发起，不应用普通 dead-jobs 报警要求重试旧 job。
    const health = fixture();
    health.deadLast24h = 1;
    health.deadNotificationLast24h = 1;
    const assessment = assessBackgroundJobHealth(health, {
      requireWorkers: true,
    });

    expect(classifyBackgroundJobAlerts(assessment.warnings)).toEqual({
      level: 'degraded',
      alerts: [],
      warnings: ['dead-notification-jobs-last-24h'],
    });
  });

  it('通知死信和结算死信同时存在时，结算那条仍然报警', () => {
    const health = fixture();
    health.deadLast24h = 201;
    health.deadNotificationLast24h = 200;
    const assessment = assessBackgroundJobHealth(health, {
      requireWorkers: true,
    });
    expect(classifyBackgroundJobAlerts(assessment.warnings)).toMatchObject({
      level: 'alert',
      alerts: ['dead-jobs-last-24h'],
      warnings: ['dead-notification-jobs-last-24h'],
    });
  });

  it('dead jobs page the queue probe while keeping /ready available', () => {
    // 两个探针刻意分开：ready 只回答「能不能接流量」（deploy/update.sh 用它
    // 判发布成败），队列坏了由 /api/health/jobs 报。这条把配对钉死，防止
    // 后人把 dead-jobs 塞回 assess 的 available。
    const health = fixture();
    health.deadLast24h = 1;
    const assessment = assessBackgroundJobHealth(health, {
      requireWorkers: true,
    });
    expect(assessment.available).toBe(true);
    expect(classifyBackgroundJobAlerts(assessment.warnings)).toMatchObject({
      level: 'alert',
      alerts: ['dead-jobs-last-24h'],
    });
  });
});
