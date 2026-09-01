import {
  sanitizeNotificationPayload,
  type NotificationEvent,
  type NotificationPayloadFor,
} from './events';
import { backgroundJobsMode } from '../background-jobs/mode';
import type { EnqueueClient } from '../background-jobs/repository';

/**
 * Writes the notification job with the business mutation when production is
 * in durable mode. A false result tells the caller to use the post-commit
 * inline dispatcher in dev/test; it must never be treated as an enqueue error.
 */
export async function enqueueNotificationInTransaction<
  E extends NotificationEvent,
>(
  client: EnqueueClient,
  event: E,
  payload: NotificationPayloadFor<E>,
  options: { dedupeKey?: string; spreadIndex?: number } = {},
): Promise<boolean> {
  if (backgroundJobsMode() !== 'durable') return false;
  const { enqueueNotificationJob } = await import(
    '../background-jobs/notification'
  );
  await enqueueNotificationJob(
    event,
    sanitizeNotificationPayload(event, payload),
    options,
    client,
  );
  return true;
}
