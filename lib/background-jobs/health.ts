import {
  BackgroundJobQueue,
  BackgroundJobStatus,
  NotificationChannelTransport,
  SmartBotConnectionStatus,
  type SmartBotConnectionStatus as SmartBotConnectionStatusType,
} from '../../generated/prisma/enums';
import { databaseNow } from './clock';
import { WORKER_HEARTBEAT_ACTIVE_WINDOW_MS } from './heartbeat-policy';
import { db } from '../db';
import { BACKGROUND_JOB_TYPES } from './types';

export type BackgroundJobHealth = {
  /** 本次健康快照的数据库时钟锚点。 */
  observedAt: Date;
  activeWorkers: Array<{
    queue: BackgroundJobQueue;
    version: string;
    smartBotStatus: SmartBotConnectionStatusType | null;
    smartBotBotDigest: string | null;
    lastSeenAt: Date;
  }>;
  /** Active smart-bot destinations; hashes stay internal and are never returned by health routes. */
  activeSmartBotChannels: Array<{
    smartBotBotDigest: string | null;
    smartBotTargetId: string | null;
    smartBotChatType: 'SINGLE' | 'GROUP' | null;
    smartBotBoundAt: Date | null;
  }>;
  pending: Record<BackgroundJobQueue, number>;
  oldestPendingAt: Record<BackgroundJobQueue, Date | null>;
  running: number;
  staleRunning: number;
  /** 24h 内所有类型的死信总数（对外响应体的既有字段，含通知）。 */
  deadLast24h: number;
  /**
   * 其中属于通知投递或通道测试的部分。单独拆出来是因为这两类死信的处置方式
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
  // The shared window is based on the largest accepted interval, not only the
  // 15s default. Thus a valid 60s cadence cannot disappear between two beats.
  const workerCutoff = new Date(
    at.getTime() - WORKER_HEARTBEAT_ACTIVE_WINDOW_MS,
  );
  const staleCutoff = new Date(at.getTime() - 6 * 60_000);
  const dayCutoff = new Date(at.getTime() - 24 * 60 * 60_000);

  const [
    workers,
    activeSmartBotChannels,
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
      select: {
        queue: true,
        version: true,
        smartBotStatus: true,
        smartBotBotDigest: true,
        lastSeenAt: true,
      },
      orderBy: { lastSeenAt: 'desc' },
    }),
    db.notificationChannel.findMany({
      where: {
        transport: NotificationChannelTransport.WECOM_SMART_BOT,
        isActive: true,
      },
      select: {
        smartBotBotDigest: true,
        smartBotTargetId: true,
        smartBotChatType: true,
        smartBotBoundAt: true,
      },
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
          WHERE "type" IN (
            ${BACKGROUND_JOB_TYPES.NOTIFICATION},
            ${BACKGROUND_JOB_TYPES.NOTIFICATION_CHANNEL_TEST}
          )
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
    activeSmartBotChannels,
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

export type SmartBotConnectionHealth = {
  /** null means no current-version LIGHT heartbeat reported a connection state. */
  status: SmartBotConnectionStatusType | null;
  lastSeenAt: Date | null;
};

export type SmartBotOperationalHealth = {
  /** At least one active destination depends on the long-lived connector. */
  required: boolean;
  /** Active destination rows contain a complete immutable binding. */
  configurationValid: boolean;
  /** Web, current-version LIGHT worker(s), and active destinations pin one Bot ID. */
  identityMatch: boolean | null;
  /** A single matching current-version LIGHT worker is connected and owns the bot. */
  operational: boolean;
};

function activeLightWorkers(
  health: BackgroundJobHealth,
  expectedVersion?: string,
): BackgroundJobHealth['activeWorkers'] {
  return health.activeWorkers.filter(
    (worker) =>
      worker.queue === BackgroundJobQueue.LIGHT &&
      (!expectedVersion || worker.version === expectedVersion),
  );
}

/**
 * Relative wait until all but the newest LIGHT heartbeat could expire if the
 * others stop refreshing. This is only a bounded observation hint, never proof
 * that another worker is dead. No worker identity or timestamp leaves the API.
 */
