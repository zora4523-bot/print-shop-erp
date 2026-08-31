import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MachineType, Role, WorkerType } from '../../../generated/prisma/enums';

const { dbMock, modeMock, enqueueMock, databaseNowMock } = vi.hoisted(() => {
  const mock = {
    user: { findMany: vi.fn() },
    dailySalaryCronRun: {
      findUnique: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
    dailyWorkerSalary: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return {
    dbMock: mock,
    modeMock: vi.fn(),
    enqueueMock: vi.fn(),
    databaseNowMock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/background-jobs/mode', () => ({
  backgroundJobsMode: modeMock,
}));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseNow: databaseNowMock,
}));
vi.mock('@/lib/notification/transactional-outbox', () => ({
  enqueueNotificationInTransaction: enqueueMock,
}));

import {
  DailySalarySummaryInvariantError,
  getOrCreateDailySalaryRoster,
  prepareDailySalarySummary,
  readDailySalaryRunCheckpoint,
} from '../daily-salary-summary';

const roster = [
  {
    workerId: 'w1',
    workerName: '师傅一',
    eligibleMachineType: MachineType.HAND_PRESS,
  },
  {
    workerId: 'w2',
    workerName: '师傅二',
    eligibleMachineType: MachineType.WINDMILL,
  },
];

beforeEach(() => {
  modeMock.mockReset().mockReturnValue('inline');
  databaseNowMock
    .mockReset()
    .mockResolvedValue(new Date('2026-08-01T00:00:00.000Z'));
  dbMock.user.findMany.mockReset().mockResolvedValue([]);
  dbMock.dailySalaryCronRun.findUnique.mockReset().mockResolvedValue(null);
  dbMock.dailySalaryCronRun.createMany
    .mockReset()
    .mockResolvedValue({ count: 1 });
  dbMock.dailySalaryCronRun.updateMany
    .mockReset()
    .mockResolvedValue({ count: 1 });
  dbMock.dailyWorkerSalary.findMany.mockReset().mockResolvedValue([]);
  dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) =>
    (fn as (tx: typeof dbMock) => unknown)(dbMock),
  );
  enqueueMock.mockReset().mockResolvedValue(false);
});

describe('daily salary durable roster and summary outbox', () => {
  it('freezes the first durable roster before salary writes and reuses it', async () => {
    modeMock.mockReturnValue('durable');
    dbMock.user.findMany.mockResolvedValue([
      {
        id: 'w1',
        displayName: '师傅一',
        role: Role.WORKER,
        workerType: WorkerType.MACHINE,
        isActive: true,
        machineType: MachineType.HAND_PRESS,
      },
    ]);
    dbMock.dailySalaryCronRun.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ roster: [roster[0]] });
    const assertLease = vi.fn().mockResolvedValue(undefined);

    await expect(
      getOrCreateDailySalaryRoster('2026-07-31', { assertLease }),
    ).resolves.toEqual([roster[0]]);

    expect(assertLease).toHaveBeenCalledTimes(2);
    expect(dbMock.dailySalaryCronRun.createMany).toHaveBeenCalledWith({
      data: [
        {
          date: new Date('2026-07-31T00:00:00.000Z'),
          roster: [roster[0]],
        },
      ],
      skipDuplicates: true,
    });
  });

  it('reuses the stored roster without consulting mutable User state', async () => {
    modeMock.mockReturnValue('durable');
    dbMock.dailySalaryCronRun.findUnique.mockResolvedValue({
      roster,
    });

    await expect(
      getOrCreateDailySalaryRoster('2026-07-31'),
    ).resolves.toEqual(roster);
    expect(dbMock.user.findMany).not.toHaveBeenCalled();
    expect(dbMock.dailySalaryCronRun.createMany).not.toHaveBeenCalled();
  });

  it('re-reads exactly the frozen roster and builds the aggregate in one transaction', async () => {
    dbMock.dailyWorkerSalary.findMany.mockResolvedValue([
      { workerId: 'w1', actualSalary: '100.00' },
      { workerId: 'w2', actualSalary: '50.00' },
    ]);

    await expect(
      prepareDailySalarySummary('2026-07-31', roster),
    ).resolves.toEqual({
      date: '2026-07-31',
      workerCount: 2,
      totalAmount: '150.00',
      notificationQueued: false,
    });
    expect(dbMock.dailyWorkerSalary.findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        date: new Date('2026-07-31T00:00:00.000Z'),
        workerId: { in: ['w1', 'w2'] },
      },
      select: { workerId: true, actualSalary: true },
    });
    expect(enqueueMock).toHaveBeenCalledExactlyOnceWith(
      dbMock,
      'DAILY_WORKER_SALARY',
      { date: '2026-07-31', workerCount: 2, totalAmount: '150.00' },
      { dedupeKey: 'notification:DAILY_WORKER_SALARY:v2:2026-07-31' },
    );
  });

  it('fails closed if salary rows do not exactly cover the frozen roster', async () => {
    dbMock.dailyWorkerSalary.findMany.mockResolvedValue([
      { workerId: 'w1', actualSalary: '100.00' },
    ]);

    await expect(
      prepareDailySalarySummary('2026-07-31', roster),
    ).rejects.toBeInstanceOf(DailySalarySummaryInvariantError);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('commits durable outbox and completion checkpoint atomically', async () => {
    modeMock.mockReturnValue('durable');
    enqueueMock.mockResolvedValue(true);
    dbMock.dailySalaryCronRun.findUnique.mockResolvedValue({
      roster,
      completedAt: null,
      summaryWorkerCount: null,
      summaryTotalAmount: null,
      notificationDedupeKey: null,
    });
    dbMock.dailyWorkerSalary.findMany.mockResolvedValue([
      { workerId: 'w1', actualSalary: '100.00' },
      { workerId: 'w2', actualSalary: '50.00' },
    ]);

    await expect(
      prepareDailySalarySummary('2026-07-31', roster),
    ).resolves.toMatchObject({ notificationQueued: true });
    expect(dbMock.dailySalaryCronRun.updateMany).toHaveBeenCalledWith({
      where: {
        date: new Date('2026-07-31T00:00:00.000Z'),
        completedAt: null,
      },
      data: {
        completedAt: new Date('2026-08-01T00:00:00.000Z'),
        summaryWorkerCount: 2,
        summaryTotalAmount: '150.00',
        notificationDedupeKey:
          'notification:DAILY_WORKER_SALARY:v2:2026-07-31',
      },
    });
  });

  it('returns only the explicit run checkpoint, never a legacy notification job', async () => {
    modeMock.mockReturnValue('durable');
    dbMock.dailySalaryCronRun.findUnique.mockResolvedValue({
      completedAt: new Date('2026-08-01T00:00:00.000Z'),
      summaryWorkerCount: 2,
      summaryTotalAmount: '150.00',
      notificationDedupeKey:
        'notification:DAILY_WORKER_SALARY:v2:2026-07-31',
    });

    await expect(readDailySalaryRunCheckpoint('2026-07-31')).resolves.toEqual({
      date: '2026-07-31',
      workerCount: 2,
      totalAmount: '150.00',
    });
  });

  it('validates the date before trusting a checkpoint', async () => {
    modeMock.mockReturnValue('durable');

    await expect(
      readDailySalaryRunCheckpoint('2026-02-31'),
    ).rejects.toBeInstanceOf(DailySalarySummaryInvariantError);
    expect(dbMock.dailySalaryCronRun.findUnique).not.toHaveBeenCalled();
  });
});
