import Decimal from 'decimal.js';
import { MachineType, Role, WorkerType } from '../../generated/prisma/enums';
import { db } from '../db';
import { parseStrictYmd } from '../auth/schemas';
import {
  calcMachineDailySalary,
  type MachineSalaryRule,
} from './machine-piecework';
import { getActiveMachineRule, type MachineRuleWithBase } from './rules';

// Asia/Shanghai is the business timezone (UTC+8, no DST). A calendar
// date for salary purposes means a 24-hour window starting at Shanghai
// midnight, i.e. UTC day-previous 16:00 → UTC day 16:00. We compute
// that range ourselves rather than relying on `toLocaleDateString`
// quirks.
const SHANGHAI_OFFSET_HOURS = 8;

export class DailySalaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailySalaryError';
  }
}

// Takes a YYYY-MM-DD calendar date string (as stored in the Prisma
// `@db.Date` column) and returns the matching [start, end) UTC instant
// range. Pure helper, exported for testing.
export function shanghaiDayRange(date: string): { start: Date; end: Date } {
  // Strict calendar check — rejects 2026-02-31 and other rollover
  // traps that `new Date(string)` would silently normalize (Codex
  // round 43 / P1). parseStrictYmd returns a UTC-midnight Date for
  // the input calendar date.
  const utcMidnight = parseStrictYmd(date);
  if (!utcMidnight) {
    throw new DailySalaryError(
      `日期格式非法或非法日历日期（应为合法 YYYY-MM-DD）：${date}`,
    );
  }
  // Shanghai is UTC+8 and has no DST, so a Shanghai calendar day
  // spans from (UTC-midnight − 8h) to (UTC-midnight + 16h).
  const start = new Date(
    utcMidnight.getTime() - SHANGHAI_OFFSET_HOURS * 60 * 60 * 1000,
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// Pure aggregator for already-fetched task rows. Sums pieceworkAmount
// across tasks and counts distinct orderIds. Exported for testing so
// the DB layer below doesn't need a full fixture to validate
// arithmetic.
export type TaskForDaily = {
  pieceworkAmount: unknown; // Prisma Decimal
  orderItem: { orderId: string };
};

export function aggregateTasks(tasks: readonly TaskForDaily[]): {
  totalPieceworkAmount: Decimal;
  taskCount: number;
  orderCount: number;
  detail: Array<{ pieceworkAmount: string; orderId: string }>;
} {
  let total = new Decimal(0);
  const orders = new Set<string>();
  const detail: Array<{ pieceworkAmount: string; orderId: string }> = [];
  for (const t of tasks) {
    const amt = new Decimal(t.pieceworkAmount as Decimal.Value);
    total = total.plus(amt);
    orders.add(t.orderItem.orderId);
    detail.push({
      pieceworkAmount: amt.toFixed(2),
      orderId: t.orderItem.orderId,
    });
  }
  return {
    totalPieceworkAmount: total,
    taskCount: tasks.length,
    orderCount: orders.size,
    detail,
  };
}

export type DailyWorkerSalaryResult = {
  workerId: string;
  date: string;
  machineType: MachineType;
  totalPieceworkAmount: string;
  baseSalary: string;
  actualSalary: string;
  taskCount: number;
  orderCount: number;
};

// Per-(worker, date) advisory lock. Closes two races (mirrors Codex
// round 48 hourly fix / P0):
// 1. recompute vs mark-paid: recompute reads isPaid=false, mark-paid
//    flips to true, recompute's upsert still rewrites the now-paid row.
// 2. two concurrent recomputes for the same (worker, date) both
//    passing the paid guard and double-writing.
// markDailySalaryPaid takes the same lock so the check-and-update
// pair is serialized end-to-end.
function dailyLockKey(workerId: string, date: string): string {
  return `print-shop-erp:daily:${workerId}:${date}`;
}

// Compute (or recompute) one worker × one date. Upserts on
// @@unique([workerId, date]) so re-running the job on an already-
// processed day is idempotent and corrects any after-the-fact task
// reports.
export async function computeDailyWorkerSalary(
  workerId: string,
  date: string,
  now: Date = new Date(),
): Promise<DailyWorkerSalaryResult> {
  const { start, end } = shanghaiDayRange(date);

  const worker = await db.user.findUnique({
    where: { id: workerId },
    select: {
      id: true,
      role: true,
      workerType: true,
      machineType: true,
      isActive: true,
    },
  });
  if (!worker) throw new DailySalaryError('师傅不存在');
  if (worker.role !== Role.WORKER) {
    throw new DailySalaryError('不是师傅（role != WORKER）');
  }
  if (worker.workerType !== WorkerType.MACHINE) {
    throw new DailySalaryError(
      '不是开机师傅（仅 WorkerType.MACHINE 走日薪汇总）',
    );
  }
  if (!worker.machineType) {
    throw new DailySalaryError('师傅未配置机型');
  }
  // Hoist the narrowed machineType into a non-null local — TS loses
  // flow narrowing across the $transaction arrow body's closure (same
  // pattern as computeHourlyPayroll).
  const machineType: MachineType = worker.machineType;

  const rule = await getActiveMachineRule(machineType, now);
  if (!rule) {
    throw new DailySalaryError(
      `无当前生效的 ${machineType} 薪资规则`,
    );
  }

  // Store the `@db.Date` column as UTC midnight for the Shanghai
  // calendar date. parseStrictYmd already returned this value inside
  // shanghaiDayRange — reusing the same parser here keeps the two
  // columns-vs-range views perfectly aligned.
  const dateCol = parseStrictYmd(date)!;

  // Everything past here runs in ONE transaction under the per-
  // (worker, date) advisory lock so the paid-row guard and the upsert
  // can't be interleaved with a concurrent markDailySalaryPaid.
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dailyLockKey(
      workerId,
      date,
    )}))`;

    // Refuse to recompute an already-paid row: the paid amount is a
    // finance-of-record value, and silently overwriting it would break
    // audit (Codex round 43 / P0). Owner must explicitly 撤销发放 first,
    // recompute, then re-mark paid — the trail stays visible.
    const existing = await tx.dailyWorkerSalary.findUnique({
      where: { workerId_date: { workerId, date: dateCol } },
      select: { id: true, isPaid: true, actualSalary: true },
    });
    if (existing?.isPaid) {
      throw new DailySalaryError(
        `该日已标记发放（${date} · 师傅 ${workerId} · 实发 ¥${String(
          existing.actualSalary,
        )}），请先撤销发放再重算。`,
      );
    }

    const tasks = await tx.productionTask.findMany({
      where: {
        workerId,
        status: 'COMPLETED',
        completedAt: { gte: start, lt: end },
      },
      select: {
        pieceworkAmount: true,
        orderItem: { select: { orderId: true } },
      },
    });

    const { totalPieceworkAmount, taskCount, orderCount, detail } =
      aggregateTasks(tasks);

    const baseSalary = new Decimal((rule as MachineRuleWithBase).dailyBase);
    const actualSalary = calcMachineDailySalary(
      tasks.map((t) => new Decimal(t.pieceworkAmount as Decimal.Value)),
      baseSalary,
    );

    await tx.dailyWorkerSalary.upsert({
      where: { workerId_date: { workerId, date: dateCol } },
      create: {
        workerId,
        date: dateCol,
        machineType,
        baseSalary: baseSalary.toFixed(2),
        totalPieceworkAmount: totalPieceworkAmount.toFixed(2),
        actualSalary: actualSalary.toFixed(2),
        taskCount,
        orderCount,
        calculationDetail: detail,
        salaryRuleSnapshot: JSON.parse(JSON.stringify(rule)),
      },
      update: {
        // isPaid / paidAt stay whatever they already are; finance
        // shouldn't have its mark-paid reverted by a recompute. The
        // recompute is allowed to change the NUMBERS — that's the
        // point — but the payment ledger entry is separate.
        machineType,
        baseSalary: baseSalary.toFixed(2),
        totalPieceworkAmount: totalPieceworkAmount.toFixed(2),
        actualSalary: actualSalary.toFixed(2),
        taskCount,
        orderCount,
        calculationDetail: detail,
        salaryRuleSnapshot: JSON.parse(JSON.stringify(rule)),
      },
    });

    return {
      workerId,
      date,
      machineType,
      totalPieceworkAmount: totalPieceworkAmount.toFixed(2),
      baseSalary: baseSalary.toFixed(2),
      actualSalary: actualSalary.toFixed(2),
      taskCount,
      orderCount,
    };
  });
}

// Batch: for every active machine-type worker, compute the given day.
// Used by the cron endpoint (24:00 每日 per SPEC §3.8) and by the
// owner's "recompute" button. Returns per-worker results for display.
export type BatchDailyResult = {
  settled: DailyWorkerSalaryResult[];
  errors: Array<{ workerId: string; message: string }>;
};

// Per-worker try/catch so one bad worker (paid row, missing rule,
// etc.) doesn't abort the whole batch — matches the hourly + cs
// batch patterns (rounds 45, 48). Also closes a cron-log leak path:
// aborting the batch propagated error messages with salary amounts
// up to the cron JSON response (Codex round 50 / P2). With per-
// worker error capture, the cron can return counts only.
export async function computeDailyForAllMachineWorkers(
  date: string,
  now: Date = new Date(),
): Promise<BatchDailyResult> {
  const workers = await db.user.findMany({
    where: {
      role: Role.WORKER,
      workerType: WorkerType.MACHINE,
      isActive: true,
      machineType: { not: null },
    },
    select: { id: true },
  });
  const settled: DailyWorkerSalaryResult[] = [];
  const errors: Array<{ workerId: string; message: string }> = [];
  for (const w of workers) {
    try {
      settled.push(await computeDailyWorkerSalary(w.id, date, now));
    } catch (err) {
      errors.push({
        workerId: w.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { settled, errors };
}

// ─────────────────────────────────────────────────────────────────────
// Reads for the owner dashboard
// ─────────────────────────────────────────────────────────────────────

export async function listDailyWorkerSalaries(filter: {
  date?: string;
  workerId?: string;
  isPaid?: boolean;
}) {
  const where: {
    date?: Date;
    workerId?: string;
    isPaid?: boolean;
  } = {};
  if (filter.date) {
    // Strict calendar parse on the read path too, so an invalid
    // ?date=2026-02-31 filter doesn't silently match March 3 rows
    // (Codex round 44 / P3).
    const parsed = parseStrictYmd(filter.date);
    if (!parsed) {
      throw new DailySalaryError(
        `日期格式非法或非法日历日期（应为合法 YYYY-MM-DD）：${filter.date}`,
      );
    }
    where.date = parsed;
  }
  if (filter.workerId) where.workerId = filter.workerId;
  if (filter.isPaid !== undefined) where.isPaid = filter.isPaid;

  return db.dailyWorkerSalary.findMany({
    where,
    orderBy: [{ date: 'desc' }, { workerId: 'asc' }],
    select: {
      id: true,
      workerId: true,
      date: true,
      machineType: true,
      baseSalary: true,
      totalPieceworkAmount: true,
      actualSalary: true,
      taskCount: true,
      orderCount: true,
      isPaid: true,
      paidAt: true,
      worker: { select: { displayName: true } },
    },
  });
}

export async function markDailySalaryPaid(
  id: string,
  isPaid: boolean,
  now: Date = new Date(),
): Promise<{ id: string; isPaid: boolean }> {
  // Same advisory lock as computeDailyWorkerSalary so a mark-paid
  // landing mid-recompute blocks until the recompute's tx commits —
  // no more paid-row amount overwrite. Lock key needs (workerId, date),
  // which we resolve from the row first.
  return db.$transaction(async (tx) => {
    const row = await tx.dailyWorkerSalary.findUnique({
      where: { id },
      select: { workerId: true, date: true },
    });
    if (!row) {
      throw new DailySalaryError('日薪记录不存在');
    }
    const dateKey = row.date.toISOString().slice(0, 10);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dailyLockKey(
      row.workerId,
      dateKey,
    )}))`;
    const updated = await tx.dailyWorkerSalary.update({
      where: { id },
      data: {
        isPaid,
        paidAt: isPaid ? now : null,
      },
      select: { id: true, isPaid: true },
    });
    return updated;
  });
}

// Shadow export of the rule type so callers don't have to reach into
// ./machine-piecework separately.
export type { MachineSalaryRule };
