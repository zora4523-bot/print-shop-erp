import { Prisma } from '../../generated/prisma/client';
import { testChannel } from '../notification/test-channel';
import type { ClaimedBackgroundJob } from './types';

export async function handleNotificationChannelTestJob(
  job: ClaimedBackgroundJob,
): Promise<Prisma.InputJsonValue> {
  const payload = job.payload;
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    typeof payload.channelId !== 'string' ||
    !payload.channelId
  ) {
    throw new InvalidNotificationChannelTestPayloadError();
  }

  const outcome = await testChannel(payload.channelId, {
    runInWorker: true,
    ...(job.signal ? { signal: job.signal } : {}),
    ...(job.assertLease ? { assertLease: job.assertLease } : {}),
  });
  if (!outcome.ok) {
    throw new NotificationChannelTestDeliveryError();
  }
  return { delivered: true, mock: outcome.mock };
}

export class InvalidNotificationChannelTestPayloadError extends Error {
  constructor() {
    super('invalid notification channel test payload');
    this.name = 'InvalidNotificationChannelTestPayloadError';
  }
}

export class NotificationChannelTestDeliveryError extends Error {
  constructor() {
    // Provider text is deliberately not copied into the job error. The
    // redacted result remains in NotificationLog for the authorized owner.
    super('notification channel test delivery failed');
    this.name = 'NotificationChannelTestDeliveryError';
  }
}
