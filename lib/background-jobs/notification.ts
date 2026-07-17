import { randomUUID } from 'node:crypto';
import { BackgroundJobQueue, Prisma } from '../../generated/prisma/client';
import {
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  type NotificationPayloadFor,
} from '../notification/events';
import { notify } from '../notification/notify';
import { enqueueBackgroundJob } from './repository';
import { BACKGROUND_JOB_TYPES, type ClaimedBackgroundJob } from './types';

const EVENT_SET: ReadonlySet<string> = new Set(
  Object.values(NOTIFICATION_EVENTS),
);

export async function enqueueNotificationJob<E extends NotificationEvent>(
  event: E,
  payload: NotificationPayloadFor<E>,
  options: { dedupeKey?: string } = {},
): Promise<{ jobId: string; created: boolean }> {
  const body = JSON.parse(JSON.stringify({ event, payload })) as Prisma.InputJsonValue;
  const { job, created } = await enqueueBackgroundJob({
    type: BACKGROUND_JOB_TYPES.NOTIFICATION,
    queue: BackgroundJobQueue.LIGHT,
    dedupeKey:
      options.dedupeKey ?? `notification:${event}:${randomUUID()}`,
    payload: body,
    maxAttempts: 5,
    priority: 200,
  });
  return { jobId: job.id, created };
}

export async function handleNotificationJob(
  job: ClaimedBackgroundJob,
): Promise<Prisma.InputJsonValue> {
  const body = asRecord(job.payload);
  const event = body.event;
  const payload = body.payload;
  if (
    typeof event !== 'string' ||
    !EVENT_SET.has(event) ||
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw new InvalidNotificationJobPayloadError();
  }

  await notify(
    event as NotificationEvent,
    payload as NotificationPayloadFor<NotificationEvent>,
  );
  return { event };
}

function asRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidNotificationJobPayloadError();
  }
  return value as Record<string, Prisma.JsonValue>;
}

export class InvalidNotificationJobPayloadError extends Error {
  constructor() {
    super('invalid notification background job payload');
    this.name = 'InvalidNotificationJobPayloadError';
  }
}
