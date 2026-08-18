import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EmploymentType,
  Role,
  WorkerType,
} from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    user: { findUnique: vi.fn() },
    attendance: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  recordAttendance,
  removeAttendance,
  listMonthlyAttendance,
  parseShanghaiMonth,
  parseShanghaiMonthInstantRange,
  AttendanceError,
} from '../attendance';

const foremanActor = { id: 'foreman-1', role: Role.ADMIN };

function workerFixture(
  overrides: Partial<{
    workerType: WorkerType | null;
    role: Role;
    isActive: boolean;
    employmentType: EmploymentType | null;
  }> = {},
) {
  return {
    id: 'worker-1',
    role: Role.WORKER,
    workerType: WorkerType.PACKER,
    isActive: true,
    employmentType: EmploymentType.FULL_TIME,
    displayName: '打包阿姨',
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.user.findUnique.mockReset();
  dbMock.attendance.upsert.mockReset().mockImplementation(async ({
    create,
  }: {
    create: Record<string, unknown>;
  }) => ({
    id: 'att-1',
    workerId: create.workerId,
    date: create.date,
    normalHours: create.normalHours,
    otHours: create.otHours,
    spareHours: create.spareHours,
    workUnits: create.workUnits,
    leaveUnits: create.leaveUnits,
    leaveType: create.leaveType ?? null,
    remark: create.remark ?? null,
    roleSnapshot: create.roleSnapshot,
    workerTypeSnapshot: create.workerTypeSnapshot ?? null,
  }));
  dbMock.attendance.findUnique.mockReset().mockResolvedValue(null);
  dbMock.attendance.delete.mockReset();
  dbMock.attendance.findMany.mockReset().mockResolvedValue([]);
  dbMock.attendance.groupBy.mockReset().mockResolvedValue([]);
});

describe('parseShanghaiMonth', () => {
  it('returns UTC-midnight DATE values for valid YYYY-MM', () => {
    const { start, end } = parseShanghaiMonth('2026-05');
    expect(start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('returns the real UTC instant range for a Shanghai calendar month', () => {
    const { start, end } = parseShanghaiMonthInstantRange('2026-05');
    expect(start.toISOString()).toBe('2026-04-30T16:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-31T16:00:00.000Z');
  });

  it('handles year boundary (Dec → next Jan)', () => {
    const { start, end } = parseShanghaiMonth('2026-12');
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('handles instant-range year boundary (Dec → next Jan)', () => {
    const { start, end } = parseShanghaiMonthInstantRange('2026-12');
    expect(start.toISOString()).toBe('2026-11-30T16:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-31T16:00:00.000Z');
  });

  it('rejects bad format', () => {
    expect(() => parseShanghaiMonth('2026/05')).toThrow(AttendanceError);
    expect(() => parseShanghaiMonth('2026-5')).toThrow(AttendanceError);
    expect(() => parseShanghaiMonth('')).toThrow(AttendanceError);
  });

  it('rejects invalid month (13+)', () => {
    expect(() => parseShanghaiMonth('2026-13')).toThrow(/超出 1-12/);
    expect(() => parseShanghaiMonth('2026-00')).toThrow(/超出 1-12/);
  });
});

describe('recordAttendance — worker validation', () => {
  it('rejects invalid calendar dates (2026-02-31)', async () => {
    await expect(
      recordAttendance(
        'worker-1',
        '2026-02-31',
        { normalHours: 8, otHours: 0 },
        foremanActor,
      ),
    ).rejects.toThrow(/非法/);
  });

  it('rejects missing worker', async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    await expect(
      recordAttendance(
        'ghost',
        '2026-05-01',
        { normalHours: 8, otHours: 0 },
        foremanActor,
      ),
    ).rejects.toThrow(/不存在/);
  });

  it('rejects an inactive worker', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ isActive: false }),
    );
    await expect(
      recordAttendance(
        'worker-1',
        '2026-05-01',
        { normalHours: 8, otHours: 0 },
        foremanActor,
      ),
    ).rejects.toThrow(/已停用/);
  });

  it('accepts a non-admin sales employee', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture({ role: Role.SALES }));
    const result = await recordAttendance(
      'worker-1',
      '2026-05-01',
      { normalHours: 8, otHours: 0 },
      foremanActor,
    );
    expect(result.workerRole).toBe(Role.SALES);
  });

  it('accepts a full-time MACHINE worker so actual work and leave days remain auditable', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ workerType: WorkerType.MACHINE }),
    );
    const result = await recordAttendance(
      'worker-1',
      '2026-05-01',
      { normalHours: 8, otHours: 0 },
      foremanActor,
    );
    expect(result.workerType).toBe(WorkerType.MACHINE);
  });

  it('accepts a non-worker employee without a worker subtype', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ role: Role.SALES, workerType: null }),
    );
    await expect(
      recordAttendance(
        'worker-1',
        '2026-05-01',
        { normalHours: 8, otHours: 0 },
        foremanActor,
      ),
    ).resolves.toMatchObject({ workerType: null });
  });

  it('rejects a WORKER account without a subtype so the snapshot cannot be ambiguous', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ workerType: null }),
    );

    await expect(
      recordAttendance(
        'worker-1',
        '2026-05-01',
        { normalHours: 8, otHours: 0 },
        foremanActor,
      ),
    ).rejects.toThrow(/未配置工种/);
    expect(dbMock.attendance.upsert).not.toHaveBeenCalled();
  });

  it('rejects accounts that are not marked as employees', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ employmentType: null }),
    );
    await expect(
      recordAttendance(
        'worker-1',
        '2026-05-01',
        { normalHours: 8, otHours: 0 },
        foremanActor,
      ),
    ).rejects.toThrow(/不是可录考勤/);
  });
});