export function smartBotRecoveryWaitMs(health: BackgroundJobHealth): number {
  const seen = activeLightWorkers(health)
    .map((worker) => worker.lastSeenAt.getTime())
    .sort((left, right) => right - left);
  const extraHeartbeat = seen[1];
  if (extraHeartbeat === undefined) return 0;
  return Math.max(0, Math.min(
    WORKER_HEARTBEAT_ACTIVE_WINDOW_MS,
    extraHeartbeat + WORKER_HEARTBEAT_ACTIVE_WINDOW_MS - health.observedAt.getTime(),
  ));
}

const SMART_BOT_STATUS_PRIORITY: readonly SmartBotConnectionStatusType[] = [
  SmartBotConnectionStatus.CONNECTION_CONFLICT,
  SmartBotConnectionStatus.AUTH_FAILED,
  SmartBotConnectionStatus.DISCONNECTED,
  SmartBotConnectionStatus.CONNECTING,
  SmartBotConnectionStatus.CONNECTED,
  SmartBotConnectionStatus.NOT_CONFIGURED,
];

/**
 * Returns the most severe persisted connector state among active LIGHT
 * workers. A newer healthy heartbeat must not hide an older, still-active
 * AUTH_FAILED or CONNECTION_CONFLICT heartbeat. When a release version is
 * supplied, old-release workers are excluded from the summary.
 */
export function summarizeSmartBotConnection(
  health: BackgroundJobHealth,
  options: { expectedVersion?: string } = {},
): SmartBotConnectionHealth {
  const workers = activeLightWorkers(health, options.expectedVersion);
  const status = SMART_BOT_STATUS_PRIORITY.find((candidate) =>
    workers.some((worker) => worker.smartBotStatus === candidate),
  );
  const statusWorkers = status
    ? workers.filter((worker) => worker.smartBotStatus === status)
    : workers;
  const newestWorker = statusWorkers.reduce<
    BackgroundJobHealth['activeWorkers'][number] | undefined
  >(
    (newest, worker) =>
      !newest || worker.lastSeenAt > newest.lastSeenAt ? worker : newest,
    undefined,
  );

  return {
    status: status ?? null,
    lastSeenAt: newestWorker?.lastSeenAt ?? null,
  };
}

/**
 * Evaluates the connector against active smart-bot destinations without ever
 * exposing their target IDs or Bot ID digests through an anonymous endpoint.
 */
export function summarizeSmartBotOperationalHealth(
  health: BackgroundJobHealth,
  options: { expectedVersion?: string; expectedBotDigest: string | null },
): SmartBotOperationalHealth {
  const channels = health.activeSmartBotChannels;
  const required = channels.length > 0;
  if (!required) {
    return {
      required: false,
      configurationValid: true,
      identityMatch: null,
      operational: true,
    };
  }

  const configurationValid = channels.every(
    (channel) =>
      Boolean(channel.smartBotTargetId) &&
      Boolean(channel.smartBotChatType) &&
      Boolean(channel.smartBotBoundAt),
  );
  // Bot ownership is global across releases. An old-version worker with a
  // fresh heartbeat still owns/contends for the same single connection and
  // must prevent a new release from becoming operational.
  const workers = activeLightWorkers(health);
  const channelIdentityMatch =
    options.expectedBotDigest !== null &&
    channels.every(
      (channel) => channel.smartBotBotDigest === options.expectedBotDigest,
    );
  // No current-version heartbeat is an unknown startup state, not proof that
  // another Bot ID owns the connector. The deploy loop may wait for it; a
  // concrete channel/worker digest mismatch still fails immediately.
  const identityMatch = !channelIdentityMatch
    ? false
    : workers.length === 0
      ? null
      : workers.every(
          (worker) => worker.smartBotBotDigest === options.expectedBotDigest,
        );
  const operational =
    configurationValid &&
    identityMatch === true &&
    workers.length === 1 &&
    (!options.expectedVersion ||
      workers[0]?.version === options.expectedVersion) &&
    workers[0]?.smartBotStatus === SmartBotConnectionStatus.CONNECTED;

  return { required, configurationValid, identityMatch, operational };
}

