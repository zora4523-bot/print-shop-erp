import Decimal from 'decimal.js';
import {
  MachineType,
  Role,
  SalaryAdjustmentType,
  WorkerType,
} from '../../generated/prisma/enums';
import { db } from '../db';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import { parseStrictYmd } from '../auth/schemas';
import {
  calcMachineDailySalary,
  type MachineSalaryRule,
} from './machine-piecework';
import {
  getActiveMachineRule,
  machineRuleLockKey,
  type MachineRuleWithBase,
} from './rules';

// Asia/Shanghai is the business timezone (UTC+8, no DST). A calendar
// date for salary purposes means a 24-hour window starting at Shanghai
// midnight, i.e. UTC day-previous 16:00 → UTC day 16:00. We compute
// that range ourselves rather than relying on `toLocaleDateString`
// quirks.
const SHANGHAI_OFFSET_HOURS = 8;
const DECIMAL_10_2_MAX = new Decimal('99999999.99');

export class DailySalaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailySalaryError';
  }
}

function storableSalaryAmount(
  value: Decimal.Value,
  label: string,
  options: { allowNegative?: boolean } = {},
): Decimal {
  let amount: Decimal;
  try {
    amount = new Decimal(value);
  } catch {
    throw new DailySalaryError(`${label}不是有效金额`);
  }
  if (!amount.isFinite()) {
    throw new DailySalaryError(`${label}不是有效金额`);
  }
  if (!options.allowNegative && amount.isNegative()) {
    throw new DailySalaryError(`${label}不能小于 0`);
  }
  if (amount.decimalPlaces() > 2) {
    throw new DailySalaryError(`${label}小数最多 2 位，不能静默舍入`);
  }
  if (amount.toDecimalPlaces(2).abs().gt(DECIMAL_10_2_MAX)) {
    throw new DailySalaryError(
      `${label}超过系统可保存上限 99,999,999.99 元`,
    );
  }
  return amount;
}

