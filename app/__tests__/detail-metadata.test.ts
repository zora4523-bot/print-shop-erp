import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role, WorkerType } from '@/generated/prisma/enums';

const {
  getSessionMock,
  hasPermissionMock,
  getDailySalaryMock,
  getWorkerOrderMock,
  getWorkerPieceworkSalaryMock,
  getWorkerHourlySalaryMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  getDailySalaryMock: vi.fn(),
  getWorkerOrderMock: vi.fn(),
  getWorkerPieceworkSalaryMock: vi.fn(),
  getWorkerHourlySalaryMock: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  getSession: getSessionMock,
}));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: vi.fn(),
}));
vi.mock('@/lib/auth/permissions-dict', () => ({
  hasPermission: hasPermissionMock,
}));
vi.mock('@/lib/salary/daily', () => ({
  getDailyWorkerSalaryDetail: getDailySalaryMock,
}));
vi.mock('@/lib/worker-portal', () => ({
  getWorkerOrderDetail: getWorkerOrderMock,
  getWorkerSalaryDetail: getWorkerPieceworkSalaryMock,
  getWorkerHourlyPayrollDetail: getWorkerHourlySalaryMock,
}));
vi.mock('@/lib/attendance', () => ({
  getAttendanceSummaries: vi.fn(),
}));
vi.mock('@/components/business/salary/AddSalaryAdjustmentForm', () => ({
  AddSalaryAdjustmentForm: () => null,
}));
vi.mock('@/components/business/salary/MarkPaidForm', () => ({
  MarkPaidForm: () => null,
}));

import { generateMetadata as generateDailySalaryMetadata } from '@/app/(admin)/owner/salary/daily/[id]/page';
import { generateMetadata as generateWorkerOrderMetadata } from '@/app/(worker)/worker/orders/[id]/page';
import { generateMetadata as generateWorkerSalaryMetadata } from '@/app/(worker)/worker/salary/[id]/page';

function session(role: Role, workerType: WorkerType | null = null) {
  return {
    user: {
      id: `${role.toLowerCase()}-1`,
      role,
      workerType,
    },
  };
}

beforeEach(() => {
  getSessionMock.mockReset();
  hasPermissionMock.mockReset();
  getDailySalaryMock.mockReset();
  getWorkerOrderMock.mockReset();
  getWorkerPieceworkSalaryMock.mockReset();
  getWorkerHourlySalaryMock.mockReset();
  hasPermissionMock.mockImplementation(
    (permission: string, role: Role) =>
      permission === 'salary:view:all' && role === Role.ADMIN,
  );
});

describe('missing detail-page metadata', () => {
  it('does not query protected records before authentication and authorization', async () => {
    getSessionMock.mockResolvedValue(null);

    await expect(
      generateDailySalaryMetadata({
        params: Promise.resolve({ id: 'daily-private' }),
      }),
    ).resolves.toEqual({ title: '计件工资' });
    await expect(
      generateWorkerOrderMetadata({
        params: Promise.resolve({ id: 'order-private' }),
      }),
    ).resolves.toEqual({ title: '我的工单' });
    await expect(
      generateWorkerSalaryMetadata({
        params: Promise.resolve({ id: 'salary-private' }),
      }),
    ).resolves.toEqual({ title: '我的工资' });

    expect(getDailySalaryMock).not.toHaveBeenCalled();
    expect(getWorkerOrderMock).not.toHaveBeenCalled();
    expect(getWorkerPieceworkSalaryMock).not.toHaveBeenCalled();
    expect(getWorkerHourlySalaryMock).not.toHaveBeenCalled();
  });

  it('does not expose admin salary records to a role without salary:view:all', async () => {
    getSessionMock.mockResolvedValue(session(Role.SALES));

    await expect(
      generateDailySalaryMetadata({
        params: Promise.resolve({ id: 'daily-private' }),
      }),
    ).resolves.toEqual({ title: '计件工资' });
    expect(getDailySalaryMock).not.toHaveBeenCalled();
  });

  it('builds the admin daily-salary title only after the permission gate', async () => {
    getSessionMock.mockResolvedValue(session(Role.ADMIN));
    getDailySalaryMock.mockResolvedValue({
      date: new Date('2026-08-24T00:00:00.000Z'),
      worker: { displayName: '张师傅' },
    });

    await expect(
      generateDailySalaryMetadata({
        params: Promise.resolve({ id: 'daily-1' }),
      }),
    ).resolves.toEqual({ title: '张师傅 2026/08/24 · 计件工资' });
    expect(getDailySalaryMock).toHaveBeenCalledWith('daily-1');

    getDailySalaryMock.mockResolvedValueOnce(null);
    await expect(
      generateDailySalaryMetadata({
        params: Promise.resolve({ id: 'daily-missing' }),
      }),
    ).resolves.toEqual({ title: '计件工资记录不存在' });
  });

  it('uses the same ownership-scoped worker-order read as the page', async () => {
    getSessionMock.mockResolvedValue(session(Role.WORKER, WorkerType.MACHINE));
    getWorkerOrderMock.mockResolvedValue({ orderNo: 'GD-260824-001' });

    await expect(
      generateWorkerOrderMetadata({
        params: Promise.resolve({ id: 'order-1' }),
      }),
    ).resolves.toEqual({ title: 'GD-260824-001 · 我的工单' });
    expect(getWorkerOrderMock).toHaveBeenCalledWith('order-1', {
      id: 'worker-1',
      role: Role.WORKER,
    });

    getWorkerOrderMock.mockResolvedValueOnce(null);
    await expect(
      generateWorkerOrderMetadata({
        params: Promise.resolve({ id: 'order-missing' }),
      }),
    ).resolves.toEqual({ title: '工单不存在' });
  });

  it('selects the worker salary source from the verified worker type', async () => {
    getSessionMock.mockResolvedValue(session(Role.WORKER, WorkerType.MACHINE));
    getWorkerPieceworkSalaryMock.mockResolvedValue({
      date: new Date('2026-08-24T00:00:00.000Z'),
    });

    await expect(
      generateWorkerSalaryMetadata({
        params: Promise.resolve({ id: 'piecework-1' }),
      }),
    ).resolves.toEqual({ title: '2026/08/24 · 我的工资' });
    expect(getWorkerPieceworkSalaryMock).toHaveBeenCalledWith('piecework-1', {
      id: 'worker-1',
      role: Role.WORKER,
      workerType: WorkerType.MACHINE,
    });
    expect(getWorkerHourlySalaryMock).not.toHaveBeenCalled();

    getSessionMock.mockResolvedValue(session(Role.WORKER, WorkerType.PACKER));
    getWorkerHourlySalaryMock.mockResolvedValue({ month: '2026-08' });
    await expect(
      generateWorkerSalaryMetadata({
        params: Promise.resolve({ id: 'hourly-1' }),
      }),
    ).resolves.toEqual({ title: '2026-08 · 我的工资' });
    expect(getWorkerHourlySalaryMock).toHaveBeenCalledWith('hourly-1', {
      id: 'worker-1',
      role: Role.WORKER,
      workerType: WorkerType.PACKER,
    });
  });

  it('uses a non-enumerating missing-record fallback for worker salary', async () => {
    getSessionMock.mockResolvedValue(session(Role.WORKER, WorkerType.CLEANER));
    getWorkerHourlySalaryMock.mockResolvedValue(null);

    await expect(
      generateWorkerSalaryMetadata({
        params: Promise.resolve({ id: 'salary-missing' }),
      }),
    ).resolves.toEqual({ title: '工资记录不存在' });
  });
});
