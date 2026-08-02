import Decimal from 'decimal.js';
import { Role, WorkerType } from '../../generated/prisma/enums';
import { db } from '../db';
import { parseShanghaiMonth } from '../attendance';
import {
  calcHourlyPayroll,
  HourlyPayrollError,
  type HourlyPayrollRules,
} from './hourly-payroll';
import {
  getActiveCleanerHourlyRate,
  getActiveCookMonthlyBase,
  getActiveCookSpareHourlyRate,
  getActiveOtMultiplier,
  getActivePackerHourlyRate,
  getActiveWorkHours,
} from './rules';

// 时薪工月结 — 把 Attendance 的月度汇总 + active SalaryRule 组合起来
// 调纯函数 calcHourlyPayroll，然后 upsert HourlyWorkerPayroll。
// 已发放行拒绝重算（沿用 round 43 finance-of-record 铁律）。

export class HourlyAggregateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HourlyAggregateError';
  }
}

export type ComputeHourlyPayrollResult = {
  payrollId: string;
  workerId: string;
  month: string;
  workerType: WorkerType;
  totalNormalHours: string;
  totalOtHours: string;
  totalSpareHours: string;
  hourlyRate: string;
  otMultiplier: string;
  baseSalary: string;
  otSalary: string;
  spareSalary: string;
  totalSalary: string;
};

function dec(v: unknown): Decimal {
  return new Decimal(v as Decimal.Value);
}

// Per-(worker, month) advisory lock. Closes two races :
// 1. recompute vs mark-paid: recompute reads isPaid=false, mark-paid
//    flips to true, recompute's upsert still rewrites the now-paid row.
// 2. two concurrent recomputes for the same (worker, month) both
//    passing the paid guard and double-writing.
// markHourlyPayrollPaid takes the same lock so the check-and-update
// pair is serialized end-to-end.
function hourlyLockKey(workerId: string, month: string): string {
  return `print-shop-erp:hourly:${workerId}:${month}`;
}