// Takes a YYYY-MM-DD calendar date string (as stored in the Prisma
// `@db.Date` column) and returns the matching [start, end) UTC instant
// range. Pure helper, exported for testing.
export function shanghaiDayRange(date: string): { start: Date; end: Date } {
  // Strict calendar check — rejects 2026-02-31 and other rollover
  // traps that `new Date(string)` would silently normalize. parseStrictYmd returns a UTC-midnight Date for
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

// Per-(worker, date) advisory lock. Closes two races (mirrors the hourly fix):
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
  now?: Date,
): Promise<DailyWorkerSalaryResult> {
  const { start, end } = shanghaiDayRange(date);
  const ruleAt = now ?? new Date(end.getTime() - 1);

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
    // audit . Owner must explicitly 撤销发放 first,
    // recompute, then re-mark paid — the trail stays visible.
    const existing = await tx.dailyWorkerSalary.findUnique({
      where: { workerId_date: { workerId, date: dateCol } },
      select: {
        id: true,
        isPaid: true,
        actualSalary: true,
        adjustmentAmount: true,
      },
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
        OR: [
          { workerType: WorkerType.MACHINE },
          { workerType: null, machineType: { not: null } },
        ],
      },
      select: {
        id: true,
        workerType: true,
        machineType: true,
        completedQty: true,
        defectQty: true,
        reworkQty: true,
        boardCount: true,
        pressCount: true,
        pieceworkAmount: true,
        salaryRuleSnapshot: true,
        completedAt: true,
        craft: { select: { id: true, name: true } },
        orderItem: {
          select: {
            id: true,
            orderId: true,
            name: true,
            order: { select: { orderNo: true } },
          },
        },
      },
    });

    // A completed task is an immutable payroll fact. Current account role,
    // worker type and active state control future assignment only; they must
    // not erase already-earned wages after an admin changes the account.
    // Legacy tasks without both identity snapshots are ambiguous, so fail
    // closed instead of guessing from the mutable User row.
    for (const task of tasks) {
      if (
        task.workerType !== WorkerType.MACHINE ||
        task.machineType === null
      ) {
        throw new DailySalaryError(
          `任务 ${task.id} 缺少完工时工种或机型快照，不能安全汇总工资`,
        );
      }
    }

    if (tasks.length === 0) {
      if (worker.role !== Role.WORKER) {
        throw new DailySalaryError('不是师傅（role != WORKER）');
      }
      if (worker.workerType !== WorkerType.MACHINE) {
        throw new DailySalaryError(
          '不是开机师傅（仅 WorkerType.MACHINE 走日薪汇总）',
        );
      }
      if (!worker.isActive) {
        throw new DailySalaryError('师傅已停用且当日没有已完成计件任务');
      }
      if (!worker.machineType) {
        throw new DailySalaryError('师傅未配置机型');
      }
    }
    const primaryMachineType: MachineType =
      tasks[0]?.machineType ?? worker.machineType!;

    for (const task of tasks) {
      storableSalaryAmount(
        task.pieceworkAmount as Decimal.Value,
        `任务 ${task.id} 计件金额`,
      );
    }

    const { totalPieceworkAmount, taskCount, orderCount, detail } =
      aggregateTasks(tasks);
    storableSalaryAmount(totalPieceworkAmount, '当日计件合计');

    // A worker may operate more than one registered machine in a day. Task
    // piecework is already frozen from each task's own machine-rule snapshot;
    // the daily floor is the highest active dailyBase among the machine types
    // actually worked. With no completed task, retain the historical behavior
    // and fall back to the account's primary machine.
    const workedMachineTypes = tasks.length
      ? [
          ...new Set(
            tasks.map((task) => task.machineType!),
          ),
        ].sort((left, right) => {
          if (left === right) return 0;
          if (left === primaryMachineType) return -1;
          if (right === primaryMachineType) return 1;
          return left.localeCompare(right);
        })
      : [primaryMachineType];
    for (const workedMachineType of workedMachineTypes) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${machineRuleLockKey(
        workerId,
        workedMachineType,
      )}))`;
    }
    const resolvedRules: Array<{
      machineType: MachineType;
      rule: MachineRuleWithBase | null;
    }> = [];
    for (const workedMachineType of workedMachineTypes) {
      resolvedRules.push({
        machineType: workedMachineType,
        rule: await getActiveMachineRule(
          workedMachineType,
          ruleAt,
          workerId,
          tx,
        ),
      });
    }
    const missingRule = resolvedRules.find(({ rule }) => !rule);
    if (missingRule) {
      throw new DailySalaryError(
        `无当前生效的 ${missingRule.machineType} 薪资规则`,
      );
    }
    const rules = resolvedRules as Array<{
      machineType: MachineType;
      rule: MachineRuleWithBase;
    }>;
    const rulesWithBase = rules.map((entry) => ({
      ...entry,
      dailyBase: storableSalaryAmount(
        entry.rule.dailyBase as Decimal.Value,
        `${entry.machineType} 每日保底`,
      ),
    }));
    const baseRule = rulesWithBase.reduce((highest, candidate) =>
      candidate.dailyBase.gt(highest.dailyBase)
        ? candidate
        : highest,
    );
    const machineType = baseRule.machineType;
    const rule = baseRule.rule;
    const baseSalary = baseRule.dailyBase;
    const ruleByMachine = new Map(
      rules.map((entry) => [entry.machineType, entry.rule]),
    );
    const salaryRuleSnapshot = {
      ...rule,
      dailyBasePolicy:
        tasks.length > 0
          ? 'MAX_WORKED_MACHINE_TYPES'
          : 'PRIMARY_MACHINE_FALLBACK',
      baseMachineType: machineType,
      workedMachineTypes,
      machineRules: Object.fromEntries(
        rules.map((entry) => [entry.machineType, entry.rule]),
      ),
    };
    const grossSalary = calcMachineDailySalary(
      tasks.map((t) => new Decimal(t.pieceworkAmount as Decimal.Value)),
      baseSalary,
    );
    const adjustmentAmount = storableSalaryAmount(
      existing?.adjustmentAmount as Decimal.Value ?? 0,
      '人工调整合计',
      { allowNegative: true },
    );
    const adjustedSalary = grossSalary.plus(adjustmentAmount);
    if (adjustedSalary.isNegative()) {
      throw new DailySalaryError(
        '重算后的工资小于 0，请先追加一条纠正调整流水再重算',
      );
    }
    const actualSalary = storableSalaryAmount(
      adjustedSalary,
      '当日实发金额',
    );

    const dailySalary = await tx.dailyWorkerSalary.upsert({
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
        salaryRuleSnapshot: JSON.parse(JSON.stringify(salaryRuleSnapshot)),
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
        salaryRuleSnapshot: JSON.parse(JSON.stringify(salaryRuleSnapshot)),
      },
      select: { id: true },
    });

    // The detail table is a reproducible ledger, not a second source of
    // truth. A permitted recompute replaces the unpaid day's snapshots in
    // the same transaction as the aggregate row.
    await tx.dailyWorkerSalaryItem.deleteMany({
      where: { dailySalaryId: dailySalary.id },
    });
    if (tasks.length > 0) {
      await tx.dailyWorkerSalaryItem.createMany({
        data: tasks.map((task) => ({
          dailySalaryId: dailySalary.id,
          productionTaskId: task.id,
          orderId: task.orderItem.orderId,
          orderNo: task.orderItem.order.orderNo,
          orderItemId: task.orderItem.id,
          orderItemName: task.orderItem.name,
          craftId: task.craft.id,
          craftName: task.craft.name,
          machineType: task.machineType!,
          completedQty: task.completedQty,
          defectQty: task.defectQty,
          reworkQty: task.reworkQty,
          boardCount: task.boardCount,
          pressCount: task.pressCount,
          pieceworkAmount: String(task.pieceworkAmount),
          salaryRuleSnapshot: JSON.parse(
            JSON.stringify(
                task.salaryRuleSnapshot ??
                ruleByMachine.get(task.machineType!) ??
                rule,
            ),
          ),
          completedAt: task.completedAt!,
        })),
      });
    }

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
  errors: Array<{ workerId: string; workerName: string; message: string }>;
};

// Earlier workers may already be committed when a later database or
// programming failure interrupts the batch. Keep those results attached to
// the error so the cron layer can report safe counts, then rethrow for the
// durable worker to retry the unfinished tail.
export class DailyBatchUnexpectedError extends Error {
  readonly partialResult: BatchDailyResult;

  constructor(message: string, partialResult: BatchDailyResult, cause: unknown) {
    super(message, { cause });
    this.name = 'DailyBatchUnexpectedError';
    this.partialResult = partialResult;
  }
}

// Per-worker try/catch so one bad worker (paid row, missing rule,
// etc.) doesn't abort the whole batch — matches the hourly + cs
// batch patterns (rounds 45, 48). Also closes a cron-log leak path:
// aborting the batch propagated error messages with salary amounts
// up to the cron JSON response . With per-
// worker error capture, the cron can return counts only.
export async function computeDailyForAllMachineWorkers(
  date: string,
  now?: Date,
): Promise<BatchDailyResult> {
  const { start, end } = shanghaiDayRange(date);
  const settled: DailyWorkerSalaryResult[] = [];
  const errors: Array<{ workerId: string; workerName: string; message: string }> = [];
  let workers: Array<{ id: string; displayName: string }>;
  try {
    workers = await db.user.findMany({
      where: {
        OR: [
          {
            role: Role.WORKER,
            workerType: WorkerType.MACHINE,
            isActive: true,
            machineType: { not: null },
          },
          {
            assignedTasks: {
              some: {
                status: 'COMPLETED',
                completedAt: { gte: start, lt: end },
                OR: [
                  { workerType: WorkerType.MACHINE },
                  // Legacy machine tasks may predate workerType while still
                  // carrying their machine snapshot. Include them so the
                  // single-worker path emits an explicit reconciliation error.
                  {
                    workerType: null,
                    machineType: { not: null },
                  },
                ],
              },
            },
          },
        ],
      },
      select: { id: true, displayName: true },
    });
  } catch (cause) {
    throw new DailyBatchUnexpectedError(
      '日薪批量扫描失败',
      { settled, errors },
      cause,
    );
  }
  for (const w of workers) {
    try {
      settled.push(await computeDailyWorkerSalary(w.id, date, now));
    } catch (err) {
      if (err instanceof DailySalaryError) {
        errors.push({
          workerId: w.id,
          workerName: w.displayName,
          message: err.message,
        });
        continue;
      }
      throw new DailyBatchUnexpectedError(
        `师傅 ${w.id} 日薪计算发生系统错误`,
        { settled, errors },
        err,
      );
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
    // .
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
      adjustmentAmount: true,
      actualSalary: true,
      taskCount: true,
      orderCount: true,
      isPaid: true,
      paidAt: true,
      worker: { select: { displayName: true } },
    },
  });
}

export async function listMachineWorkersForSalary() {
  return db.user.findMany({
    where: {
      role: Role.WORKER,
      workerType: WorkerType.MACHINE,
      isActive: true,
      machineType: { not: null },
    },
    orderBy: { displayName: 'asc' },
    select: { id: true, displayName: true, username: true },
  });
}

export async function getDailyWorkerSalaryDetail(id: string) {
  return db.dailyWorkerSalary.findUnique({
    where: { id },
    include: {
      worker: {
        select: {
          id: true,
          displayName: true,
          username: true,
          machineType: true,
        },
      },
      items: {
        orderBy: [{ completedAt: 'asc' }, { orderNo: 'asc' }],
      },
      adjustments: {
        orderBy: { createdAt: 'asc' },
        include: {
          createdBy: { select: { displayName: true, username: true } },
        },
      },
    },
  });
}

export async function getOrderPieceworkSummary(orderId: string) {
  const items = await db.dailyWorkerSalaryItem.findMany({
    where: { orderId },
    orderBy: { completedAt: 'asc' },
    select: {
      id: true,
      dailySalaryId: true,
      productionTaskId: true,
      orderItemName: true,
      craftName: true,
      completedQty: true,
      defectQty: true,
      reworkQty: true,
      boardCount: true,
      pressCount: true,
      pieceworkAmount: true,
      completedAt: true,
      dailySalary: {
        select: {
          date: true,
          worker: { select: { displayName: true } },
        },
      },
    },
  });
  const total = items.reduce(
    (sum, item) => sum.plus(new Decimal(item.pieceworkAmount as Decimal.Value)),
    new Decimal(0),
  );
  return { items, total: total.toFixed(2) };
}

export async function addDailySalaryAdjustment(input: {
  idempotencyKey: string;
  dailySalaryId: string;
  type: SalaryAdjustmentType;
  amount: string;
  reason: string;
  actor: AuditActor;
}) {
  let rawAmount: Decimal;
  try {
    rawAmount = new Decimal(input.amount);
  } catch {
    throw new DailySalaryError('调整金额必须是非零数字');
  }
  if (!rawAmount.isFinite() || rawAmount.isZero()) {
    throw new DailySalaryError('调整金额必须是非零数字');
  }
  const signedAmount =
    input.type === SalaryAdjustmentType.BONUS
      ? rawAmount.abs()
      : input.type === SalaryAdjustmentType.DEDUCTION
        ? rawAmount.abs().negated()
        : rawAmount;
  storableSalaryAmount(signedAmount, '调整金额', {
    allowNegative: true,
  });
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) {
    throw new DailySalaryError('调整请求标识不能为空');
  }
  const reason = input.reason.trim();

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:salary-adjustment-request:${idempotencyKey}`}))`;
    const replay = await tx.salaryAdjustment.findUnique({
      where: { idempotencyKey },
      select: {
        id: true,
        idempotencyKey: true,
        dailySalaryId: true,
        type: true,
        amount: true,
        reason: true,
        createdById: true,
        dailySalary: {
          select: { adjustmentAmount: true, actualSalary: true },
        },
      },
    });
    if (replay) {
      if (
        replay.dailySalaryId !== input.dailySalaryId ||
        replay.type !== input.type ||
        !new Decimal(replay.amount as Decimal.Value).eq(signedAmount) ||
        replay.reason !== reason ||
        replay.createdById !== input.actor.id
      ) {
        throw new DailySalaryError(
          '调整请求标识已被其他记录使用，请刷新后重试',
        );
      }
      return {
        id: replay.id,
        amount: String(replay.amount),
        adjustmentAmount: String(replay.dailySalary.adjustmentAmount),
        actualSalary: String(replay.dailySalary.actualSalary),
      };
    }

    const initial = await tx.dailyWorkerSalary.findUnique({
      where: { id: input.dailySalaryId },
      select: { workerId: true, date: true },
    });
    if (!initial) throw new DailySalaryError('日薪记录不存在');
    const dateKey = initial.date.toISOString().slice(0, 10);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dailyLockKey(
      initial.workerId,
      dateKey,
    )}))`;

    const salary = await tx.dailyWorkerSalary.findUnique({
      where: { id: input.dailySalaryId },
      select: {
        id: true,
        isPaid: true,
        baseSalary: true,
        totalPieceworkAmount: true,
      },
    });
    if (!salary) throw new DailySalaryError('日薪记录不存在');
    if (salary.isPaid) {
      throw new DailySalaryError('已发放工资不能调整，请先撤销发放');
    }

    const adjustment = await tx.salaryAdjustment.create({
      data: {
        idempotencyKey,
        dailySalaryId: salary.id,
        type: input.type,
        amount: signedAmount.toFixed(2),
        reason,
        createdById: input.actor.id,
      },
      select: { id: true, amount: true },
    });
    const aggregate = await tx.salaryAdjustment.aggregate({
      where: { dailySalaryId: salary.id },
      _sum: { amount: true },
    });
    const adjustmentAmount = storableSalaryAmount(
      aggregate._sum.amount as Decimal.Value ?? 0,
      '人工调整合计',
      { allowNegative: true },
    );
    const gross = Decimal.max(
      storableSalaryAmount(
        salary.baseSalary as Decimal.Value,
        '每日保底',
      ),
      storableSalaryAmount(
        salary.totalPieceworkAmount as Decimal.Value,
        '当日计件合计',
      ),
    );
    const actualSalary = gross.plus(adjustmentAmount);
    if (actualSalary.isNegative()) {
      throw new DailySalaryError('调整后实发金额不能小于 0');
    }
    storableSalaryAmount(actualSalary, '调整后实发金额');
    await tx.dailyWorkerSalary.update({
      where: { id: salary.id },
      data: {
        adjustmentAmount: adjustmentAmount.toFixed(2),
        actualSalary: actualSalary.toFixed(2),
      },
    });
    await writeAuditLogInTx(tx, {
      actor: input.actor,
      action: 'CREATE',
      entityType: 'SalaryAdjustment',
      entityId: adjustment.id,
      after: {
        idempotencyKey,
        dailySalaryId: input.dailySalaryId,
        type: input.type,
        amount: input.amount,
        reason,
        signedAmount: String(adjustment.amount),
      },
      requestMetadata: {
        source: 'owner-salary.addDailySalaryAdjustmentAction',
        route: `/owner/salary/daily/${input.dailySalaryId}`,
      },
    });
    return {
      id: adjustment.id,
      amount: String(adjustment.amount),
      adjustmentAmount: adjustmentAmount.toFixed(2),
      actualSalary: actualSalary.toFixed(2),
    };
  });
}

export async function markDailySalaryPaid(
  id: string,
  isPaid: boolean,
  now: Date = new Date(),
): Promise<{ id: string; isPaid: boolean; workerName: string }> {
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
      // workerName 供调用方渲染「已标记 XXX 为已发放」的确认条——
      // 发钱操作必须有可读的回执，不能只吐 id。
      select: {
        id: true,
        isPaid: true,
        worker: { select: { displayName: true } },
      },
    });
    return {
      id: updated.id,
      isPaid: updated.isPaid,
      workerName: updated.worker.displayName,
    };
  });
}

// Shadow export of the rule type so callers don't have to reach into
// ./machine-piecework separately.
export type { MachineSalaryRule };
