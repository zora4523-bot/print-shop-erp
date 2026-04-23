import Decimal from 'decimal.js';
import { Role, WorkerType } from '../generated/prisma/enums';
import { db } from './db';
import { parseStrictYmd } from './auth/schemas';

// 时薪工考勤 (PACKER / CLEANER / COOK) — MVP 车间主管每日录入三个小时
// 数字。请假 = 没有行（删除或不录即可）。WORK_HOURS 规则仅用于录入
// UI 的"全勤"快速填 hint，不在后端再做任何时段派生。

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

export type RecordAttendanceInput = {
  normalHours: string | number | Decimal;
  otHours: string | number | Decimal;
  // COOK only — dropped silently for non-COOK so the foreman UI can
  // send the same shape for every worker type.
  spareHours?: string | number | Decimal;
  remark?: string | null;
};

export type AttendanceRow = {
  id: string;
  workerId: string;
  date: Date;
  normalHours: string;
  otHours: string;
  spareHours: string;
  remark: string | null;
  workerDisplayName: string;
  workerType: WorkerType;
};

// Idempotent upsert: re-recording the same (workerId, date) overwrites
// the previous row. 车间主管可能早上快速录"全勤"再下午细调，这里必须
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
    },
  });
  if (!worker) throw new AttendanceError('工人不存在');
  if (!worker.isActive) throw new AttendanceError('工人已停用');
  if (worker.role !== Role.WORKER) {
    throw new AttendanceError('不是工人（role != WORKER）');
  }
  if (!worker.workerType || !isHourlyWorkerType(worker.workerType)) {
    throw new AttendanceError(
      '仅时薪工（打包 / 清废 / 厨师）可录入考勤；机器师傅走计件报工',
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

  // spareHours silently dropped for non-COOK even if the caller sends
  // one — keeps the foreman's form shape uniform without polluting
  // PACKER / CLEANER rows.
  const effectiveSpare =
    worker.workerType === WorkerType.COOK ? spare : new Decimal(0);

  const saved = await db.attendance.upsert({
    where: { workerId_date: { workerId, date: dateCol } },
    create: {
      workerId,
      date: dateCol,
      normalHours: normal.toFixed(2),
      otHours: ot.toFixed(2),
      spareHours: effectiveSpare.toFixed(2),
      remark: input.remark ?? null,
      createdById: actor.id,
    },
    update: {
      normalHours: normal.toFixed(2),
      otHours: ot.toFixed(2),
      spareHours: effectiveSpare.toFixed(2),
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
    remark: saved.remark,
    workerDisplayName: worker.displayName,
    workerType: worker.workerType,
  };
}

// Remove an attendance row — models a leave day (请假). MVP keeps the
// "no row = absent" convention, so deleting is the way to record a
// previously-entered day as leave.
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
      remark: true,
      worker: {
        select: { displayName: true, workerType: true },
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
    remark: r.remark,
    workerDisplayName: r.worker.displayName,
    workerType: r.worker.workerType as WorkerType,
  }));
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

function isHourlyWorkerType(
  type: WorkerType,
): type is (typeof HOURLY_WORKER_TYPES)[number] {
  return (HOURLY_WORKER_TYPES as readonly WorkerType[]).includes(type);
}

function dec(v: string | number | Decimal): Decimal {
  return new Decimal(v as Decimal.Value);
}
