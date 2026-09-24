import { handleCronJob } from './cron';
import { handleNotificationJob } from './notification';
import { handleNotificationChannelTestJob } from './notification-channel-test';
import { BACKGROUND_JOB_TYPES } from './types';
import type { BackgroundJobHandlers } from './worker';

// Keep LIGHT-only imports out of the HEAVY worker process. Notification
// delivery intentionally imports `server-only`, which direct Node workers
// resolve with the React Server condition; PDF rendering cannot use that
// condition because it needs the normal `react-dom/server` export.
export const lightBackgroundJobHandlers: BackgroundJobHandlers = {
  [BACKGROUND_JOB_TYPES.NOTIFICATION]: handleNotificationJob,
  [BACKGROUND_JOB_TYPES.NOTIFICATION_CHANNEL_TEST]:
    handleNotificationChannelTestJob,
  [BACKGROUND_JOB_TYPES.CRON_DAILY_SALARY]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_CS_SETTLE]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_GENERATE_BILLS]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_OUTSOURCE_OVERDUE]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_CS_PERIOD_ENDING]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_ORDER_OVERDUE]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_PENDING_FACTORY_BACKLOG]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_PRODUCTION_ALERTS]: handleCronJob,
  [BACKGROUND_JOB_TYPES.CRON_ORDER_EXPORT_CLEANUP]: handleCronJob,
};
