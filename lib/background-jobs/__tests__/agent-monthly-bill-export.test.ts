import { beforeEach, describe, expect, it, vi } from 'vitest';

const { processExportMock } = vi.hoisted(() => ({
  processExportMock: vi.fn(),
}));

vi.mock('@/lib/agent-monthly-billing/export', () => ({
  processQueuedAgentMonthlyBillExport: processExportMock,
}));

import { BackgroundJobQueue } from '../../../generated/prisma/enums';
import {
  AgentMonthlyBillExportQueueMismatchError,
  handleAgentMonthlyBillExportJob,
  InvalidAgentMonthlyBillExportJobPayloadError,
} from '../agent-monthly-bill-export';
import type { ClaimedBackgroundJob } from '../types';
import { backgroundJobTypeLabel } from '../labels';

function job(payload: ClaimedBackgroundJob['payload']): ClaimedBackgroundJob {
  return {
    id: 'job-export-1',
    type: 'AGENT_MONTHLY_BILL_EXPORT',
    queue: BackgroundJobQueue.HEAVY,
    dedupeKey: 'agent-monthly-bill-export:export-1',
    payload,
    attempts: 1,
    maxAttempts: 3,
    workerId: 'heavy-worker:1',
    claimedAt: new Date('2026-09-02T08:00:00Z'),
  };
}

beforeEach(() => processExportMock.mockReset());

describe('handleAgentMonthlyBillExportJob', () => {
  it('registers a business-facing operator label', () => {
    expect(backgroundJobTypeLabel('AGENT_MONTHLY_BILL_EXPORT')).toBe(
      '导出代理商月账单',
    );
  });

  it('runs a valid payload only on the HEAVY queue', async () => {
    processExportMock.mockResolvedValue({ exportId: 'export-1' });
    await expect(
      handleAgentMonthlyBillExportJob(job({ exportId: 'export-1' })),
    ).resolves.toEqual({ exportId: 'export-1' });
    expect(processExportMock).toHaveBeenCalledExactlyOnceWith('export-1');
  });

  it.each([null, [], {}, { exportId: '' }, { exportId: 42 }])(
    'rejects an invalid payload: %j',
    async (payload) => {
      await expect(
        handleAgentMonthlyBillExportJob(job(payload)),
      ).rejects.toBeInstanceOf(InvalidAgentMonthlyBillExportJobPayloadError);
      expect(processExportMock).not.toHaveBeenCalled();
    },
  );

  it('rejects execution on the LIGHT queue', async () => {
    await expect(
      handleAgentMonthlyBillExportJob({
        ...job({ exportId: 'export-1' }),
        queue: BackgroundJobQueue.LIGHT,
      }),
    ).rejects.toBeInstanceOf(AgentMonthlyBillExportQueueMismatchError);
    expect(processExportMock).not.toHaveBeenCalled();
  });

  it('passes worker fencing controls to the domain', async () => {
    processExportMock.mockResolvedValue({ exportId: 'export-1' });
    const signal = new AbortController().signal;
    const assertLease = vi.fn();

    await handleAgentMonthlyBillExportJob({
      ...job({ exportId: 'export-1' }),
      signal,
      assertLease,
    });

    expect(processExportMock).toHaveBeenCalledWith('export-1', {
      signal,
      assertLease,
    });
  });
});
