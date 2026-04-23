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

  const rule = await getActiveMachineRule(worker.machineType, now);
  if (!rule) {
    throw new DailySalaryError(
      `无当前生效的 ${worker.machineType} 薪资规则`,
    );
  }

  const tasks = await db.productionTask.findMany({
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

  // Store the `@db.Date` column as UTC midnight for the Shanghai
  // calendar date. parseStrictYmd already returned this value inside
  // shanghaiDayRange — reusing the same parser here keeps the two
  // columns-vs-range views perfectly aligned.
  const dateCol = parseStrictYmd(date)!;

  // Refuse to recompute an already-paid row: the paid amount is a
  // finance-of-record value, and silently overwriting it would break
  // audit (Codex round 43 / P0). Owner must explicitly 撤销发放 first,
  // recompute, then re-mark paid — the trail stays visible.
  const existing = await db.dailyWorkerSalary.findUnique({
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

  await db.dailyWorkerSalary.upsert({
    where: { workerId_date: { workerId, date: dateCol } },
    create: {
      workerId,
      date: dateCol,
      machineType: worker.machineType,
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
      machineType: worker.machineType,
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
    machineType: worker.machineType,
    totalPieceworkAmount: totalPieceworkAmount.toFixed(2),
    baseSalary: baseSalary.toFixed(2),
    actualSalary: actualSalary.toFixed(2),
    taskCount,
    orderCount,
  };
}

// Batch: for every active machine-type worker, compute the given day.
// Used by the cron endpoint (24:00 每日 per SPEC §3.8) and by the
// owner's "recompute" button. Returns per-worker results for display.
export async function computeDailyForAllMachineWorkers(
  date: string,
  now: Date = new Date(),
): Promise<DailyWorkerSalaryResult[]> {
  const workers = await db.user.findMany({
    where: {
      role: Role.WORKER,
      workerType: WorkerType.MACHINE,
      isActive: true,
      machineType: { not: null },
    },
    select: { id: true },
  });
  const results: DailyWorkerSalaryResult[] = [];
  for (const w of workers) {
    // Serialized on purpose — one compute per worker is a single-
    // row upsert with no cross-worker interaction; parallelizing would
    // only help I/O and risks pool exhaustion on large teams.
    results.push(await computeDailyWorkerSalary(w.id, date, now));
  }
  return results;
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
    const [y, mo, d] = filter.date.split('-').map(Number);
    where.date = new Date(Date.UTC(y!, mo! - 1, d!));
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
  const updated = await db.dailyWorkerSalary.update({
    where: { id },
    data: {
      isPaid,
      paidAt: isPaid ? now : null,
    },
    select: { id: true, isPaid: true },
  });
  return updated;
}

// Shadow export of the rule type so callers don't have to reach into
// ./machine-piecework separately.
export type { MachineSalaryRule };