describe('recordAttendance — hours validation', () => {
  beforeEach(() => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
  });

  it('rejects negative hours (normal / ot / spare)', async () => {
    await expect(
      recordAttendance(
        'worker-1',
        '2026-05-01',
        { normalHours: -1, otHours: 0 },
        foremanActor,
      ),
    ).rejects.toThrow(/不能为负/);
    await expect(
      recordAttendance(
        'worker-1',
        '2026-05-01',
        { normalHours: 0, otHours: -1 },
        foremanActor,
      ),
    ).rejects.toThrow(/不能为负/);
  });

  it('rejects hours > 24 in any single bucket (catches typos)', async () => {
    await expect(
      recordAttendance(
        'worker-1',
        '2026-05-01',
        { normalHours: 88, otHours: 0 },
        foremanActor,
      ),
    ).rejects.toThrow(/超出 24 小时/);
  });

  it('accepts boundary 24 (full day of work)', async () => {
    const r = await recordAttendance(
      'worker-1',
      '2026-05-01',
      { normalHours: 24, otHours: 0 },
      foremanActor,
    );
    expect(r.normalHours).toBe('24.00');
  });

  it('accepts half-day work plus half-day leave and persists the leave reason', async () => {
    const result = await recordAttendance(
      'worker-1',
      '2026-05-01',
      {
        normalHours: 4,
        otHours: 0,
        workUnits: 0.5,
        leaveUnits: 0.5,
        leaveType: '事假',
      },
      foremanActor,
    );
    expect(result.workUnits).toBe('0.5');
    expect(result.leaveUnits).toBe('0.5');
    expect(result.leaveType).toBe('事假');
  });

  it('rejects attendance units over one day', async () => {
    await expect(
      recordAttendance(
        'worker-1',
        '2026-05-01',
        {
          normalHours: 8,
          otHours: 0,
          workUnits: 1,
          leaveUnits: 0.5,
        },
        foremanActor,
      ),
    ).rejects.toThrow(/合计不能超过 1 天/);
  });
});

describe('recordAttendance — upsert idempotency (注意事项 2)', () => {
  beforeEach(() => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture());
  });

  it('same (workerId, date) re-record goes through upsert, not create', async () => {
    await recordAttendance(
      'worker-1',
      '2026-05-01',
      { normalHours: 8, otHours: 2, remark: '加班到 19:30' },
      foremanActor,
    );
    const call = dbMock.attendance.upsert.mock.calls[0][0];
    expect(call.where.workerId_date).toEqual({
      workerId: 'worker-1',
      date: new Date('2026-05-01T00:00:00.000Z'),
    });
    expect(call.create.normalHours).toBe('8.00');
    expect(call.create.otHours).toBe('2.00');
    expect(call.create.roleSnapshot).toBe(Role.WORKER);
    expect(call.create.workerTypeSnapshot).toBe(WorkerType.PACKER);
    expect(call.create.identitySnapshotVerified).toBe(true);
    expect(call.update.normalHours).toBe('8.00');
    expect(call.update.otHours).toBe('2.00');
    expect(call.update.remark).toBe('加班到 19:30');
  });

  it('re-entry does NOT overwrite createdById (original recorder stays auditable)', async () => {
    await recordAttendance(
      'worker-1',
      '2026-05-01',
      { normalHours: 8, otHours: 0 },
      foremanActor,
    );
    const updateArg = dbMock.attendance.upsert.mock.calls[0][0].update;
    expect('createdById' in updateArg).toBe(false);
    expect('roleSnapshot' in updateArg).toBe(false);
    expect('workerTypeSnapshot' in updateArg).toBe(false);
    expect('identitySnapshotVerified' in updateArg).toBe(false);
  });

  it('T1 PACKER -> T2 COOK -> T3 re-entry keeps the T1 payroll identity', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ workerType: WorkerType.COOK }),
    );
    dbMock.attendance.upsert.mockResolvedValue({
      id: 'att-1',
      workerId: 'worker-1',
      date: new Date('2026-05-01T00:00:00.000Z'),
      normalHours: '8.00',
      otHours: '0.00',
      spareHours: '0.00',
      workUnits: '1.0',
      leaveUnits: '0.0',
      leaveType: null,
      remark: null,
      roleSnapshot: Role.WORKER,
      workerTypeSnapshot: WorkerType.PACKER,
    });
    dbMock.attendance.findUnique.mockResolvedValue({
      roleSnapshot: Role.WORKER,
      workerTypeSnapshot: WorkerType.PACKER,
    });

    const result = await recordAttendance(
      'worker-1',
      '2026-05-01',
      { normalHours: 8, otHours: 0, spareHours: 3 },
      foremanActor,
    );

    const updateArg = dbMock.attendance.upsert.mock.calls[0][0].update;
    expect(updateArg).not.toHaveProperty('roleSnapshot');
    expect(updateArg).not.toHaveProperty('workerTypeSnapshot');
    expect(updateArg.spareHours).toBe('0.00');
    expect(result.workerType).toBe(WorkerType.PACKER);
    expect(result.workerRole).toBe(Role.WORKER);
  });
});