export function assessBackgroundJobHealth(
  health: BackgroundJobHealth,
  options: {
    requireWorkers: boolean;
    expectedVersion?: string;
    expectedSmartBotDigest?: string | null;
  },
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
  // 死信按类型分成两条告警码。通知/通道测试死信**不**进 alerts：企业微信中断一次就
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

  const allLightWorkers = activeLightWorkers(health);
  const lightWorkers = activeLightWorkers(health, options.expectedVersion);
  if (allLightWorkers.length > 1) {
    warnings.push('duplicate-light-workers');
  }

  const smartBotStatuses = new Set(
    lightWorkers.map((worker) => worker.smartBotStatus),
  );
  if (smartBotStatuses.has(SmartBotConnectionStatus.AUTH_FAILED)) {
    warnings.push('smart-bot-auth-failed');
  }
  if (smartBotStatuses.has(SmartBotConnectionStatus.CONNECTION_CONFLICT)) {
    warnings.push('smart-bot-connection-conflict');
  }

  const smartBot = summarizeSmartBotConnection(health, {
    ...(options.expectedVersion
      ? { expectedVersion: options.expectedVersion }
      : {}),
  });
  const smartBotOperational = summarizeSmartBotOperationalHealth(health, {
    ...(options.expectedVersion
      ? { expectedVersion: options.expectedVersion }
      : {}),
    expectedBotDigest: options.expectedSmartBotDigest ?? null,
  });
  if (smartBotOperational.required) {
    if (!smartBotOperational.configurationValid) {
      warnings.push('smart-bot-channel-invalid');
    } else if (
      options.expectedSmartBotDigest === null ||
      options.expectedSmartBotDigest === undefined ||
      smartBot.status === SmartBotConnectionStatus.NOT_CONFIGURED
    ) {
      warnings.push('smart-bot-not-configured');
    } else if (smartBotOperational.identityMatch === false) {
      warnings.push('smart-bot-identity-mismatch');
    }
  }
  if (
    !smartBotStatuses.has(SmartBotConnectionStatus.AUTH_FAILED) &&
    !smartBotStatuses.has(SmartBotConnectionStatus.CONNECTION_CONFLICT)
  ) {
    switch (smartBot.status) {
      case SmartBotConnectionStatus.CONNECTING:
        warnings.push('smart-bot-connecting');
        break;
      case SmartBotConnectionStatus.DISCONNECTED:
        warnings.push('smart-bot-disconnected');
        break;
      default:
        break;
    }
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
//   - smart-bot-auth-failed：凭据不会自愈，需要轮换/核对 Secret 并重启
//     LIGHT worker。
//   - smart-bot-connection-conflict：同一 Bot ID 有另一条连接，需要收敛
//     LIGHT worker 实例数或排查外部连接所有者。
//   - duplicate-light-workers：同一发布版本有多个活跃 LIGHT 实例，会
//     争抢同一 Bot ID 的单连接所有权，需要收敛部署副本数。
//   - smart-bot-channel-invalid / smart-bot-not-configured /
//     smart-bot-identity-mismatch：已有启用目标依赖连接，但目标绑定、凭据
//     或 Web/worker Bot ID 身份无法形成同一条可投递链路。
//
// 留在 warnings（会自愈）：
//   - 积压年龄：忙一分钟就会涨、自己会退，拿它报警会把探针变成噪音源。
//   - dead-notification-jobs-last-24h：通知死信可能是**批量**的（一次企业微信
//     中断可以产出上百条），通道测试则是一次性、不可安全自动重试；
//     两者都没有队列侧的处置动作 —— 该看的是
//     /owner/notifications 的失败日志。让它进 alerts 会把队列探针钉在 503
//     上整整 24 小时，把真正需要 30 分钟响应的结算死信淹掉。
//   - smart-bot-connecting / smart-bot-disconnected：长连接会自动重连；对
//     Web ready 及后台任务队列只做可见降级。发布脚本另有有界观察窗口，
//     启用目标持续未连接时仍会拒绝解除停写保护。
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
      warning === 'dead-jobs-last-24h' ||
      warning === 'smart-bot-auth-failed' ||
      warning === 'smart-bot-connection-conflict' ||
      warning === 'duplicate-light-workers' ||
      warning === 'smart-bot-channel-invalid' ||
      warning === 'smart-bot-not-configured' ||
      warning === 'smart-bot-identity-mismatch'
  );
}

function ageMs(date: Date | null, now: Date): number | null {
  return date ? Math.max(0, now.getTime() - date.getTime()) : null;
}
