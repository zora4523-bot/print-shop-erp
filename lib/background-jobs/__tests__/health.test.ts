import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));
import { BackgroundJobQueue } from '../../../generated/prisma/enums';
import {
  assessBackgroundJobHealth,
  classifyBackgroundJobAlerts,
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
      { queue: BackgroundJobQueue.LIGHT, version: 'v1', lastSeenAt: now },
      { queue: BackgroundJobQueue.HEAVY, version: 'v1', lastSeenAt: now },
    ],
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
