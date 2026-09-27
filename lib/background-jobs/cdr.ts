import { Prisma } from '../../generated/prisma/client';
import {
  processQueuedBundle,
} from '../cdr/bundle';
import type { ClaimedBackgroundJob } from './types';

export async function handleCdrBundleJob(
  job: ClaimedBackgroundJob,
): Promise<Prisma.InputJsonValue> {
  const payload = asRecord(job.payload);
  const bundleId = payload.bundleId;
  if (typeof bundleId !== 'string' || bundleId.length === 0) {
    throw new InvalidCdrBundleJobPayloadError();
  }

  return processQueuedBundle(bundleId, {
    ...(job.signal ? { signal: job.signal } : {}),
    ...(job.assertLease ? { assertLease: job.assertLease } : {}),
  });
}

function asRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidCdrBundleJobPayloadError();
  }
  return value as Record<string, Prisma.JsonValue>;
}

export class InvalidCdrBundleJobPayloadError extends Error {
  constructor() {
    super('invalid CDR bundle background job payload');
    this.name = 'InvalidCdrBundleJobPayloadError';
  }
}
