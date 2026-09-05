import { BACKGROUND_JOB_TYPES } from './types';

export const NOTIFICATION_DELIVERY_UNKNOWN_ERROR_CODE =
  'NotificationDeliveryUnknownError';
export const NOTIFICATION_REPLAY_TERMINAL_ERROR_CODE =
  'NotificationReplayTerminalError';

type BackgroundJobTerminalIdentity = {
  type: string;
  lastErrorCode?: string | null;
};

/**
 * UNKNOWN is a deliberate do-not-resend state. Only the audited owner
 * resolution flow may move its owning notification job away from DEAD.
 */
export function backgroundJobRequiresOwnerResolution(
  job: BackgroundJobTerminalIdentity,
): boolean {
  return (
    job.type === BACKGROUND_JOB_TYPES.NOTIFICATION &&
    job.lastErrorCode === NOTIFICATION_DELIVERY_UNKNOWN_ERROR_CODE
  );
}

/** Notification failures that must terminate without consuming retry budget. */
export function isTerminalNotificationFailure(
  job: BackgroundJobTerminalIdentity,
): boolean {
  // A test can fail after the provider received it (ACK loss, log persistence,
  // or job completion failure). Only a fresh operator action may send again.
  if (job.type === BACKGROUND_JOB_TYPES.NOTIFICATION_CHANNEL_TEST) return true;
  return (
    job.type === BACKGROUND_JOB_TYPES.NOTIFICATION &&
    (job.lastErrorCode === NOTIFICATION_DELIVERY_UNKNOWN_ERROR_CODE ||
      job.lastErrorCode === NOTIFICATION_REPLAY_TERMINAL_ERROR_CODE)
  );
}
