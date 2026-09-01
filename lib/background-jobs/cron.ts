import { BackgroundJobQueue, Prisma } from '../../generated/prisma/client';
import {
  runCsPeriodEndingTask,
  runCsSettleTask,
  runDailySalaryTask,
  runGenerateBillsTask,
  runHourlyPayrollTask,
  runOrderExportCleanupTask,
  runOrderOverdueTask,
  runOutsourceOverdueTask,
} from '../cron/tasks';
import { runPendingFactoryBacklogTask } from '../cron/pending-factory-backlog';
import { runProductionAlertNotificationTask } from '../notification/production-alerts';
import { enqueueBackgroundJob } from './repository';
import {
  BACKGROUND_JOB_TYPES,
  type BackgroundJobType,
  type ClaimedBackgroundJob,
} from './types';

const CRON_TYPES: ReadonlySet<string> = new Set([
  BACKGROUND_JOB_TYPES.CRON_DAILY_SALARY,
  BACKGROUND_JOB_TYPES.CRON_HOURLY_PAYROLL,
  BACKGROUND_JOB_TYPES.CRON_CS_SETTLE,
  BACKGROUND_JOB_TYPES.CRON_GENERATE_BILLS,
  BACKGROUND_JOB_TYPES.CRON_OUTSOURCE_OVERDUE,
  BACKGROUND_JOB_TYPES.CRON_CS_PERIOD_ENDING,
  BACKGROUND_JOB_TYPES.CRON_ORDER_OVERDUE,
  BACKGROUND_JOB_TYPES.CRON_PENDING_FACTORY_BACKLOG,
  BACKGROUND_JOB_TYPES.CRON_PRODUCTION_ALERTS,
  BACKGROUND_JOB_TYPES.CRON_ORDER_EXPORT_CLEANUP,
]);

export async function enqueueCronJob(input: {
  type: BackgroundJobType;
  scope: string;
  payload?: Prisma.InputJsonValue;
}): Promise<{ jobId: string; created: boolean; requeued: boolean }> {
  if (!CRON_TYPES.has(input.type)) throw new InvalidCronJobPayloadError();
  const { job, created, requeued } = await enqueueBackgroundJob({
    type: input.type,
    queue: BackgroundJobQueue.LIGHT,
    dedupeKey: `cron:${input.type}:${input.scope}`,
    payload: input.payload ?? {},
    priority: 150,
    maxAttempts: 4,
  });
  return { jobId: job.id, created, requeued };
}

export async function handleCronJob(
  job: ClaimedBackgroundJob,
): Promise<Prisma.InputJsonValue> {
  const payload = asRecord(job.payload);
  await job.assertLease?.();
  job.signal?.throwIfAborted();
  const fence = {
    ...(job.signal ? { signal: job.signal } : {}),
    ...(job.assertLease ? { assertLease: job.assertLease } : {}),
  };
  switch (job.type) {
    case BACKGROUND_JOB_TYPES.CRON_DAILY_SALARY:
      return runDailySalaryTask(requiredString(payload.date), fence);
    case BACKGROUND_JOB_TYPES.CRON_HOURLY_PAYROLL:
      return runHourlyPayrollTask(requiredString(payload.month), fence);
    case BACKGROUND_JOB_TYPES.CRON_CS_SETTLE:
      return runCsSettleTask(fence);
    case BACKGROUND_JOB_TYPES.CRON_GENERATE_BILLS:
      return runGenerateBillsTask(requiredString(payload.period), fence);
    case BACKGROUND_JOB_TYPES.CRON_OUTSOURCE_OVERDUE:
      return runOutsourceOverdueTask(requiredString(payload.runDate), fence);
    case BACKGROUND_JOB_TYPES.CRON_CS_PERIOD_ENDING:
      return runCsPeriodEndingTask(requiredString(payload.runDate), fence);
    case BACKGROUND_JOB_TYPES.CRON_ORDER_OVERDUE:
      return runOrderOverdueTask(requiredString(payload.runDate), fence);
    case BACKGROUND_JOB_TYPES.CRON_PENDING_FACTORY_BACKLOG:
      return runPendingFactoryBacklogTask(requiredString(payload.runDate), fence);
    case BACKGROUND_JOB_TYPES.CRON_PRODUCTION_ALERTS:
      return runProductionAlertNotificationTask(
        requiredString(payload.runDate),
        undefined,
        fence,
      );
    case BACKGROUND_JOB_TYPES.CRON_ORDER_EXPORT_CLEANUP:
      return runOrderExportCleanupTask(requiredString(payload.runDate), fence);
    default:
      throw new InvalidCronJobPayloadError();
  }
}

function asRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidCronJobPayloadError();
  }
  return value as Record<string, Prisma.JsonValue>;
}

function requiredString(value: Prisma.JsonValue | undefined): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidCronJobPayloadError();
  }
  return value;
}

export class InvalidCronJobPayloadError extends Error {
  constructor() {
    super('invalid cron background job payload');
    this.name = 'InvalidCronJobPayloadError';
  }
}
