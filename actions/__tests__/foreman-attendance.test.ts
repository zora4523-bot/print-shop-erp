import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  attendanceMock,
  revalidatePathMock,
  MockAttendanceError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  attendanceMock: {
    recordAttendance: vi.fn(),
    removeAttendance: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  MockAttendanceError: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = 'AttendanceError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/attendance', () => ({
  recordAttendance: attendanceMock.recordAttendance,
  removeAttendance: attendanceMock.removeAttendance,
  AttendanceError: MockAttendanceError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import {
  recordAttendanceAction,
  removeAttendanceAction,
} from '../foreman-attendance';

const foremanActor = {
  id: 'foreman-1',
  username: 'fm',
  displayName: '管理员',
  role: Role.ADMIN,
  workerType: null,
  machineType: null,
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  attendanceMock.recordAttendance.mockReset();
  attendanceMock.removeAttendance.mockReset();
  revalidatePathMock.mockReset();
});

describe('recordAttendanceAction', () => {
  it("first-line requirePermission('attendance:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      recordAttendanceAction(null, {
        workerId: 'w-1',
        date: '2026-05-01',
        normalHours: '8',
        otHours: '0',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('attendance:manage');
  });

  it('rejects bad date (calendar-invalid)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    const r = await recordAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-02-31',
      normalHours: '8',
      otHours: '0',
    });
    expect(r.status).toBe('invalid');
  });

  it('rejects path-injection workerId', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    const r = await recordAttendanceAction(null, {
      workerId: '../etc',
      date: '2026-05-01',
      normalHours: '8',
      otHours: '0',
    });
    expect(r.status).toBe('invalid');
  });

  it('coerces hours strings to numbers', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    attendanceMock.recordAttendance.mockResolvedValue({});
    const r = await recordAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-05-01',
      normalHours: '8',
      otHours: '2.5',
      remark: '加班到 20:30',
    });
    expect(r.status).toBe('success');
    const args = attendanceMock.recordAttendance.mock.calls[0];
    expect(args[0]).toBe('w-1');
    expect(args[1]).toBe('2026-05-01');
    expect(args[2]).toEqual({
      normalHours: 8,
      otHours: 2.5,
      workUnits: 1,
      leaveUnits: 0,
      leaveType: undefined,
      remark: '加班到 20:30',
    });
  });

  it('supports half-day work plus half-day leave', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    attendanceMock.recordAttendance.mockResolvedValue({});
    const r = await recordAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-05-01',
      normalHours: '4',
      otHours: '0',
      workUnits: '0.5',
      leaveUnits: '0.5',
      leaveType: '事假',
    });
    expect(r.status).toBe('success');
    expect(attendanceMock.recordAttendance.mock.calls[0][2]).toMatchObject({
      workUnits: 0.5,
      leaveUnits: 0.5,
      leaveType: '事假',
    });
  });

  it('rejects negative hours', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    const r = await recordAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-05-01',
      normalHours: '-1',
      otHours: '0',
    });
    expect(r.status).toBe('invalid');
  });

  it('rejects hours > 24 (typo guard)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    const r = await recordAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-05-01',
      normalHours: '88',
      otHours: '0',
    });
    expect(r.status).toBe('invalid');
  });

  it('maps AttendanceError → error (e.g. account is not an employee)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    attendanceMock.recordAttendance.mockRejectedValueOnce(
      new MockAttendanceError('该账号不是可录考勤的在职员工'),
    );
    const r = await recordAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-05-01',
      normalHours: '8',
      otHours: '0',
    });
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toMatch(/在职员工/);
  });

  it('revalidates attendance and payroll reads on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    attendanceMock.recordAttendance.mockResolvedValue({});
    await recordAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-05-01',
      normalHours: '8',
      otHours: '0',
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/foreman/attendance');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/piecework');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/hourly');
    expect(revalidatePathMock).toHaveBeenCalledWith('/worker/salary');
  });
});

describe('removeAttendanceAction', () => {
  it("first-line requirePermission('attendance:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      removeAttendanceAction(null, { workerId: 'w-1', date: '2026-05-01' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects bad date format', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    const r = await removeAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026/05/01',
    });
    expect(r.status).toBe('invalid');
  });

  it('forwards to removeAttendance and reports success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    attendanceMock.removeAttendance.mockResolvedValue({ removed: true });
    const r = await removeAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-05-01',
    });
    expect(r.status).toBe('success');
    expect(attendanceMock.removeAttendance).toHaveBeenCalledWith(
      'w-1',
      '2026-05-01',
      expect.objectContaining({ id: 'foreman-1', role: Role.ADMIN }),
    );
  });

  it('idempotent: succeeds even if row was already absent (lib returns removed=false)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    attendanceMock.removeAttendance.mockResolvedValue({ removed: false });
    const r = await removeAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-05-01',
    });
    expect(r.status).toBe('success');
  });

  it('maps a paid-payroll AttendanceError and does not revalidate', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    attendanceMock.removeAttendance.mockRejectedValue(
      new MockAttendanceError('该员工 2026-05 月工资已发放；请先撤销发放再删除考勤'),
    );

    const result = await removeAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-05-01',
    });

    expect(result).toEqual({
      status: 'error',
      message: '该员工 2026-05 月工资已发放；请先撤销发放再删除考勤',
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('rethrows unexpected delete failures', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    const databaseFailure = new Error('database unavailable');
    attendanceMock.removeAttendance.mockRejectedValue(databaseFailure);

    await expect(
      removeAttendanceAction(null, {
        workerId: 'w-1',
        date: '2026-05-01',
      }),
    ).rejects.toBe(databaseFailure);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
