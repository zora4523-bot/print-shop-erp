import { BackgroundJobStatus } from '../../generated/prisma/enums';
import { backgroundJobRequiresOwnerResolution } from './terminal-policy';
import { isNotificationEvent } from '../notification/events';
import { BACKGROUND_JOB_TYPES, isRegisteredBackgroundJobType } from './types';

export type BackgroundJobOperatorAction =
  | 'RETRY'
  | 'CANCEL'
  | 'REQUEST_NEW_EXPORT'
  | 'RESOLVE_NOTIFICATION'
  | 'NONE';

export function backgroundJobOperatorAction(job: {
  type: string;
  status: BackgroundJobStatus;
  lastErrorCode?: string | null;
  /** NOTIFICATION 任务 payload 里的事件名（listBackgroundJobs 提取）。 */
  notificationEvent?: string | null;
}): BackgroundJobOperatorAction {
  if (job.status === BackgroundJobStatus.DEAD) {
    if (!isRegisteredBackgroundJobType(job.type)) {
      // The handler was removed with its feature. Re-queueing can only fail
      // again with UnknownBackgroundJobTypeError; keep the row as history.
      return 'NONE';
    }
    if (
      job.type === BACKGROUND_JOB_TYPES.NOTIFICATION &&
      typeof job.notificationEvent === 'string' &&
      !isNotificationEvent(job.notificationEvent) &&
      !backgroundJobRequiresOwnerResolution(job)
    ) {
      // Retired event: the handler rejects its payload. An UNKNOWN delivery
      // still goes to the notification log so it can be confirmed / ignored.
      return 'NONE';
    }
    if (job.type === BACKGROUND_JOB_TYPES.NOTIFICATION_CHANNEL_TEST) {
      // Test sends have no provider idempotency key. If their ACK was lost,
      // retrying the same job can duplicate the message; inspect the group/log
      // and press Test again only after making that explicit decision.
      return 'NONE';
    }
    if (backgroundJobRequiresOwnerResolution(job)) {
      // Retrying the job alone cannot reopen a monotonic UNKNOWN delivery row;
      // it only burns attempts and returns to DEAD. The notification log owns
      // the explicit delivered / confirmed-not-delivered resolution workflow.
      return 'RESOLVE_NOTIFICATION';
    }
    return job.type === BACKGROUND_JOB_TYPES.ORDER_EXPORT ||
      job.type === BACKGROUND_JOB_TYPES.AGENT_MONTHLY_BILL_EXPORT
      ? 'REQUEST_NEW_EXPORT'
      : 'RETRY';
  }
  if (job.status === BackgroundJobStatus.PENDING) return 'CANCEL';
  return 'NONE';
}
