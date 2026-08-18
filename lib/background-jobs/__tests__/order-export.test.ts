import { beforeEach, describe, expect, it, vi } from 'vitest';

const { processQueuedOrderExportMock } = vi.hoisted(() => ({
  processQueuedOrderExportMock: vi.fn(),
}));

vi.mock('@/lib/order/export', () => ({
  processQueuedOrderExport: processQueuedOrderExportMock,
}));

import { BackgroundJobQueue } from '../../../generated/prisma/enums';
import {
  handleOrderExportJob,
  InvalidOrderExportJobPayloadError,
  OrderExportQueueMismatchError,
} from '../order-export';
import type { ClaimedBackgroundJob } from '../types';

function job(payload: ClaimedBackgroundJob['payload']): ClaimedBackgroundJob {
  return {
    id: 'job-export-1',
    type: 'ORDER_EXPORT',
    queue: BackgroundJobQueue.HEAVY,
    dedupeKey: 'order-export:export-1',
    payload,
    attempts: 1,
    maxAttempts: 3,
    workerId: 'heavy-worker:1',
    claimedAt: new Date('2026-08-07T09:00:00Z'),
  };
}

beforeEach(() => {
  processQueuedOrderExportMock.mockReset();
});

describe('handleOrderExportJob', () => {
  it('processes the export id carried by a HEAVY job', async () => {
    const result = {
      exportId: 'export-1',
      matchedOrderCount: 12,
      artifactName: 'export-1.xlsx',
    };
    processQueuedOrderExportMock.mockResolvedValue(result);

    await expect(
      handleOrderExportJob(job({ exportId: 'export-1' })),
    ).resolves.toEqual(result);
    expect(processQueuedOrderExportMock).toHaveBeenCalledExactlyOnceWith(
      'export-1',
    );
  });

  it.each([
    null,
    [],
    {},
    { exportId: '' },
    { exportId: 42 },
  ])('rejects an invalid payload without starting an export: %j', async (payload) => {
    await expect(
      handleOrderExportJob(job(payload)),
    ).rejects.toBeInstanceOf(InvalidOrderExportJobPayloadError);
    expect(processQueuedOrderExportMock).not.toHaveBeenCalled();
  });

  it('refuses to run export work on the LIGHT worker', async () => {
    const lightJob = {
      ...job({ exportId: 'export-1' }),
      queue: BackgroundJobQueue.LIGHT,
    };

    await expect(handleOrderExportJob(lightJob)).rejects.toBeInstanceOf(
      OrderExportQueueMismatchError,
    );
    expect(processQueuedOrderExportMock).not.toHaveBeenCalled();
  });
});
