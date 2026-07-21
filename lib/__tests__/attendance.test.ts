import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role, WorkerType } from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    user: { findUnique: vi.fn() },
    attendance: {
      upsert: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
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
  AttendanceError,
} from '../attendance';

const foremanActor = { id: 'foreman-1', role: Role.ADMIN };

function workerFixture(
  overrides: Partial<{
    workerType: WorkerType | null;
    role: Role;
    isActive: boolean;
  }> = {},
) {
  return {
    id: 'worker-1',
    role: Role.WORKER,
    workerType: WorkerType.PACKER,
    isActive: true,
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
    remark: create.remark ?? null,
  }));
  dbMock.attendance.delete.mockReset();
  dbMock.attendance.findMany.mockReset().mockResolvedValue([]);
});

describe('parseShanghaiMonth', () => {
  it('returns UTC midnight [first, first-of-next) for valid YYYY-MM', () => {
    const { start, end } = parseShanghaiMonth('2026-05');
    expect(start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('handles year boundary (Dec → next Jan)', () => {
    const { start, end } = parseShanghaiMonth('2026-12');
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
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

  it('rejects a non-WORKER role', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture({ role: Role.SALES }));
    await expect(
      recordAttendance(
        'worker-1',
        '2026-05-01',
        { normalHours: 8, otHours: 0 },
        foremanActor,
      ),
    ).rejects.toThrow(/不是工人/);
  });

  it('rejects a MACHINE-type worker (piecework path, not attendance)', async () => {
    dbMock.user.findUnique.mockResolvedValue(
      workerFixture({ workerType: WorkerType.MACHINE }),
    );
    await expect(
      recordAttendance(
        'worker-1',
        '2026-05-01',
        { normalHours: 8, otHours: 0 },
        foremanActor,
      ),
    ).rejects.toThrow(/仅时薪工.*可录入考勤/);
  });

  it('rejects a worker with no workerType set', async () => {
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
    ).rejects.toThrow(/仅时薪工/);
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
        remark: null,
        worker: { displayName: '打包阿姨', workerType: WorkerType.PACKER },
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
