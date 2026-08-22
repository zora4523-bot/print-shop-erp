import {
  BackgroundJobQueue,
  Prisma,
} from '../../generated/prisma/client';
import { processQueuedOrderExport } from '@/lib/order/export';
import type { ClaimedBackgroundJob } from './types';

export async function handleOrderExportJob(
  job: ClaimedBackgroundJob,
): Promise<Prisma.InputJsonValue> {
  if (job.queue !== BackgroundJobQueue.HEAVY) {
    throw new OrderExportQueueMismatchError();
  }
  const payload = asRecord(job.payload);
  const exportId = payload.exportId;
  if (typeof exportId !== 'string' || exportId.length === 0) {
    throw new InvalidOrderExportJobPayloadError();
  }

  return processQueuedOrderExport(exportId);
}

function asRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidOrderExportJobPayloadError();
  }
  return value as Record<string, Prisma.JsonValue>;
}

export class InvalidOrderExportJobPayloadError extends Error {
  constructor() {
    super('invalid order export background job payload');
    this.name = 'InvalidOrderExportJobPayloadError';
  }
}

export class OrderExportQueueMismatchError extends Error {
  constructor() {
    super('order export background jobs must run on the HEAVY queue');
    this.name = 'OrderExportQueueMismatchError';
  }
}
