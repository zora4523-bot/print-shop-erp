import {
  BackgroundJobQueue,
  BackgroundJobStatus,
} from '../../generated/prisma/enums';
import { databaseNow } from './clock';
import { db } from '../db';
import { BACKGROUND_JOB_TYPES } from './types';

export type BackgroundJobHealth = {
  /** 本次健康快照的数据库时钟锚点。 */
  observedAt: Date;
  activeWorkers: Array<{
    queue: BackgroundJobQueue;
    version: string;
    lastSeenAt: Date;
  }>;
  pending: Record<BackgroundJobQueue, number>;
  oldestPendingAt: Record<BackgroundJobQueue, Date | null>;
  running: number;
  staleRunning: number;
  /** 24h 内所有类型的死信总数（对外响应体的既有字段，含通知）。 */
  deadLast24h: number;
  /**
   * 其中属于 NOTIFICATION 的部分。单独拆出来是因为这两类死信的处置方式
   * 完全不同：一条 CRON_DAILY_SALARY 死了要有人半小时内介入，而企业微信
   * 抖动一次就能一口气产出上百条通知死信（runOrderOverdueTask 单次上限
   * ORDER_OVERDUE_NOTIFY_CAP=200）。不拆的话，通知死信会把
   * /api/health/jobs 稳定按在 503 上 24 小时，真正的结算失败反而淹在里面。
   */
  deadNotificationLast24h: number;
};

type DeadCountsRow = {
  deadLast24h: number;
  deadNotificationLast24h: number;
};

export async function getBackgroundJobHealth(): Promise<BackgroundJobHealth> {
  // heartbeatAt / lockedAt / lastSeenAt 全部由 worker 进程写入，可能在另一台
  // 机器上。用本 web 进程的 Node 时钟推截止点，两边一漂就把活着的 worker
  // 报成 missing，/api/health/ready 随之变 error。
  const at = await databaseNow();
  const workerCutoff = new Date(at.getTime() - 45_000);
  const staleCutoff = new Date(at.getTime() - 6 * 60_000);
  const dayCutoff = new Date(at.getTime() - 24 * 60 * 60_000);

  const [
    workers,
    lightPending,
    heavyPending,
    lightOldest,
    heavyOldest,
    running,
    staleRunning,
    deadCounts,
  ] = await Promise.all([
    db.backgroundWorkerHeartbeat.findMany({
      where: { lastSeenAt: { gte: workerCutoff } },
      select: { queue: true, version: true, lastSeenAt: true },
      orderBy: { lastSeenAt: 'desc' },
    }),
    db.backgroundJob.count({
      where: {
        queue: BackgroundJobQueue.LIGHT,
        status: BackgroundJobStatus.PENDING,
        availableAt: { lte: at },
      },
    }),
    db.backgroundJob.count({
      where: {
        queue: BackgroundJobQueue.HEAVY,
        status: BackgroundJobStatus.PENDING,
        availableAt: { lte: at },
      },
    }),
    db.backgroundJob.findFirst({
      where: {
        queue: BackgroundJobQueue.LIGHT,
        status: BackgroundJobStatus.PENDING,
        availableAt: { lte: at },
      },
      select: { availableAt: true },
      orderBy: { availableAt: 'asc' },
    }),
    db.backgroundJob.findFirst({
      where: {
        queue: BackgroundJobQueue.HEAVY,
        status: BackgroundJobStatus.PENDING,
        availableAt: { lte: at },
      },
      select: { availableAt: true },
      orderBy: { availableAt: 'asc' },
    }),
    db.backgroundJob.count({ where: { status: BackgroundJobStatus.RUNNING } }),
    db.backgroundJob.count({
      where: {
        status: BackgroundJobStatus.RUNNING,
        OR: [
          { heartbeatAt: { lt: staleCutoff } },
          { heartbeatAt: null, lockedAt: { lt: staleCutoff } },
        ],
      },
    }),
    db.$queryRaw<DeadCountsRow[]>`
      SELECT
        count(*)::integer AS "deadLast24h",
        count(*) FILTER (
          WHERE "type" = ${BACKGROUND_JOB_TYPES.NOTIFICATION}
        )::integer AS "deadNotificationLast24h"
      FROM "BackgroundJob"
      WHERE "status" = ${BackgroundJobStatus.DEAD}::"BackgroundJobStatus"
        AND "finishedAt" >= ${dayCutoff}
    `,
  ]);

  const deadCount = deadCounts[0];
  if (!deadCount) {
    throw new Error('background job health: dead counts unavailable');
  }

  return {
    observedAt: at,
    activeWorkers: workers,
    pending: {
      [BackgroundJobQueue.LIGHT]: lightPending,
      [BackgroundJobQueue.HEAVY]: heavyPending,
    },
    oldestPendingAt: {
      [BackgroundJobQueue.LIGHT]: lightOldest?.availableAt ?? null,
      [BackgroundJobQueue.HEAVY]: heavyOldest?.availableAt ?? null,
    },
    running,
    staleRunning,
    deadLast24h: deadCount.deadLast24h,
    deadNotificationLast24h: deadCount.deadNotificationLast24h,
  };
}

