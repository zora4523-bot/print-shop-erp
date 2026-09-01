import Decimal from 'decimal.js';
import {
  EmploymentType,
  Role,
  WorkerType,
} from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { db } from './db';
import { parseStrictYmd } from './auth/schemas';
import { employmentCoversDate } from './salary/employment';
import {
  hourlyPayrollLockKey,
  salaryIdentityLockKey,
} from './salary/hourly-lock';

// 正式员工考勤：管理员按天记录实际上班/请假天数（支持半天），
// 时薪工额外记录正常、加班与厨师空闲打包工时。WORK_HOURS 规则仅用于
// 录入 UI 的“全勤”快捷值，不在后端派生考勤。

export class AttendanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttendanceError';
  }
}

export type AttendanceEmployeeOption = {
  id: string;
  displayName: string;
  role: Role;
  workerType: WorkerType | null;
  employmentType: EmploymentType;
  username: string;
};

export async function listActiveAttendanceEmployees(): Promise<
  AttendanceEmployeeOption[]
> {
  const rows = await db.user.findMany({
    where: {
      isActive: true,
      role: { not: Role.ADMIN },
      employmentType: { not: null },
    },
    orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
    select: {
      id: true,
      displayName: true,
      role: true,
      workerType: true,
      employmentType: true,
      username: true,
    },
  });
  return rows as AttendanceEmployeeOption[];
}

export type RecordAttendanceInput = {
  normalHours: string | number | Decimal;
  otHours: string | number | Decimal;
  // COOK only — dropped silently for non-COOK so the foreman UI can
  // send the same shape for every worker type.
  spareHours?: string | number | Decimal;
  remark?: string | null;
  workUnits?: string | number | Decimal;
  leaveUnits?: string | number | Decimal;
  leaveType?: string | null;
};

export type AttendanceRow = {
  id: string;
  workerId: string;
  date: Date;
  normalHours: string;
  otHours: string;
  spareHours: string;
  remark: string | null;
  workUnits: string;
  leaveUnits: string;
  leaveType: string | null;
  workerDisplayName: string;
  // Immutable identity captured when the row was first recorded. Payroll
  // must not follow the mutable User.role / User.workerType fields.
  workerType: WorkerType | null;
  workerRole: Role;
  employmentType: EmploymentType;
};

type MutableAttendanceSnapshot = {
  normalHours: Decimal.Value;
  otHours: Decimal.Value;
  spareHours: Decimal.Value;
  workUnits: Decimal.Value;
  leaveUnits: Decimal.Value;
  leaveType: string | null;
  remark: string | null;
};

type NormalizedAttendanceFacts = {
  normalHours: string;
  otHours: string;
  spareHours: string;
  workUnits: string;
  leaveUnits: string;
  leaveType: string | null;
  remark: string | null;
};

function sameAttendanceFacts(
  current: MutableAttendanceSnapshot,
  next: NormalizedAttendanceFacts,
): boolean {
  return (
    new Decimal(current.normalHours).equals(next.normalHours) &&
    new Decimal(current.otHours).equals(next.otHours) &&
    new Decimal(current.spareHours).equals(next.spareHours) &&
    new Decimal(current.workUnits).equals(next.workUnits) &&
    new Decimal(current.leaveUnits).equals(next.leaveUnits) &&
    current.leaveType === next.leaveType &&
    current.remark === next.remark
  );
}

function isPrismaNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  );
}

