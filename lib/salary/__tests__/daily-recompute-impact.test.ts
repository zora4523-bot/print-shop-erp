import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, rosterMock } = vi.hoisted(() => ({
  dbMock: {
    dailyWorkerSalary: { findMany: vi.fn() },
  },
  rosterMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('../daily-roster', () => ({
  findDailySalaryRoster: rosterMock,
}));

import { getDailySalaryRecomputeImpact } from '../daily-recompute-impact';

beforeEach(() => {
  rosterMock.mockReset();
  dbMock.dailyWorkerSalary.findMany.mockReset();
});

describe('getDailySalaryRecomputeImpact', () => {
  it('separates new, overwrite-unpaid and paid-skip rows without calculating money', async () => {
    rosterMock.mockResolvedValue([
      { workerId: 'new', workerName: '新师傅', eligibleMachineType: 'HAND_PRESS' },
      { workerId: 'unpaid', workerName: '未发师傅', eligibleMachineType: 'HAND_PRESS' },
      { workerId: 'paid', workerName: '已发师傅', eligibleMachineType: 'HAND_PRESS' },
    ]);
    dbMock.dailyWorkerSalary.findMany.mockResolvedValue([
      { workerId: 'unpaid', isPaid: false },
      { workerId: 'paid', isPaid: true },
    ]);

    await expect(
      getDailySalaryRecomputeImpact('2026-08-23'),
    ).resolves.toEqual({
      candidateWorkerCount: 3,
      affectedWorkerCount: 2,
      createCount: 1,
      overwriteUnpaidCount: 1,
      paidSkippedCount: 1,
    });
  });

  it('supports a single-worker confirmation without scanning the batch roster', async () => {
    dbMock.dailyWorkerSalary.findMany.mockResolvedValue([
      { workerId: 'worker-1', isPaid: true },
    ]);

    await expect(
      getDailySalaryRecomputeImpact('2026-08-23', 'worker-1'),
    ).resolves.toEqual({
      candidateWorkerCount: 1,
      affectedWorkerCount: 0,
      createCount: 0,
      overwriteUnpaidCount: 0,
      paidSkippedCount: 1,
    });
    expect(rosterMock).not.toHaveBeenCalled();
  });
});
