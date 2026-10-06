import Decimal from 'decimal.js';
import {
  EmploymentType,
  Role,
  type WorkerType,
} from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { db } from './db';
import { parseStrictYmd } from './auth/schemas';
import { employmentCoversDate } from './salary/employment';
import { salaryIdentityLockKey } from './salary/hourly-lock';
import { DAILY_MINIMUM } from './salary/daily-minimum';

// 正式员工考勤：管理员按天记录实际上班/请假天数（支持半天）以及正常、
// 加班工时。WORK_HOURS 规则仅用于录入 UI 的“全勤”快捷值，不在后端派生考勤。
// 已有历史打包时薪月结存档的月份整月冻结：存档不再重算，考勤不得再改。

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

function isPrismaNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  );
}

// 历史打包时薪月结存档只读保留；存档月份的考勤是它的来源事实，不能再改。
async function assertMonthNotArchived(
  tx: Prisma.TransactionClient,
  workerId: string,
  month: string,
  verb: '修改' | '删除',
): Promise<void> {
  const archived = await tx.hourlyWorkerPayroll.findUnique({
    where: { workerId_month: { workerId, month } },
    select: { id: true },
  });
  if (archived) {
    throw new AttendanceError(
      `该员工 ${month} 月已有历史时薪月结存档，考勤已冻结，不能${verb}`,
    );
  }
}

// The caller holds salaryIdentityLockKey, also held by daily settlement.
// Check even when no attendance exists: adding it later would change eligibility.
async function assertDayNotSettled(tx: Prisma.TransactionClient, workerId: string, date: string) {
  if (date < DAILY_MINIMUM.effectiveFrom) return;
  const settled = await tx.pieceworkSettlement.findUnique({ where: { reporterId_workDate: { reporterId: workerId, workDate: parseStrictYmd(date)! } }, select: { id: true } });
  if (settled) throw new AttendanceError('该日工资已锁定，不能新增、修改或删除考勤；请核对历史工资');
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
  if (normal.lt(0) || ot.lt(0)) {
    throw new AttendanceError('工时不能为负');
  }
  // Upper bound — a single day can't plausibly exceed 24 hours in any
  // one bucket. Catches typos like "88" instead of "8.8".
  for (const [label, v] of [
    ['正常工时', normal],
    ['加班工时', ot],
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
    // Account role/active/date changes use the same identity key, so the
    // snapshot is read only after a concurrent account mutation has committed
    // (or before it begins).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(
      workerId,
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

    await assertMonthNotArchived(tx, workerId, month, '修改');
    await assertDayNotSettled(tx, workerId, date);

    const existing = await tx.attendance.findUnique({
      where: { workerId_date: { workerId, date: dateCol } },
      select: {
        roleSnapshot: true,
        workerTypeSnapshot: true,
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

    const nextFacts = {
      normalHours: normal.toFixed(2),
      otHours: ot.toFixed(2),
      workUnits: workUnits.toFixed(1),
      leaveUnits: leaveUnits.toFixed(1),
      leaveType,
      remark,
    };
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
        workUnits: true,
        leaveUnits: true,
        leaveType: true,
        remark: true,
        roleSnapshot: true,
        workerTypeSnapshot: true,
      },
    });

    return {
      id: saved.id,
      workerId: saved.workerId,
      date: saved.date,
      normalHours: String(saved.normalHours),
      otHours: String(saved.otHours),
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

    await assertMonthNotArchived(tx, workerId, month, '删除');
    await assertDayNotSettled(tx, workerId, date);

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
