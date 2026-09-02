import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  generateBillsMock,
  lockPieceworkMock,
  readPieceworkDayMock,
  computeHourlyMock,
  settleReadyCsMock,
  dispatchMock,
  MockBillGenerationUnexpectedError,
  MockHourlyBatchUnexpectedError,
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
    lockPieceworkMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    readPieceworkDayMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    computeHourlyMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    settleReadyCsMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    dispatchMock: vi.fn<(...args: unknown[]) => Promise<void>>(),
    MockBillGenerationUnexpectedError: class extends PartialResultError {
      constructor(partialResult: unknown) {
        super('BillGenerationUnexpectedError', partialResult);
      }
    },
    MockHourlyBatchUnexpectedError: class extends PartialResultError {
      constructor(partialResult: unknown) {
        super('HourlyBatchUnexpectedError', partialResult);
      }
    },
  };
});

vi.mock('@/lib/bill', () => ({
  generateBillsForPeriod: generateBillsMock,
  BillGenerationUnexpectedError: MockBillGenerationUnexpectedError,
}));
vi.mock('@/lib/salary/piecework-settlement', () => ({
  lockPieceworkSettlementsForDate: lockPieceworkMock,
  getPieceworkSettlementDay: readPieceworkDayMock,
}));
vi.mock('@/lib/salary/hourly-aggregate', () => ({
  computeHourlyForAllInMonth: computeHourlyMock,
  HourlyBatchUnexpectedError: MockHourlyBatchUnexpectedError,
}));
vi.mock('@/lib/salary/cs', () => ({
  settleReadyCsPeriods: settleReadyCsMock,
  CsBatchUnexpectedError: class extends Error {},
}));
vi.mock('@/lib/db', () => ({
  db: { user: { findMany: vi.fn() } },
}));
vi.mock('@/lib/dashboard/owner-watchlist', () => ({
  getEndingPeriods: vi.fn(),
  getOverdueOutsourcing: vi.fn(),
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: dispatchMock,
}));

import {
  runDailySalaryTask,
  DailySalaryBatchIncompleteError,
  runGenerateBillsTask,
  runHourlyPayrollTask,
  runCsSettleTask,
} from '../tasks';

beforeEach(() => {
  generateBillsMock.mockReset();
  lockPieceworkMock.mockReset().mockResolvedValue({
    settled: [],
    errors: [],
  });
  readPieceworkDayMock.mockReset().mockResolvedValue({
    settlements: [],
    candidates: [],
  });
  computeHourlyMock.mockReset();
  settleReadyCsMock.mockReset();
  dispatchMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cron task partial batch failures', () => {
  it('does not announce a piecework day with unresolved reporter errors', async () => {
    lockPieceworkMock.mockResolvedValue({
      settled: [{ reporterId: 'w1' }],
      errors: [{ reporterId: 'w2', reporterName: '师傅二', message: '报工损坏' }],
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(runDailySalaryTask('2026-07-31')).rejects.toBeInstanceOf(
      DailySalaryBatchIncompleteError,
    );
    expect(readPieceworkDayMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('notifies from the authoritative settlement snapshot, never attempt-local rows', async () => {
    lockPieceworkMock.mockResolvedValue({
      settled: [{ reporterId: 'w1' }],
      errors: [],
    });
    readPieceworkDayMock.mockResolvedValue({
      settlements: [
        { payableAmount: '100.00' },
        { payableAmount: '150.00' },
      ],
      candidates: [],
    });

    await expect(runDailySalaryTask('2026-07-31')).resolves.toEqual({
      status: 'ok',
      date: '2026-07-31',
      workerCount: 2,
      errorCount: 0,
    });
    expect(lockPieceworkMock).toHaveBeenCalledWith({
      workDate: '2026-07-31',
      actor: expect.objectContaining({ id: 'system' }),
    });
    expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(
      'DAILY_WORKER_SALARY',
      { date: '2026-07-31', workerCount: 2, totalAmount: '250.00' },
      {
        dedupeKey:
          'notification:DAILY_WORKER_SALARY:piecework-v1:2026-07-31',
      },
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

  it('does not dispatch CS settlement notifications a second time', async () => {
    settleReadyCsMock.mockResolvedValue({
      settled: [{ periodId: 'period-1', notificationQueued: false }],
      errors: [],
    });

    await expect(runCsSettleTask()).resolves.toEqual({
      status: 'ok',
      settledCount: 1,
      errorCount: 0,
    });
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