export function assessBackgroundJobHealth(
  health: BackgroundJobHealth,
  options: { requireWorkers: boolean; expectedVersion?: string },
): { available: boolean; status: 'ok' | 'degraded' | 'error'; warnings: string[] } {
  const warnings: string[] = [];
  if (options.requireWorkers) {
    for (const queue of [BackgroundJobQueue.LIGHT, BackgroundJobQueue.HEAVY]) {
      const workers = health.activeWorkers.filter((worker) => worker.queue === queue);
      if (workers.length === 0) {
        warnings.push(`${queue.toLowerCase()}-worker-missing`);
      } else if (
        options.expectedVersion &&
        !workers.some((worker) => worker.version === options.expectedVersion)
      ) {
        warnings.push(`${queue.toLowerCase()}-worker-version-mismatch`);
      }
    }
  }
  if (health.staleRunning > 0) warnings.push('stale-running-jobs');
  // 死信按类型分成两条告警码。通知死信**不**进 alerts：企业微信中断一次就
  // 能产出上百条，让它把 /api/health/jobs 打成 503 等于用一次第三方抖动掩盖
  // 掉当天真正的结算失败。通知的处置渠道是 /owner/notifications 的
  // NotificationLog(FAILED) 与首页 24h 失败告警条，不是队列探针。
  const deadOther = Math.max(
    0,
    health.deadLast24h - health.deadNotificationLast24h,
  );
  if (deadOther > 0) warnings.push('dead-jobs-last-24h');
  if (health.deadNotificationLast24h > 0) {
    warnings.push('dead-notification-jobs-last-24h');
  }

  const lightAge = ageMs(health.oldestPendingAt.LIGHT, health.observedAt);
  const heavyAge = ageMs(health.oldestPendingAt.HEAVY, health.observedAt);
  if (lightAge !== null && lightAge > 5 * 60_000) warnings.push('light-backlog-old');
  if (heavyAge !== null && heavyAge > 15 * 60_000) warnings.push('heavy-backlog-old');

  // `available` 刻意比告警口径窄：它是 /api/health/ready 状态码的唯一
  // 依据，而 deploy/update.sh 第 9 步把 ready 非 200 当成「发布失败」
  // （随后让 Web + 两个 worker 保持停止并禁止回滚），
  // scripts/deploy-smoke.mjs 也硬要求 200。所以这里只放「这个实例不该
  // 接流量」的条件。队列本身坏了（死信、卡死的 RUNNING）由
  // classifyBackgroundJobAlerts 在 /api/health/jobs 上报，不要挪进来。
  const available = !warnings.some(
    (warning) =>
      warning.endsWith('worker-missing') ||
      warning.endsWith('worker-version-mismatch'),
  );
  return {
    available,
    status: !available ? 'error' : warnings.length ? 'degraded' : 'ok',
    warnings,
  };
}

export type BackgroundJobAlertLevel = 'ok' | 'degraded' | 'alert';

export type BackgroundJobAlertReport = {
  /** 'alert' 表示必须有人处理，对应 jobs 探针的非 200。 */
  level: BackgroundJobAlertLevel;
  alerts: string[];
  warnings: string[];
};

// 把 assessBackgroundJobHealth 的 warnings 分成「有人必须处理」和「盯着就行」。
//
// 进 alerts（不会自愈）：
//   - *-worker-missing / *-worker-version-mismatch：该队列没有当前版本的
//     worker，队列不会被消费。
//   - stale-running-jobs：任务心跳已超过 getBackgroundJobHealth 里的 6 分钟
//     cutoff，而 worker 默认租约是 5 分钟、每 leaseMs/3 心跳一次
//     （lib/background-jobs/worker.ts）。即租约早已过期却没被回收。
//   - dead-jobs-last-24h：重试预算已耗尽（按类型 2~5 次），除非有人在
//     /owner/background-jobs 上手动补尝试，否则它永远不动。
//
// 留在 warnings（会自愈）：
//   - 积压年龄：忙一分钟就会涨、自己会退，拿它报警会把探针变成噪音源。
//   - dead-notification-jobs-last-24h：通知死信是**批量**的（一次企业微信
//     中断可以产出上百条），且没有队列侧的处置动作 —— 该看的是
//     /owner/notifications 的失败日志。让它进 alerts 会把队列探针钉在 503
//     上整整 24 小时，把真正需要 30 分钟响应的结算死信淹掉。
export function classifyBackgroundJobAlerts(
  warnings: readonly string[],
): BackgroundJobAlertReport {
  const alerts = warnings.filter(isActionableBackgroundJobWarning);
  const rest = warnings.filter(
    (warning) => !isActionableBackgroundJobWarning(warning),
  );
  return {
    level: alerts.length ? 'alert' : rest.length ? 'degraded' : 'ok',
    alerts,
    warnings: rest,
  };
}

function isActionableBackgroundJobWarning(warning: string): boolean {
  return (
    warning.endsWith('worker-missing') ||
    warning.endsWith('worker-version-mismatch') ||
    warning === 'stale-running-jobs' ||
    warning === 'dead-jobs-last-24h'
  );
}

function ageMs(date: Date | null, now: Date): number | null {
  return date ? Math.max(0, now.getTime() - date.getTime()) : null;
}
