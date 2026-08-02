import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  generateBillsMock,
  computeDailyMock,
  computeHourlyMock,
  settleReadyCsMock,
  dispatchMock,
  MockBillGenerationUnexpectedError,
  MockDailyBatchUnexpectedError,
  MockHourlyBatchUnexpectedError,
  MockCsBatchUnexpectedError,
} = vi.hoisted(() => {
  class PartialResultError extends Error {
    readonly partialResult: unknown;

    constructor(name: string, partialResult: unknown) {
      super('unexpected batch failure');
      this.name = name;
      this.partialResult = partialResult;
    }
  }

  return {
    generateBillsMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    computeDailyMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    computeHourlyMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    settleReadyCsMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    dispatchMock: vi.fn<(...args: unknown[]) => Promise<void>>(),
    MockBillGenerationUnexpectedError: class extends PartialResultError {
      constructor(partialResult: unknown) {
        super('BillGenerationUnexpectedError', partialResult);
      }
    },
    MockDailyBatchUnexpectedError: class extends PartialResultError {
      constructor(partialResult: unknown) {
        super('DailyBatchUnexpectedError', partialResult);
      }
    },
    MockHourlyBatchUnexpectedError: class extends PartialResultError {
      constructor(partialResult: unknown) {
        super('HourlyBatchUnexpectedError', partialResult);
      }
    },
    MockCsBatchUnexpectedError: class extends PartialResultError {
      constructor(partialResult: unknown) {
        super('CsBatchUnexpectedError', partialResult);
      }
    },
  };
});

vi.mock('@/lib/bill', () => ({
  generateBillsForPeriod: generateBillsMock,
  BillGenerationUnexpectedError: MockBillGenerationUnexpectedError,
}));
vi.mock('@/lib/salary/daily', () => ({
  computeDailyForAllMachineWorkers: computeDailyMock,
  DailyBatchUnexpectedError: MockDailyBatchUnexpectedError,
}));
vi.mock('@/lib/salary/hourly-aggregate', () => ({
  computeHourlyForAllInMonth: computeHourlyMock,
  HourlyBatchUnexpectedError: MockHourlyBatchUnexpectedError,
}));
vi.mock('@/lib/salary/cs', () => ({
  settleReadyCsPeriods: settleReadyCsMock,
  CsBatchUnexpectedError: MockCsBatchUnexpectedError,
}));
vi.mock('@/lib/db', () => ({
  db: { user: { findMany: vi.fn() } },
}));
vi.mock('@/lib/dashboard/owner-watchlist', () => ({
  getDueOrders: vi.fn(),
  getEndingPeriods: vi.fn(),
  getOverdueOutsourcing: vi.fn(),
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: dispatchMock,
}));

import {
  runDailySalaryTask,
  runGenerateBillsTask,
  runHourlyPayrollTask,
} from '../tasks';

beforeEach(() => {
  generateBillsMock.mockReset();
  computeDailyMock.mockReset();
  computeHourlyMock.mockReset();
  settleReadyCsMock.mockReset();
  dispatchMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cron task partial batch failures', () => {
  it('does not consume the daily aggregate notification key before retry', async () => {
    const error = new MockDailyBatchUnexpectedError({
      settled: [{ workerId: 'w1', actualSalary: '100.00' }],
      errors: [],
    });
    computeDailyMock.mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(runDailySalaryTask('2026-07-31')).rejects.toBe(error);

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      '[cron:daily-salary] unexpected failure after partial progress:',
      { committedCount: 1, businessErrorCount: 0 },
    );
  });

  it('reports hourly committed counts and rethrows for durable retry', async () => {
    const error = new MockHourlyBatchUnexpectedError({
      settled: [{ workerId: 'w1' }, { workerId: 'w2' }],
      errors: [{ workerId: 'known', message: 'business error' }],
    });
    computeHourlyMock.mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(runHourlyPayrollTask('2026-07')).rejects.toBe(error);

    expect(consoleError).toHaveBeenCalledWith(
      '[cron:hourly-payroll] unexpected failure after partial progress:',
      { committedCount: 2, businessErrorCount: 1 },
    );
  });

  it('reports generated bill counts and rethrows for durable retry', async () => {
    const error = new MockBillGenerationUnexpectedError({
      period: '2026-07',
      generated: [{ billId: 'bill-1' }],
      errors: [{ salesUserId: 'known', message: 'business error' }],
    });
    generateBillsMock.mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(runGenerateBillsTask('2026-07')).rejects.toBe(error);

    expect(consoleError).toHaveBeenCalledWith(
      '[cron:generate-bills] unexpected failure after partial progress:',
      { committedCount: 1, businessErrorCount: 1 },
    );
  });
});