// Idempotent upsert: re-recording the same (workerId, date) overwrites
// the previous row. 管理员可能早上快速录"全勤"再下午细调，这里必须
// 宽松（注意事项 2 — 幂等）。
export async function recordAttendance(
  workerId: string,
  date: string,
  input: RecordAttendanceInput,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<AttendanceRow> {
  void now;
  // Strict calendar parse — rejects 2026-02-31 just like daily-salary
  // and cs flows.
  const dateCol = parseStrictYmd(date);
  if (!dateCol) {
    throw new AttendanceError(
      `日期格式非法或非法日历日期（应为合法 YYYY-MM-DD）：${date}`,
    );
  }

  const normal = dec(input.normalHours);
  const ot = dec(input.otHours);
  const spare =
    input.spareHours === undefined ? new Decimal(0) : dec(input.spareHours);

  if (normal.lt(0) || ot.lt(0) || spare.lt(0)) {
    throw new AttendanceError('工时不能为负');
  }
  // Upper bound — a single day can't plausibly exceed 24 hours in any
  // one bucket. Catches typos like "88" instead of "8.8".
  for (const [label, v] of [
    ['正常工时', normal],
    ['加班工时', ot],
    ['空闲打包工时', spare],
  ] as const) {
    if (v.gt(24)) {
      throw new AttendanceError(`${label}超出 24 小时`);
    }
  }
  if (normal.plus(ot).gt(24)) {
    throw new AttendanceError('正常工时与加班工时合计超出 24 小时');
  }

  const workUnits = dec(input.workUnits ?? 1);
  const leaveUnits = dec(input.leaveUnits ?? 0);
  if (
    ![0, 0.5, 1].includes(workUnits.toNumber()) ||
    ![0, 0.5, 1].includes(leaveUnits.toNumber()) ||
    workUnits.plus(leaveUnits).gt(1)
  ) {
    throw new AttendanceError('上班和请假只支持半天单位，合计不能超过 1 天');
  }
  const leaveType = input.leaveType?.trim() || null;
  const remark = input.remark ?? null;
  const month = date.slice(0, 7);

  return db.$transaction(async (tx) => {
    // Identity precedes worker-month everywhere. Account role/active/date
    // changes use the same identity key, so the snapshot is read only after a
    // concurrent account mutation has committed (or before it begins).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(
      workerId,
    )}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hourlyPayrollLockKey(
      workerId,
      month,
    )}))`;

    const worker = await tx.user.findUnique({
      where: { id: workerId },
      select: {
        id: true,
        role: true,
        workerType: true,
        isActive: true,
        displayName: true,
        employmentType: true,
        employmentStartDate: true,
        employmentEndDate: true,
      },
    });
    if (!worker) throw new AttendanceError('工人不存在');
    if (!worker.isActive) throw new AttendanceError('工人已停用');
    if (worker.role === Role.ADMIN || worker.employmentType === null) {
      throw new AttendanceError('该账号不是可录考勤的在职员工');
    }
    if (!employmentCoversDate(dateCol, worker)) {
      throw new AttendanceError('考勤日期不在该员工的雇佣区间内');
    }

    const payroll = await tx.hourlyWorkerPayroll.findUnique({
      where: { workerId_month: { workerId, month } },
      select: { id: true, isPaid: true },
    });
    if (payroll?.isPaid) {
      throw new AttendanceError(
        `该员工 ${month} 月工资已发放；请先撤销发放再修改考勤`,
      );
    }

    const existing = await tx.attendance.findUnique({
      where: { workerId_date: { workerId, date: dateCol } },
      select: {
        roleSnapshot: true,
        workerTypeSnapshot: true,
        normalHours: true,
        otHours: true,
        spareHours: true,
        workUnits: true,
        leaveUnits: true,
        leaveType: true,
        remark: true,
      },
    });
    const roleSnapshot = existing?.roleSnapshot ?? worker.role;
    const workerTypeSnapshot = existing
      ? existing.workerTypeSnapshot
      : worker.role === Role.WORKER
        ? worker.workerType
        : null;
    if (roleSnapshot === Role.WORKER && workerTypeSnapshot === null) {
      throw new AttendanceError('师傅账号未配置工种，不能录入考勤');
    }

    // spareHours silently drops to zero for non-COOK while retaining an
    // existing row's immutable identity snapshot.
    const effectiveSpare =
      workerTypeSnapshot === WorkerType.COOK ? spare : new Decimal(0);
    const nextFacts: NormalizedAttendanceFacts = {
      normalHours: normal.toFixed(2),
      otHours: ot.toFixed(2),
      spareHours: effectiveSpare.toFixed(2),
      workUnits: workUnits.toFixed(1),
      leaveUnits: leaveUnits.toFixed(1),
      leaveType,
      remark,
    };
    const factsChanged =
      existing === null || !sameAttendanceFacts(existing, nextFacts);

    const saved = await tx.attendance.upsert({
      where: { workerId_date: { workerId, date: dateCol } },
      create: {
        workerId,
        date: dateCol,
        ...nextFacts,
        roleSnapshot,
        workerTypeSnapshot,
        identitySnapshotVerified: true,
        createdById: actor.id,
      },
      update: {
        ...nextFacts,
        // Deliberately don't overwrite createdById, identity snapshots or
        // their verification marker on re-entry; both the original recorder
        // and historical payroll classification stay auditable.
      },
      select: {
        id: true,
        workerId: true,
        date: true,
        normalHours: true,
        otHours: true,
        spareHours: true,
        workUnits: true,
        leaveUnits: true,
        leaveType: true,
        remark: true,
        roleSnapshot: true,
        workerTypeSnapshot: true,
      },
    });

    // An unpaid payroll is a recomputable derivative. Keeping it after a real
    // source change would allow mark-paid to freeze a stale amount, so remove
    // it atomically under the same worker-month lock.
    if (factsChanged && payroll) {
      const invalidated = await tx.hourlyWorkerPayroll.deleteMany({
        where: { id: payroll.id, isPaid: false },
      });
      if (invalidated.count !== 1) {
        throw new AttendanceError('工资状态已变化，请刷新后重试');
      }
    }

    return {
      id: saved.id,
      workerId: saved.workerId,
      date: saved.date,
      normalHours: String(saved.normalHours),
      otHours: String(saved.otHours),
      spareHours: String(saved.spareHours),
      workUnits: String(saved.workUnits),
      leaveUnits: String(saved.leaveUnits),
      leaveType: saved.leaveType,
      remark: saved.remark,
      workerDisplayName: worker.displayName,
      workerType: saved.workerTypeSnapshot,
      workerRole: saved.roleSnapshot,
      employmentType: worker.employmentType ?? EmploymentType.FULL_TIME,
    };
  });
}

// Remove an attendance row — used to correct an accidentally recorded day.
export async function removeAttendance(
  workerId: string,
  date: string,
  actor: { id: string; role: Role },
): Promise<{ removed: boolean }> {
  void actor;
  const dateCol = parseStrictYmd(date);
  if (!dateCol) {
    throw new AttendanceError(
      `日期格式非法或非法日历日期（应为合法 YYYY-MM-DD）：${date}`,
    );
  }
  const month = date.slice(0, 7);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(
      workerId,
    )}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hourlyPayrollLockKey(
      workerId,
      month,
    )}))`;

    const payroll = await tx.hourlyWorkerPayroll.findUnique({
      where: { workerId_month: { workerId, month } },
      select: { id: true, isPaid: true },
    });
    if (payroll?.isPaid) {
      throw new AttendanceError(
        `该员工 ${month} 月工资已发放；请先撤销发放再删除考勤`,
      );
    }

    const existing = await tx.attendance.findUnique({
      where: { workerId_date: { workerId, date: dateCol } },
      select: { id: true },
    });
    if (!existing) return { removed: false };

    try {
      await tx.attendance.delete({
        where: { workerId_date: { workerId, date: dateCol } },
      });
    } catch (error) {
      // Only Prisma's real P2025 means the row disappeared and is therefore
      // an idempotent no-op. Constraint, connection and unknown failures must
      // remain visible to the action/caller.
      if (isPrismaNotFound(error)) return { removed: false };
      throw error;
    }

    if (payroll) {
      const invalidated = await tx.hourlyWorkerPayroll.deleteMany({
        where: { id: payroll.id, isPaid: false },
      });
      if (invalidated.count !== 1) {
        throw new AttendanceError('工资状态已变化，请刷新后重试');
      }
    }
    return { removed: true };
  });
}

