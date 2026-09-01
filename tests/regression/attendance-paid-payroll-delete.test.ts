import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { Role } from '../../generated/prisma/enums';

const { dbMock, attendanceState } = vi.hoisted(() => {
  const attendanceState = { rowExists: true };
  const attendanceRow = {
    id: 'attendance-paid-month',
    workerId: 'worker-paid',
    date: new Date('2026-05-17T00:00:00.000Z'),
    roleSnapshot: 'WORKER',
    workerTypeSnapshot: 'CLEANER',
    normalHours: '8.00',
    otHours: '0.00',
    spareHours: '0.00',
    workUnits: '1.0',
    leaveUnits: '0.0',
    leaveType: null,
    remark: null,
  };
  const paidPayroll = {
    id: 'payroll-paid',
    workerId: 'worker-paid',
    month: '2026-05',
    isPaid: true,
  };

  const mock = {
    user: {
      findUnique: vi.fn(),
    },
    attendance: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    hourlyWorkerPayroll: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };

  mock.$transaction.mockImplementation(async (operation: unknown) => {
    if (typeof operation === 'function') {
      return await (operation as (tx: typeof mock) => unknown)(mock);
    }
    return await Promise.all(operation as Promise<unknown>[]);
  });
  mock.attendance.findUnique.mockImplementation(async () =>
    attendanceState.rowExists ? attendanceRow : null,
  );
  mock.attendance.delete.mockImplementation(async () => {
    attendanceState.rowExists = false;
    return attendanceRow;
  });
  mock.attendance.upsert.mockResolvedValue(attendanceRow);
  mock.user.findUnique.mockResolvedValue({
    id: 'worker-paid',
    role: 'WORKER',
    workerType: 'CLEANER',
    isActive: true,
    displayName: '清废员工',
    employmentType: 'FULL_TIME',
  });
  mock.hourlyWorkerPayroll.findUnique.mockResolvedValue(paidPayroll);
  mock.hourlyWorkerPayroll.deleteMany.mockResolvedValue({ count: 1 });
  mock.$executeRaw.mockResolvedValue(undefined);

  return { dbMock: mock, attendanceState };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  AttendanceError,
  recordAttendance,
  removeAttendance,
} from '../../lib/attendance';

const adminActor = { id: 'admin-1', role: Role.ADMIN };

beforeEach(() => {
  attendanceState.rowExists = true;
  dbMock.attendance.findUnique.mockClear();
  dbMock.attendance.upsert.mockClear();
  dbMock.attendance.delete.mockClear().mockImplementation(async () => {
    attendanceState.rowExists = false;
    return {
      id: 'attendance-paid-month',
      workerId: 'worker-paid',
      date: new Date('2026-05-17T00:00:00.000Z'),
    };
  });
  dbMock.hourlyWorkerPayroll.findUnique.mockReset().mockResolvedValue({
    id: 'payroll-paid',
    workerId: 'worker-paid',
    month: '2026-05',
    isPaid: true,
  });
  dbMock.hourlyWorkerPayroll.deleteMany
    .mockReset()
    .mockResolvedValue({ count: 1 });
  dbMock.$executeRaw.mockClear();
});

describe('removeAttendance — paid payroll regression', () => {
  it('rejects deletion in a paid payroll month and retains the attendance fact', async () => {
    const rejection = await removeAttendance(
      'worker-paid',
      '2026-05-17',
      adminActor,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect({
      isAttendanceError: rejection instanceof AttendanceError,
      message: rejection instanceof Error ? rejection.message : undefined,
      deleteCalls: dbMock.attendance.delete.mock.calls.length,
      rowExists: attendanceState.rowExists,
    }).toEqual({
      isAttendanceError: true,
      message: expect.stringMatching(/已发|发放/),
      deleteCalls: 0,
      rowExists: true,
    });
  });

  it.each([
    ['new attendance', false],
    ['an existing attendance update', true],
  ])('rejects %s in a paid payroll month', async (_label, rowExists) => {
    attendanceState.rowExists = rowExists;

    await expect(
      recordAttendance(
        'worker-paid',
        '2026-05-17',
        { normalHours: 7, otHours: 0 },
        adminActor,
      ),
    ).rejects.toBeInstanceOf(AttendanceError);

    expect(dbMock.attendance.upsert).not.toHaveBeenCalled();
    expect(dbMock.hourlyWorkerPayroll.deleteMany).not.toHaveBeenCalled();
  });

  it('rethrows a non-not-found Prisma failure instead of reporting removed=false', async () => {
    const databaseFailure = new Prisma.PrismaClientKnownRequestError(
      'attendance delete failed because the database rejected the request',
      {
        code: 'P2003',
        clientVersion: 'regression-test',
      },
    );
    dbMock.hourlyWorkerPayroll.findUnique.mockResolvedValue(null);
    dbMock.attendance.delete.mockRejectedValueOnce(databaseFailure);

    await expect(
      removeAttendance('worker-paid', '2026-05-17', adminActor),
    ).rejects.toBe(databaseFailure);
  });
});