// Monthly computation for a single hourly worker. @@unique([workerId,
// month]) → upsert. Called per-worker from the cron batch and from
// the owner's "重算" button. `now` pins both the rule-resolution
// timestamp (so a batch sees a consistent rule version) AND the paidAt stamp when paths flip state.
export async function computeHourlyPayroll(
  workerId: string,
  month: string,
  now: Date = new Date(),
): Promise<ComputeHourlyPayrollResult> {
  const { start, end } = parseShanghaiMonth(month);

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
  if (!worker) throw new HourlyAggregateError('工人不存在');
  if (worker.role !== Role.WORKER) {
    throw new HourlyAggregateError('不是工人（role != WORKER）');
  }
  if (
    worker.workerType !== WorkerType.PACKER &&
    worker.workerType !== WorkerType.CLEANER &&
    worker.workerType !== WorkerType.COOK
  ) {
    throw new HourlyAggregateError(
      '仅时薪工（打包 / 清废 / 厨师）走月结；机器师傅是日薪，请看 /owner/salary/daily',
    );
  }
  // Hoist the narrowed type into a non-null local — TS loses flow
  // narrowing across the $transaction arrow body's closure boundary.
  const workerType: WorkerType = worker.workerType;

  // Everything past here runs in ONE transaction under the per-
  // (worker, month) advisory lock so the paid-row guard and the
  // upsert can't be interleaved with a concurrent mark-paid action
  // .
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hourlyLockKey(
      workerId,
      month,
    )}))`;

    // finance-of-record: paid rows refuse recompute (same bedrock as
    // computeDailyWorkerSalary, DECISIONS 2026-04-24).
    const existing = await tx.hourlyWorkerPayroll.findUnique({
      where: { workerId_month: { workerId, month } },
      select: { id: true, isPaid: true, totalSalary: true },
    });
    if (existing?.isPaid) {
      throw new HourlyAggregateError(
        `该月工资已标记发放（${month} · ${worker.displayName} · 实发 ¥${String(
          existing.totalSalary,
        )}），请先撤销发放再重算。`,
      );
    }

    // Aggregate this month's attendance.
    const rows = await tx.attendance.findMany({
      where: {
        workerId,
        date: { gte: start, lt: end },
      },
      select: {
        date: true,
        normalHours: true,
        otHours: true,
        spareHours: true,
      },
      orderBy: { date: 'asc' },
    });

    const totalNormal = rows.reduce(
      (acc, r) => acc.plus(dec(r.normalHours)),
      new Decimal(0),
    );
    const totalOt = rows.reduce(
      (acc, r) => acc.plus(dec(r.otHours)),
      new Decimal(0),
    );
    const totalSpare = rows.reduce(
      (acc, r) => acc.plus(dec(r.spareHours)),
      new Decimal(0),
    );

    // Resolve rules AT `now` — batches pin one timestamp so every
    // worker in that month's settlement snapshots against the same
    // rule version . Rule reads still go via
    // global `db` rather than `tx`; that's safe because rule edits
    // mint new rows (they don't delete / mutate the row we read)
    // and the advisory lock means no concurrent writer to OUR payroll
    // row exists while we compute.
    const [
      packerRate,
      cleanerRate,
      cookMonthly,
      cookSpareRate,
      otMultiplier,
      workHours,
    ] = await Promise.all([
      getActivePackerHourlyRate(now),
      getActiveCleanerHourlyRate(now),
      getActiveCookMonthlyBase(now),
      getActiveCookSpareHourlyRate(now),
      getActiveOtMultiplier(now),
      getActiveWorkHours(now),
    ]);

    let rules: HourlyPayrollRules;
    let hourlyRateForSchema: Decimal; // DB column baseline — non-COOK uses
    // the worker's own rate; COOK stores 0 (basepay is flat).

    if (workerType === WorkerType.PACKER) {
      if (packerRate === null) {
        throw new HourlyAggregateError('无当前生效的 PACKER_HOURLY 规则');
      }
      rules = {
        hourlyRate: packerRate,
        otMultiplier: otMultiplier ?? 1,
      };
      hourlyRateForSchema = dec(packerRate);
    } else if (workerType === WorkerType.CLEANER) {
      if (cleanerRate === null) {
        throw new HourlyAggregateError('无当前生效的 CLEANER_HOURLY 规则');
      }
      rules = {
        hourlyRate: cleanerRate,
        otMultiplier: otMultiplier ?? 1,
      };
      hourlyRateForSchema = dec(cleanerRate);
    } else {
      // COOK
      if (cookMonthly === null) {
        throw new HourlyAggregateError('无当前生效的 COOK_MONTHLY 规则');
      }
      rules = {
        monthlyBase: cookMonthly,
        spareHourlyRate: cookSpareRate ?? 0,
        otMultiplier: otMultiplier ?? 1,
      };
      // Store spareHourlyRate in the hourlyRate column for COOK so the
      // UI can show "按 ¥11/h 算打包兼职" without a separate field.
      hourlyRateForSchema = dec(cookSpareRate ?? 0);
    }

    let breakdown;
    try {
      breakdown = calcHourlyPayroll(
        {
          workerType,
          totalNormalHours: totalNormal,
          totalOtHours: totalOt,
          totalSpareHours: totalSpare,
        },
        rules,
      );
    } catch (err) {
      if (err instanceof HourlyPayrollError) {
        throw new HourlyAggregateError(err.message);
      }
      throw err;
    }

    // Full rule snapshot + hour totals + WORK_HOURS config (注意事项 4).
    // Includes every rule we considered, even the ones this workerType
    // didn't use, so a later audit can reconstruct context (e.g. owner
    // wants to know "was OT multiplier already 1.5 when I paid out?").
    const salaryRuleSnapshot = {
      workerType,
      packerHourlyRate: packerRate,
      cleanerHourlyRate: cleanerRate,
      cookMonthlyBase: cookMonthly,
      cookSpareHourlyRate: cookSpareRate,
      otMultiplier: otMultiplier,
      workHours,
      // Copy the aggregated hour totals so the row is self-contained.
      totals: {
        normalHours: totalNormal.toFixed(2),
        otHours: totalOt.toFixed(2),
        spareHours: totalSpare.toFixed(2),
      },
    };

    const effectiveOtMultiplier = otMultiplier ?? 1;

    // dailyDetail is a per-day breakdown for the UI drill-down.
    const dailyDetail = rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      normalHours: String(r.normalHours),
      otHours: String(r.otHours),
      spareHours: String(r.spareHours),
    }));

    const saved = await tx.hourlyWorkerPayroll.upsert({
      where: { workerId_month: { workerId, month } },
      create: {
        workerId,
        month,
        totalWorkHours: totalNormal.toFixed(2),
        totalOtHours: totalOt.toFixed(2),
        totalSpareHours: totalSpare.toFixed(2),
        hourlyRate: hourlyRateForSchema.toFixed(2),
        otMultiplier: new Decimal(effectiveOtMultiplier).toFixed(2),
        baseSalary: breakdown.monthlyBasePay.gt(0)
          ? breakdown.monthlyBasePay.toFixed(2)
          : breakdown.normalPay.toFixed(2),
        otSalary: breakdown.otPay.toFixed(2),
        spareSalary: breakdown.sparePay.toFixed(2),
        totalSalary: breakdown.totalSalary.toFixed(2),
        dailyDetail,
        salaryRuleSnapshot: JSON.parse(JSON.stringify(salaryRuleSnapshot)),
      },
      update: {
        totalWorkHours: totalNormal.toFixed(2),
        totalOtHours: totalOt.toFixed(2),
        totalSpareHours: totalSpare.toFixed(2),
        hourlyRate: hourlyRateForSchema.toFixed(2),
        otMultiplier: new Decimal(effectiveOtMultiplier).toFixed(2),
        baseSalary: breakdown.monthlyBasePay.gt(0)
          ? breakdown.monthlyBasePay.toFixed(2)
          : breakdown.normalPay.toFixed(2),
        otSalary: breakdown.otPay.toFixed(2),
        spareSalary: breakdown.sparePay.toFixed(2),
        totalSalary: breakdown.totalSalary.toFixed(2),
        dailyDetail,
        salaryRuleSnapshot: JSON.parse(JSON.stringify(salaryRuleSnapshot)),
        // isPaid / paidAt are deliberately not in the update branch —
        // paid rows are rejected earlier; unpaid rows keep whatever
        // payment state they had (should always be false here).
      },
      select: { id: true },
    });

    return {
      payrollId: saved.id,
      workerId,
      month,
      workerType,
      totalNormalHours: totalNormal.toFixed(2),
      totalOtHours: totalOt.toFixed(2),
      totalSpareHours: totalSpare.toFixed(2),
      hourlyRate: hourlyRateForSchema.toFixed(2),
      otMultiplier: new Decimal(effectiveOtMultiplier).toFixed(2),
      baseSalary: breakdown.monthlyBasePay.gt(0)
        ? breakdown.monthlyBasePay.toFixed(2)
        : breakdown.normalPay.toFixed(2),
      otSalary: breakdown.otPay.toFixed(2),
      spareSalary: breakdown.sparePay.toFixed(2),
      totalSalary: breakdown.totalSalary.toFixed(2),
    };
  });
}

// Batch: compute for every active hourly worker in the given month.
// Per-worker try/catch so one bad worker doesn't abort the batch
// (matches round 45's settleReadyCsPeriods pattern).
export type BatchHourlyResult = {
  settled: ComputeHourlyPayrollResult[];
  errors: Array<{ workerId: string; message: string }>;
};

// Preserve already committed payroll rows when an unexpected failure stops a
// later worker. The cron runner reports only safe counts and rethrows this
// error so the durable job is retried instead of being marked successful.
export class HourlyBatchUnexpectedError extends Error {
  readonly partialResult: BatchHourlyResult;

  constructor(message: string, partialResult: BatchHourlyResult, cause: unknown) {
    super(message, { cause });
    this.name = 'HourlyBatchUnexpectedError';
    this.partialResult = partialResult;
  }
}

export async function computeHourlyForAllInMonth(
  month: string,
  now: Date = new Date(),
): Promise<BatchHourlyResult> {
  // Bounds-check month before fanout so the early bail matches the
  // single-worker signature.
  parseShanghaiMonth(month);

  const settled: ComputeHourlyPayrollResult[] = [];
  const errors: Array<{ workerId: string; message: string }> = [];
  let workers: Array<{ id: string }>;
  try {
    workers = await db.user.findMany({
      where: {
        role: Role.WORKER,
        isActive: true,
        workerType: {
          in: [WorkerType.PACKER, WorkerType.CLEANER, WorkerType.COOK],
        },
      },
      select: { id: true },
    });
  } catch (cause) {
    throw new HourlyBatchUnexpectedError(
      '时薪批量扫描失败',
      { settled, errors },
      cause,
    );
  }

  for (const w of workers) {
    try {
      settled.push(await computeHourlyPayroll(w.id, month, now));
    } catch (err) {
      if (err instanceof HourlyAggregateError) {
        errors.push({ workerId: w.id, message: err.message });
        continue;
      }
      throw new HourlyBatchUnexpectedError(
        `师傅 ${w.id} 时薪计算发生系统错误`,
        { settled, errors },
        err,
      );
    }
  }
  return { settled, errors };
}

// ─────────────────────────────────────────────────────────────────────
// Read helpers for the owner UI
// ─────────────────────────────────────────────────────────────────────

export async function listHourlyPayrolls(filter: {
  month?: string;
  workerId?: string;
  isPaid?: boolean;
}) {
  if (filter.month !== undefined) {
    // Validate month format early — same reason listDailyWorkerSalaries
    // validates date early .
    parseShanghaiMonth(filter.month);
  }
  return db.hourlyWorkerPayroll.findMany({
    where: {
      ...(filter.month ? { month: filter.month } : {}),
      ...(filter.workerId ? { workerId: filter.workerId } : {}),
      ...(filter.isPaid !== undefined ? { isPaid: filter.isPaid } : {}),
    },
    orderBy: [{ month: 'desc' }, { workerId: 'asc' }],
    select: {
      id: true,
      workerId: true,
      month: true,
      totalWorkHours: true,
      totalOtHours: true,
      totalSpareHours: true,
      hourlyRate: true,
      otMultiplier: true,
      baseSalary: true,
      otSalary: true,
      spareSalary: true,
      totalSalary: true,
      isPaid: true,
      paidAt: true,
      worker: { select: { displayName: true, workerType: true } },
    },
  });
}

export async function markHourlyPayrollPaid(
  id: string,
  isPaid: boolean,
  now: Date = new Date(),
): Promise<{ id: string; isPaid: boolean }> {
  // Same advisory lock as computeHourlyPayroll so a mark-paid landing
  // mid-recompute blocks until the recompute's tx commits — no more
  // paid-row amount overwrite .
  return db.$transaction(async (tx) => {
    const row = await tx.hourlyWorkerPayroll.findUnique({
      where: { id },
      select: { workerId: true, month: true },
    });
    if (!row) {
      throw new HourlyAggregateError('月结记录不存在');
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hourlyLockKey(
      row.workerId,
      row.month,
    )}))`;
    const updated = await tx.hourlyWorkerPayroll.update({
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