// Read all attendance rows for one worker in a given Shanghai
// calendar month. Returns rows ordered by date ascending so the
// foreman UI can render a calendar view directly.
export async function listMonthlyAttendance(
  workerId: string,
  month: string, // YYYY-MM
): Promise<AttendanceRow[]> {
  const { start, end } = parseShanghaiMonth(month);
  const rows = await db.attendance.findMany({
    where: {
      workerId,
      date: { gte: start, lt: end },
    },
    orderBy: { date: 'asc' },
    select: {
      id: true,
      workerId: true,
      date: true,
      normalHours: true,
      otHours: true,
      spareHours: true,
      workUnits: true,
      leaveUnits: true,
      leaveType: true,
      remark: true,
      roleSnapshot: true,
      workerTypeSnapshot: true,
      worker: {
        select: {
          displayName: true,
          employmentType: true,
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    workerId: r.workerId,
    date: r.date,
    normalHours: String(r.normalHours),
    otHours: String(r.otHours),
    spareHours: String(r.spareHours),
    workUnits: String(r.workUnits),
    leaveUnits: String(r.leaveUnits),
    leaveType: r.leaveType,
    remark: r.remark,
    workerDisplayName: r.worker.displayName,
    workerType: r.workerTypeSnapshot,
    workerRole: r.roleSnapshot,
    employmentType: r.worker.employmentType as EmploymentType,
  }));
}

export async function getAttendanceSummaries(
  userIds: string[],
  range: { start: Date; end: Date; inclusiveEnd?: boolean },
): Promise<Map<string, { workUnits: string; leaveUnits: string }>> {
  if (userIds.length === 0) return new Map();
  const rows = await db.attendance.groupBy({
    by: ['workerId'],
    where: {
      workerId: { in: [...new Set(userIds)] },
      date: {
        gte: range.start,
        ...(range.inclusiveEnd ? { lte: range.end } : { lt: range.end }),
      },
    },
    _sum: { workUnits: true, leaveUnits: true },
  });
  return new Map(
    rows.map((row) => [
      row.workerId,
      {
        workUnits: String(row._sum.workUnits ?? 0),
        leaveUnits: String(row._sum.leaveUnits ?? 0),
      },
    ]),
  );
}

// Month-range helper for Prisma `@db.Date` columns. A database DATE has no
// timezone; Prisma represents it as UTC midnight, so this deliberately returns
// UTC-midnight calendar dates. Do not use this range for timestamp columns such
// as Order.finishedAt -- use parseShanghaiMonthInstantRange below instead.
export function parseShanghaiMonth(
  month: string,
): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) {
    throw new AttendanceError(
      `月份格式非法（应为 YYYY-MM）：${month}`,
    );
  }
  const year = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) {
    throw new AttendanceError(`月份超出 1-12：${month}`);
  }
  const start = new Date(Date.UTC(year, mo - 1, 1));
  const end = new Date(Date.UTC(year, mo, 1)); // first day of next month
  return { start, end };
}

/**
 * Returns the UTC instant range spanning one Asia/Shanghai calendar month.
 *
 * Example: May 2026 in Shanghai is
 * [2026-04-30T16:00:00Z, 2026-05-31T16:00:00Z). This is the range timestamp
 * columns must use; applying the @db.Date range above would lose the first
 * eight local hours and include eight hours from the next month.
 */
export function parseShanghaiMonthInstantRange(
  month: string,
): { start: Date; end: Date } {
  const dateRange = parseShanghaiMonth(month);
  const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
  return {
    start: new Date(dateRange.start.getTime() - shanghaiOffsetMs),
    end: new Date(dateRange.end.getTime() - shanghaiOffsetMs),
  };
}

function dec(v: string | number | Decimal): Decimal {
  return new Decimal(v as Decimal.Value);
}
