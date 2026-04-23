import Decimal from 'decimal.js';
import { MachineType, Role, WorkerType } from '../../generated/prisma/enums';
import { db } from '../db';
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
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) {
    throw new DailySalaryError(`日期格式非法（应为 YYYY-MM-DD）：${date}`);
  }
  const [, y, mo, d] = m;
  // UTC midnight for the given Shanghai date minus the +8 offset.
  const start = new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), -SHANGHAI_OFFSET_HOURS, 0, 0),
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

  // Store the `@db.Date` column as a UTC midnight for the Shanghai
  // calendar date; Prisma strips the time when the column is Date.
  // Constructing via Date.UTC matches shanghaiDayRange's convention.
  const [y, mo, d] = date.split('-').map(Number);
  const dateCol = new Date(Date.UTC(y!, mo! - 1, d!));

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