describe('recordAttendance — COOK spare hours', () => {
  it('COOK spare hours are persisted', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ workerType: WorkerType.COOK }),
    );
    await recordAttendance(
      'worker-1',
      '2026-05-01',
      { normalHours: 8, otHours: 0, spareHours: 2 },
      foremanActor,
    );
    const create = dbMock.attendance.upsert.mock.calls[0][0].create;
    expect(create.spareHours).toBe('2.00');
  });

  it('non-COOK spare hours are silently dropped even if sent', async () => {
    // Foreman UI may send the same shape for every worker type;
    // backend just zeroes spare for PACKER / CLEANER so the column
    // stays semantically accurate.
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ workerType: WorkerType.PACKER }),
    );
    await recordAttendance(
      'worker-1',
      '2026-05-01',
      { normalHours: 8, otHours: 0, spareHours: 5 },
      foremanActor,
    );
    const create = dbMock.attendance.upsert.mock.calls[0][0].create;
    expect(create.spareHours).toBe('0.00');
  });
});

describe('removeAttendance', () => {
  it('deletes the row and reports removed=true', async () => {
    dbMock.attendance.delete.mockResolvedValue({ id: 'att-1' });
    const r = await removeAttendance('worker-1', '2026-05-01', foremanActor);
    expect(r.removed).toBe(true);
    expect(dbMock.attendance.delete).toHaveBeenCalledWith({
      where: {
        workerId_date: {
          workerId: 'worker-1',
          date: new Date('2026-05-01T00:00:00.000Z'),
        },
      },
    });
  });

  it('idempotent: missing row returns removed=false, not an error', async () => {
    dbMock.attendance.delete.mockRejectedValue(new Error('P2025'));
    const r = await removeAttendance('worker-1', '2026-05-01', foremanActor);
    expect(r.removed).toBe(false);
  });

  it('rejects invalid date format', async () => {
    await expect(
      removeAttendance('worker-1', '2026/05/01', foremanActor),
    ).rejects.toThrow(/非法/);
  });
});

describe('listMonthlyAttendance', () => {
  it('queries with UTC-midnight [start, end) range', async () => {
    await listMonthlyAttendance('worker-1', '2026-05');
    const where = dbMock.attendance.findMany.mock.calls[0][0].where;
    expect(where.workerId).toBe('worker-1');
    expect((where.date.gte as Date).toISOString()).toBe(
      '2026-05-01T00:00:00.000Z',
    );
    expect((where.date.lt as Date).toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    );
  });

  it('returns rows ordered by date asc for calendar view', async () => {
    dbMock.attendance.findMany.mockResolvedValue([
      {
        id: 'a1',
        workerId: 'worker-1',
        date: new Date('2026-05-01'),
        normalHours: '8.00',
        otHours: '0.00',
        spareHours: '0.00',
        workUnits: '1.0',
        leaveUnits: '0.0',
        leaveType: null,
        remark: null,
        roleSnapshot: Role.WORKER,
        workerTypeSnapshot: WorkerType.PACKER,
        worker: {
          displayName: '打包阿姨',
          employmentType: EmploymentType.FULL_TIME,
        },
      },
    ]);
    const rows = await listMonthlyAttendance('worker-1', '2026-05');
    expect(rows).toHaveLength(1);
    expect(rows[0].workerDisplayName).toBe('打包阿姨');
    expect(dbMock.attendance.findMany.mock.calls[0][0].orderBy).toEqual({
      date: 'asc',
    });
  });
});
