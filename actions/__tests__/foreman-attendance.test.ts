import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '../../generated/prisma/client';
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
  it("first-line requirePermission('task:assign')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      recordAttendanceAction(null, {
        workerId: 'w-1',
        date: '2026-05-01',
        normalHours: '8',
        otHours: '0',
        spareHours: '0',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('task:assign');
  });

  it('rejects bad date (calendar-invalid)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    const r = await recordAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-02-31',
      normalHours: '8',
      otHours: '0',
      spareHours: '0',
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
      spareHours: '0',
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
      spareHours: '',
      remark: '加班到 20:30',
    });
    expect(r.status).toBe('success');
    const args = attendanceMock.recordAttendance.mock.calls[0];
    expect(args[0]).toBe('w-1');
    expect(args[1]).toBe('2026-05-01');
    expect(args[2]).toEqual({
      normalHours: 8,
      otHours: 2.5,
      spareHours: 0, // empty string → 0
      remark: '加班到 20:30',
    });
  });

  it('rejects negative hours', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    const r = await recordAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-05-01',
      normalHours: '-1',
      otHours: '0',
      spareHours: '0',
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
      spareHours: '0',
    });
    expect(r.status).toBe('invalid');
  });

  it('maps AttendanceError → error (e.g. MACHINE worker rejected)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    attendanceMock.recordAttendance.mockRejectedValueOnce(
      new MockAttendanceError('仅时薪工（打包 / 清废 / 厨师）可录入考勤'),
    );
    const r = await recordAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-05-01',
      normalHours: '8',
      otHours: '0',
      spareHours: '0',
    });
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toMatch(/仅时薪工/);
  });

  it('revalidates /foreman/attendance on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(foremanActor);
    attendanceMock.recordAttendance.mockResolvedValue({});
    await recordAttendanceAction(null, {
      workerId: 'w-1',
      date: '2026-05-01',
      normalHours: '8',
      otHours: '0',
      spareHours: '0',
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/foreman/attendance');
  });
});

describe('removeAttendanceAction', () => {
  it("first-line requirePermission('task:assign')", async () => {
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
});
