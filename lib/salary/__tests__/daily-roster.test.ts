import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MachineType,
  Role,
  WorkerType,
} from '../../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { user: { findMany: vi.fn() } },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { DailySalaryError } from '../daily-common';
import {
  findDailySalaryRoster,
  parseDailySalaryRoster,
} from '../daily-roster';

beforeEach(() => {
  dbMock.user.findMany.mockReset().mockResolvedValue([]);
});

describe('findDailySalaryRoster', () => {
  it('selects active machine workers plus historical task and salary evidence', async () => {
    dbMock.user.findMany.mockResolvedValue([
      {
        id: 'active-worker',
        displayName: '在职师傅',
        role: Role.WORKER,
        workerType: WorkerType.MACHINE,
        isActive: true,
        machineType: MachineType.HAND_PRESS,
      },
      {
        id: 'historical-worker',
        displayName: '历史师傅',
        role: Role.ADMIN,
        workerType: null,
        isActive: false,
        machineType: null,
      },
    ]);

    await expect(findDailySalaryRoster('2026-04-23')).resolves.toEqual([
      {
        workerId: 'active-worker',
        workerName: '在职师傅',
        eligibleMachineType: MachineType.HAND_PRESS,
      },
      {
        workerId: 'historical-worker',
        workerName: '历史师傅',
        eligibleMachineType: null,
      },
    ]);

    const query = dbMock.user.findMany.mock.calls[0]![0];
    expect(query.orderBy).toEqual({ id: 'asc' });
    expect(query.where.OR[0]).toEqual({
      role: Role.WORKER,
      workerType: WorkerType.MACHINE,
      isActive: true,
      machineType: { not: null },
    });
    expect(query.where.OR[1].assignedTasks.some).toMatchObject({
      status: 'COMPLETED',
      completedAt: {
        gte: new Date('2026-04-22T16:00:00.000Z'),
        lt: new Date('2026-04-23T16:00:00.000Z'),
      },
    });
    expect(query.where.OR[2]).toEqual({
      dailyWorkerSalaries: {
        some: { date: new Date('2026-04-23T00:00:00.000Z') },
      },
    });
  });
});

describe('parseDailySalaryRoster', () => {
  it('accepts a frozen machine type or explicit historical null', () => {
    expect(
      parseDailySalaryRoster([
        {
          workerId: 'worker-1',
          workerName: '师傅一',
          eligibleMachineType: MachineType.WINDMILL,
        },
        {
          workerId: 'worker-2',
          workerName: '师傅二',
          eligibleMachineType: null,
        },
      ]),
    ).toHaveLength(2);
  });

  it.each([
    null,
    {},
    [null],
    [{ workerId: '', workerName: '师傅', eligibleMachineType: null }],
    [{ workerId: 'w1', workerName: '', eligibleMachineType: null }],
    [{ workerId: 'w1', workerName: '师傅', eligibleMachineType: 'NOPE' }],
    [
      { workerId: 'w1', workerName: '师傅一', eligibleMachineType: null },
      { workerId: 'w1', workerName: '师傅二', eligibleMachineType: null },
    ],
  ])('fails closed for malformed persisted roster %#', (value) => {
    expect(() => parseDailySalaryRoster(value)).toThrow(DailySalaryError);
    expect(() => parseDailySalaryRoster(value)).toThrow(/roster 非法/);
  });
});
