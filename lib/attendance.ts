import Decimal from 'decimal.js';
import {
  EmploymentType,
  Role,
  WorkerType,
} from '../generated/prisma/enums';
import { db } from './db';
import { parseStrictYmd } from './auth/schemas';

// 正式员工考勤：管理员按天记录实际上班/请假天数（支持半天），
// 时薪工额外记录正常、加班与厨师空闲打包工时。WORK_HOURS 规则仅用于
// 录入 UI 的“全勤”快捷值，不在后端派生考勤。

export class AttendanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttendanceError';
  }
}

// Hourly worker types the attendance flow accepts. MACHINE-type
// workers are on piecework (Slice A) and never enter attendance.
export const HOURLY_WORKER_TYPES = [
  WorkerType.PACKER,
  WorkerType.CLEANER,
  WorkerType.COOK,
] as const;

export type HourlyWorkerOption = {
  id: string;
  displayName: string;
  workerType: WorkerType;
  username: string;
};

export type AttendanceEmployeeOption = {
  id: string;
  displayName: string;
  role: Role;
  workerType: WorkerType | null;
  employmentType: EmploymentType;
  username: string;
};

// Active hourly workers (PACKER / CLEANER / COOK) for the attendance
// page's worker picker. Kept in lib/ so the page never touches Prisma
// directly (CLAUDE.md §3). The `in` filter guarantees a non-null
// workerType; Prisma's generated type can't narrow through the filter,
// so we assert the narrowed shape here once.
export async function listActiveHourlyWorkers(): Promise<HourlyWorkerOption[]> {
  const rows = await db.user.findMany({
    where: {
      role: Role.WORKER,
      isActive: true,
      workerType: { in: [...HOURLY_WORKER_TYPES] },
    },
    orderBy: [{ workerType: 'asc' }, { displayName: 'asc' }],
    select: { id: true, displayName: true, workerType: true, username: true },
  });
  return rows as HourlyWorkerOption[];
}

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
  workerType: WorkerType | null;
  workerRole: Role;
  employmentType: EmploymentType;
};

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

  const worker = await db.user.findUnique({
    where: { id: workerId },
    select: {
      id: true,
      role: true,
      workerType: true,
      isActive: true,
      displayName: true,
      employmentType: true,
    },
  });
  if (!worker) throw new AttendanceError('工人不存在');
  if (!worker.isActive) throw new AttendanceError('工人已停用');
  if (worker.role === Role.ADMIN || worker.employmentType === null) {
    throw new AttendanceError('该账号不是可录考勤的在职员工');
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

  // spareHours silently dropped for non-COOK even if the caller sends
  // one — keeps the foreman's form shape uniform without polluting
  // PACKER / CLEANER rows.
  const effectiveSpare =
    worker.workerType === WorkerType.COOK ? spare : new Decimal(0);
  const workUnits = dec(input.workUnits ?? 1);
  const leaveUnits = dec(input.leaveUnits ?? 0);
  if (
    ![0, 0.5, 1].includes(workUnits.toNumber()) ||
    ![0, 0.5, 1].includes(leaveUnits.toNumber()) ||
    workUnits.plus(leaveUnits).gt(1)
  ) {
    throw new AttendanceError('上班和请假只支持半天单位，合计不能超过 1 天');
  }

  const saved = await db.attendance.upsert({
    where: { workerId_date: { workerId, date: dateCol } },
    create: {
      workerId,
      date: dateCol,
      normalHours: normal.toFixed(2),
      otHours: ot.toFixed(2),
      spareHours: effectiveSpare.toFixed(2),
      workUnits: workUnits.toFixed(1),
      leaveUnits: leaveUnits.toFixed(1),
      leaveType: input.leaveType?.trim() || null,
      remark: input.remark ?? null,
      createdById: actor.id,
    },
    update: {
      normalHours: normal.toFixed(2),
      otHours: ot.toFixed(2),
      spareHours: effectiveSpare.toFixed(2),
      workUnits: workUnits.toFixed(1),
      leaveUnits: leaveUnits.toFixed(1),
      leaveType: input.leaveType?.trim() || null,
      remark: input.remark ?? null,
      // Deliberately don't overwrite createdById on re-entry; the
      // original recorder stays the auditable actor.
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
    },
  });

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
    workerType: worker.workerType,
    workerRole: worker.role,
    employmentType: worker.employmentType ?? EmploymentType.FULL_TIME,
  };
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
  try {
    await db.attendance.delete({
      where: { workerId_date: { workerId, date: dateCol } },
    });
    return { removed: true };
  } catch {
    // Prisma throws P2025 for "record to delete not found"; we treat
    // it as a no-op — idempotent from the foreman's perspective.
    return { removed: false };
  }
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
      worker: {
        select: {
          displayName: true,
          workerType: true,
          role: true,
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
    workerType: r.worker.workerType,
    workerRole: r.worker.role,
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

// Month-range helper. SPEC §5.4 operates on calendar months in the
// Shanghai timezone; UTC-midnight on the 1st of the month matches the
// @db.Date column's stored format, so we reuse that convention.
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

function dec(v: string | number | Decimal): Decimal {
  return new Decimal(v as Decimal.Value);
}
