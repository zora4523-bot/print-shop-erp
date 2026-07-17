import { handleCdrBundleJob } from './cdr';
import { handleCronJob } from './cron';
import { handleNotificationJob } from './notification';
import { handleOrderPdfJob } from './pdf';
import { BACKGROUND_JOB_TYPES } from './types';
import type { BackgroundJobHandlers } from './worker';

export const backgroundJobHandlers: BackgroundJobHandlers = {
  [BACKGROUND_JOB_TYPES.NOTIFICATION]: handleNotificationJob,
  [BACKGROUND_JOB_TYPES.CRON_DAILY_SALARY]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_HOURLY_PAYROLL]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_CS_SETTLE]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_GENERATE_BILLS]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_OUTSOURCE_OVERDUE]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_CS_PERIOD_ENDING]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_ORDER_OVERDUE]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CDR_BUNDLE]: handleCdrBundleJob,
  [BACKGROUND_JOB_TYPES.ORDER_PDF]: handleOrderPdfJob,
};
