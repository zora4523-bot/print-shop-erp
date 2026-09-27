import type { Prisma } from '../../generated/prisma/client';
import type { BackgroundJobQueue } from '../../generated/prisma/enums';

export const BACKGROUND_JOB_TYPES = {
  NOTIFICATION: 'NOTIFICATION',
  NOTIFICATION_CHANNEL_TEST: 'NOTIFICATION_CHANNEL_TEST',
  CRON_DAILY_SALARY: 'CRON_DAILY_SALARY',
  CRON_GENERATE_BILLS: 'CRON_GENERATE_BILLS',
  CRON_OUTSOURCE_OVERDUE: 'CRON_OUTSOURCE_OVERDUE',
  CRON_ORDER_OVERDUE: 'CRON_ORDER_OVERDUE',
  CRON_PENDING_FACTORY_BACKLOG: 'CRON_PENDING_FACTORY_BACKLOG',
  CRON_PRODUCTION_ALERTS: 'CRON_PRODUCTION_ALERTS',
  CRON_ORDER_EXPORT_CLEANUP: 'CRON_ORDER_EXPORT_CLEANUP',
  CDR_BUNDLE: 'CDR_BUNDLE',
  ORDER_PDF: 'ORDER_PDF',
  ORDER_BATCH_PDF: 'ORDER_BATCH_PDF',
  ORDER_EXPORT: 'ORDER_EXPORT',
  AGENT_MONTHLY_BILL_EXPORT: 'AGENT_MONTHLY_BILL_EXPORT',
} as const;

export type BackgroundJobType =
  (typeof BACKGROUND_JOB_TYPES)[keyof typeof BACKGROUND_JOB_TYPES];

const REGISTERED_BACKGROUND_JOB_TYPES: ReadonlySet<string> = new Set(
  Object.values(BACKGROUND_JOB_TYPES),
);

/**
 * 当前仍有处理器的任务类型（handlers.test 锁定处理器表与本字典一一对应）。
 * 已删除功能的历史任务（如 2026-09-24 删除的 CRON_HOURLY_PAYROLL /
 * CRON_CS_SETTLE / CRON_CS_PERIOD_ENDING）保留为运行记录，但不能再重试。
 */
export function isRegisteredBackgroundJobType(
  type: string,
): type is BackgroundJobType {
  return REGISTERED_BACKGROUND_JOB_TYPES.has(type);
}

export type EnqueueBackgroundJobInput = {
  type: BackgroundJobType;
  queue: BackgroundJobQueue;
  dedupeKey: string;
  payload: Prisma.InputJsonValue;
  priority?: number;
  maxAttempts?: number;
  availableAt?: Date;
};

export type ClaimedBackgroundJob = {
  id: string;
  type: string;
  queue: BackgroundJobQueue;
  dedupeKey: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
  workerId: string;
  claimedAt: Date;
  /** Aborted as soon as this worker can no longer prove lease ownership. */
  signal?: AbortSignal;
  /**
   * Refreshes and verifies the fencing tuple (id, workerId, attempt). Handlers
   * call this immediately before irreversible external I/O.
   */
  assertLease?: () => Promise<void>;
};

export type BackgroundJobResult = Prisma.InputJsonValue | undefined;
