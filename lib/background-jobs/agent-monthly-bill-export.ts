import { BackgroundJobQueue, Prisma } from '../../generated/prisma/client';
import { processQueuedAgentMonthlyBillExport } from '../agent-monthly-billing/export';
import type { ClaimedBackgroundJob } from './types';

export async function handleAgentMonthlyBillExportJob(
  job: ClaimedBackgroundJob,
): Promise<Prisma.InputJsonValue> {
  if (job.queue !== BackgroundJobQueue.HEAVY) {
    throw new AgentMonthlyBillExportQueueMismatchError();
  }
  const payload = asRecord(job.payload);
  const exportId = payload.exportId;
  if (typeof exportId !== 'string' || exportId.length === 0) {
    throw new InvalidAgentMonthlyBillExportJobPayloadError();
  }
  return job.signal || job.assertLease
    ? processQueuedAgentMonthlyBillExport(exportId, {
        ...(job.signal ? { signal: job.signal } : {}),
        ...(job.assertLease ? { assertLease: job.assertLease } : {}),
      })
    : processQueuedAgentMonthlyBillExport(exportId);
}

function asRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidAgentMonthlyBillExportJobPayloadError();
  }
  return value as Record<string, Prisma.JsonValue>;
}

export class InvalidAgentMonthlyBillExportJobPayloadError extends Error {
  constructor() {
    super('invalid agent monthly bill export background job payload');
    this.name = 'InvalidAgentMonthlyBillExportJobPayloadError';
  }
}

export class AgentMonthlyBillExportQueueMismatchError extends Error {
  constructor() {
    super('agent monthly bill exports must run on the HEAVY queue');
    this.name = 'AgentMonthlyBillExportQueueMismatchError';
  }
}
