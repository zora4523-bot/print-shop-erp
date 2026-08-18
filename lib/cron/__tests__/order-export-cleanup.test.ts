import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cleanupExpiredMock, scrubTerminalMock } = vi.hoisted(() => ({
  cleanupExpiredMock: vi.fn(),
  scrubTerminalMock: vi.fn(),
}));

vi.mock('@/lib/bill', () => ({
  BillGenerationUnexpectedError: class extends Error {},
  generateBillsForPeriod: vi.fn(),
}));
vi.mock('@/lib/dashboard/owner-watchlist', () => ({
  getDueOrders: vi.fn(),
  getEndingPeriods: vi.fn(),
  getOverdueOutsourcing: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: { user: { findMany: vi.fn() } },
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: vi.fn(),
}));
vi.mock('@/lib/order/export', () => ({
  cleanupExpiredOrderExports: cleanupExpiredMock,
}));
vi.mock('@/lib/order/export-retention', () => ({
  scrubTerminalOrderExportFilters: scrubTerminalMock,
}));
vi.mock('@/lib/salary/cs', () => ({
  CsBatchUnexpectedError: class extends Error {},
  settleReadyCsPeriods: vi.fn(),
}));
vi.mock('@/lib/salary/daily', () => ({
  DailyBatchUnexpectedError: class extends Error {},
  computeDailyForAllMachineWorkers: vi.fn(),
}));
vi.mock('@/lib/salary/hourly-aggregate', () => ({
  HourlyBatchUnexpectedError: class extends Error {},
  computeHourlyForAllInMonth: vi.fn(),
}));

import { runOrderExportCleanupTask } from '../tasks';

beforeEach(() => {
  cleanupExpiredMock.mockReset().mockResolvedValue(3);
  scrubTerminalMock.mockReset().mockResolvedValue(2);
});

describe('runOrderExportCleanupTask', () => {
  it('expires artifacts, scrubs terminal filters, and returns counts only', async () => {
    await expect(
      runOrderExportCleanupTask('2026-08-07'),
    ).resolves.toEqual({
      status: 'ok',
      runDate: '2026-08-07',
      expiredCount: 3,
      scrubbedFilterCount: 2,
    });
    expect(cleanupExpiredMock).toHaveBeenCalledOnce();
    expect(scrubTerminalMock).toHaveBeenCalledOnce();
  });

  it('surfaces cleanup failures so the durable job retries', async () => {
    const error = new Error('artifact cleanup failed');
    cleanupExpiredMock.mockRejectedValue(error);

    await expect(runOrderExportCleanupTask('2026-08-07')).rejects.toBe(error);
    expect(scrubTerminalMock).toHaveBeenCalledOnce();
  });

  it('surfaces privacy scrub failures instead of reporting false success', async () => {
    const error = new Error('filter scrub failed');
    scrubTerminalMock.mockRejectedValue(error);

    await expect(runOrderExportCleanupTask('2026-08-07')).rejects.toBe(error);
    expect(cleanupExpiredMock).not.toHaveBeenCalled();
  });
});
