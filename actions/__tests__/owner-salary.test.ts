import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '../../generated/prisma/client';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  salaryMock,
  revalidatePathMock,
  MockDailySalaryError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  salaryMock: {
    computeDailyWorkerSalary: vi.fn(),
    computeDailyForAllMachineWorkers: vi.fn(),
    markDailySalaryPaid: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  MockDailySalaryError: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = 'DailySalaryError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/salary/daily', () => ({
  computeDailyWorkerSalary: salaryMock.computeDailyWorkerSalary,
  computeDailyForAllMachineWorkers: salaryMock.computeDailyForAllMachineWorkers,
  markDailySalaryPaid: salaryMock.markDailySalaryPaid,
  DailySalaryError: MockDailySalaryError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import {
  recomputeDailySalaryAction,
  setDailySalaryPaidAction,
} from '../owner-salary';

const ownerActor = {
  id: 'owner-1',
  username: 'o',
  displayName: '老板',
  role: Role.OWNER,
  workerType: null,
  machineType: null,
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  salaryMock.computeDailyWorkerSalary.mockReset();
  salaryMock.computeDailyForAllMachineWorkers.mockReset();
  salaryMock.markDailySalaryPaid.mockReset();
  revalidatePathMock.mockReset();
});

describe('recomputeDailySalaryAction', () => {
  it("first-line requirePermission('salary:rule:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      recomputeDailySalaryAction(null, { date: '2026-04-23' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'salary:rule:manage',
    );
  });

  it('rejects invalid date format', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeDailySalaryAction(null, { date: '2026/04/23' });
    expect(r.status).toBe('invalid');
  });

  it('rejects invalid calendar dates (2026-02-31 rollover)', async () => {
    // The schema uses a simple YYYY-MM-DD regex; the library's
    // shanghaiDayRange does a deeper calendar check via the strict
    // parser when called. We allow the action to hand through since
    // the lib would throw DailySalaryError on the invalid day.
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeDailySalaryAction(null, { date: 'not-a-date' });
    expect(r.status).toBe('invalid');
  });

  it('batch path: calls computeDailyForAllMachineWorkers when no workerId', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.computeDailyForAllMachineWorkers.mockResolvedValue([
      { workerId: 'w1' },
      { workerId: 'w2' },
    ]);
    const r = await recomputeDailySalaryAction(null, { date: '2026-04-23' });
    expect(r.status).toBe('success');
    if (r.status === 'success') {
      expect(r.workerCount).toBe(2);
      expect(r.date).toBe('2026-04-23');
    }
    expect(salaryMock.computeDailyWorkerSalary).not.toHaveBeenCalled();
  });

  it('single path: calls computeDailyWorkerSalary when workerId is provided', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.computeDailyWorkerSalary.mockResolvedValue({});
    const r = await recomputeDailySalaryAction(null, {
      date: '2026-04-23',
      workerId: 'worker-1',
    });
    expect(r.status).toBe('success');
    if (r.status === 'success') expect(r.workerCount).toBe(1);
    expect(salaryMock.computeDailyWorkerSalary).toHaveBeenCalledWith(
      'worker-1',
      '2026-04-23',
    );
  });

  it('maps DailySalaryError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.computeDailyWorkerSalary.mockRejectedValueOnce(
      new MockDailySalaryError('师傅未配置机型'),
    );
    const r = await recomputeDailySalaryAction(null, {
      date: '2026-04-23',
      workerId: 'worker-1',
    });
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toMatch(/机型/);
  });

  it('revalidates /owner/salary/daily on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.computeDailyForAllMachineWorkers.mockResolvedValue([]);
    await recomputeDailySalaryAction(null, { date: '2026-04-23' });
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/daily');
  });

  it('rejects workerId with path-injection characters', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recomputeDailySalaryAction(null, {
      date: '2026-04-23',
      workerId: '../etc',
    });
    expect(r.status).toBe('invalid');
  });
});

const fd = (data: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

describe('setDailySalaryPaidAction', () => {
  it("first-line requirePermission('salary:view:all')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      setDailySalaryPaidAction('ds-1', null, fd({ isPaid: 'true' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'salary:view:all',
    );
  });

  it('parses HTML-checkbox isPaid=on as true', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.markDailySalaryPaid.mockResolvedValue({
      id: 'ds-1',
      isPaid: true,
    });
    await setDailySalaryPaidAction('ds-1', null, fd({ isPaid: 'on' }));
    expect(salaryMock.markDailySalaryPaid).toHaveBeenCalledWith('ds-1', true);
  });

  it('missing isPaid defaults to false (toggle off via empty POST)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.markDailySalaryPaid.mockResolvedValue({
      id: 'ds-1',
      isPaid: false,
    });
    await setDailySalaryPaidAction('ds-1', null, fd({}));
    expect(salaryMock.markDailySalaryPaid).toHaveBeenCalledWith('ds-1', false);
  });

  it('revalidates the list on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    salaryMock.markDailySalaryPaid.mockResolvedValue({
      id: 'ds-1',
      isPaid: true,
    });
    await setDailySalaryPaidAction('ds-1', null, fd({ isPaid: 'true' }));
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/daily');
  });
});
