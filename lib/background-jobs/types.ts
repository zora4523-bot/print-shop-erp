import type { Prisma } from '../../generated/prisma/client';
import type { BackgroundJobQueue } from '../../generated/prisma/enums';

export const BACKGROUND_JOB_TYPES = {
  NOTIFICATION: 'NOTIFICATION',
  CRON_DAILY_SALARY: 'CRON_DAILY_SALARY',
  CRON_HOURLY_PAYROLL: 'CRON_HOURLY_PAYROLL',
  CRON_CS_SETTLE: 'CRON_CS_SETTLE',
  CRON_GENERATE_BILLS: 'CRON_GENERATE_BILLS',
  CRON_OUTSOURCE_OVERDUE: 'CRON_OUTSOURCE_OVERDUE',
  CRON_CS_PERIOD_ENDING: 'CRON_CS_PERIOD_ENDING',
  CRON_ORDER_OVERDUE: 'CRON_ORDER_OVERDUE',
  CDR_BUNDLE: 'CDR_BUNDLE',
  ORDER_PDF: 'ORDER_PDF',
} as const;

export type BackgroundJobType =
  (typeof BACKGROUND_JOB_TYPES)[keyof typeof BACKGROUND_JOB_TYPES];

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
};

export type BackgroundJobResult = Prisma.InputJsonValue | undefined;
