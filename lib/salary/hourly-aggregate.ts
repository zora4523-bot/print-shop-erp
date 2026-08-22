import Decimal from 'decimal.js';
import { Role, WorkerType } from '../../generated/prisma/enums';
import { db } from '../db';
import { parseShanghaiMonth } from '../attendance';
import { isFutureShanghaiMonth } from '../dashboard/shanghai-clock';
import {
  calcHourlyPayroll,
  HourlyPayrollError,
  type HourlyPayrollRules,
} from './hourly-payroll';
import {
  acquireSalaryRuleSnapshotReadLock,
  getActiveCleanerHourlyRate,
  getActiveCookMonthlyBase,
  getActiveCookSpareHourlyRate,
  getActiveOtMultiplier,
  getActivePackerHourlyRate,
  getActiveWorkHours,
  type WorkHoursConfig,
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

type HourlyRuleBundle = Readonly<{
  packerRate: number | null;
  cleanerRate: number | null;
  cookMonthly: number | null;
  cookSpareRate: number | null;
  otMultiplier: number | null;
  workHours: WorkHoursConfig | null;
}>;

async function readHourlyRuleBundle(
  now: Date,
  client: Parameters<typeof getActivePackerHourlyRate>[1],
): Promise<HourlyRuleBundle> {
  const [
    packerRate,
    cleanerRate,
    cookMonthly,
    cookSpareRate,
    otMultiplier,
    workHours,
  ] = await Promise.all([
    getActivePackerHourlyRate(now, client),
    getActiveCleanerHourlyRate(now, client),
    getActiveCookMonthlyBase(now, client),
    getActiveCookSpareHourlyRate(now, client),
    getActiveOtMultiplier(now, client),
    getActiveWorkHours(now, client),
  ]);
  return {
    packerRate,
    cleanerRate,
    cookMonthly,
    cookSpareRate,
    otMultiplier,
    workHours,
  };
}

// A batch must not re-resolve rules between workers: the admin may publish a
// backdated version after worker A commits and before worker B starts. Read one
// coherent value bundle under the shared writer-exclusion lock, then pass that
// immutable bundle to every independent worker transaction.
async function loadHourlyRuleBundle(now: Date): Promise<HourlyRuleBundle> {
  return db.$transaction(async (tx) => {
    await acquireSalaryRuleSnapshotReadLock(tx);
    return readHourlyRuleBundle(now, tx);
  });
}

function dec(v: unknown): Decimal {
  return new Decimal(v as Decimal.Value);
}

const HOURLY_WORKER_TYPES = [
  WorkerType.PACKER,
  WorkerType.CLEANER,
  WorkerType.COOK,
] as const;

function isHourlyWorkerType(value: unknown): value is WorkerType {
  return (HOURLY_WORKER_TYPES as readonly unknown[]).includes(value);
}

export function getHourlyPayrollWorkerType(snapshot: unknown): WorkerType | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }
  const value = (snapshot as Record<string, unknown>).workerType;
  return isHourlyWorkerType(value) ? value : null;
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

// 与 lib/salary/daily.ts 的 assertNotFutureSalaryDate 同构、同理由：守卫必须
// 落在 lib/，因为 owner action、/api/cron/hourly-payroll 的 inline 分支、
// durable worker 三条写路径都只经过本文件这两个函数。
//
// 未来月份的考勤必然为空，而 COOK 分支的 monthlyBasePay 是**整月 flat**
// （见 lib/salary/hourly-payroll.ts 的 COOK 分支，不按天折算），所以一次
// 误操作直接写出一整月厨师月固定工资。
//
// 口径：只拒绝**严格未来**，当月允许（见 assertNotFutureSalaryDate 的口径
// 说明；当月是否也该拒，见本次改动附带的业主待拍板项）。
function assertNotFutureSalaryMonth(month: string, now: Date): void {
  if (isFutureShanghaiMonth(month, now)) {
    throw new HourlyAggregateError(
      `不能结算未来月份（${month}，上海日历）：该月尚未开始，` +
        `考勤必然为空，写出的只会是一条凭空的月固定工资，` +
        `且一旦被标记已发就只能人工撤销。请等该月结束后再结算。`,
    );
  }
}

// Monthly computation for a single hourly worker. @@unique([workerId,
// month]) → upsert. Called per-worker from the cron batch and from
// the owner's "重算" button. `now` pins both the rule-resolution
// timestamp (so a batch sees a consistent rule version) AND the paidAt stamp when paths flip state.
export async function computeHourlyPayroll(
  workerId: string,
  month: string,
  now: Date = new Date(),
  pinnedRuleBundle?: HourlyRuleBundle,
): Promise<ComputeHourlyPayrollResult> {
  const { start, end } = parseShanghaiMonth(month);
  // `now` 在这个函数里同时是规则解析时点和 paidAt 时钟，这里直接复用它当
  // 墙上时钟：批量调用方传的是整批钉住的那一个 now，单独重算走默认的
  // new Date()。
  assertNotFutureSalaryMonth(month, now);

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
        roleSnapshot: true,
        workerTypeSnapshot: true,
      },
      orderBy: { date: 'asc' },
    });

    const historicalRows = rows.filter(
      (row) =>
        row.roleSnapshot === Role.WORKER &&
        isHourlyWorkerType(row.workerTypeSnapshot),
    );
    const historicalTypes = [
      ...new Set(historicalRows.map((row) => row.workerTypeSnapshot)),
    ];
    if (historicalTypes.length > 1) {
      throw new HourlyAggregateError(
        `同一月份存在多个历史时薪工种（${historicalTypes.join('、')}），请先拆分或核对考勤后再结算`,
      );
    }

    // Historical attendance owns historical payroll. Current identity is only
    // a fallback for an active hourly worker with no recorded hourly fact, so
    // existing zero-hour / COOK monthly-base behavior remains intact.
    let workerType: WorkerType;
    if (historicalTypes.length === 1) {
      workerType = historicalTypes[0]!;
    } else if (
      worker.role === Role.WORKER &&
      worker.isActive &&
      isHourlyWorkerType(worker.workerType)
    ) {
      workerType = worker.workerType;
    } else {
      if (worker.role !== Role.WORKER) {
        throw new HourlyAggregateError('不是工人（role != WORKER）');
      }
      if (!isHourlyWorkerType(worker.workerType)) {
        throw new HourlyAggregateError(
          '仅时薪工（打包 / 清废 / 厨师）走月结；机器师傅是日薪，请看 /owner/salary/daily',
        );
      }
      throw new HourlyAggregateError(
        '工人已停用且本月没有历史时薪考勤',
      );
    }

    const payrollRows = historicalRows.filter(
      (row) => row.workerTypeSnapshot === workerType,
    );

    const totalNormal = payrollRows.reduce(
      (acc, r) => acc.plus(dec(r.normalHours)),
      new Decimal(0),
    );
    const totalOt = payrollRows.reduce(
      (acc, r) => acc.plus(dec(r.otHours)),
      new Decimal(0),
    );
    const totalSpare = payrollRows.reduce(
      (acc, r) => acc.plus(dec(r.spareHours)),
      new Decimal(0),
    );

    // Standalone recomputes resolve all rule rows coherently inside this
    // transaction. Batch callers pass one already-frozen bundle so workers A
    // and B cannot straddle an admin rule edit between their transactions.
    if (!pinnedRuleBundle) {
      await acquireSalaryRuleSnapshotReadLock(tx);
    }
    const {
      packerRate,
      cleanerRate,
      cookMonthly,
      cookSpareRate,
      otMultiplier,
      workHours,
    } = pinnedRuleBundle ?? (await readHourlyRuleBundle(now, tx));

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
        // `?? 0` 在这里是**有意的**，与上面三个分支的 throw 不同 ——
        // 空闲打包对厨师是可选职责，没配 COOK_SPARE_HOURLY 更可能表示
        // 「这个厨师不打包」而不是「配置漏了」，所以按 0 计空闲工资而不是
        // 让整个月结失败。这是 CLAUDE.md §15.5「绝不 fallback 到 0」的
        // 唯一显式例外（业主 2026-08-19 拍板，见 DECISIONS.md），行为由
        // lib/salary/__tests__/hourly-payroll.test.ts:186 锁定。
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
    const dailyDetail = payrollRows.map((r) => ({
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
  errors: Array<{ workerId: string; workerName: string; message: string }>;
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
  const { start, end } = parseShanghaiMonth(month);
  // 同 computeDailyForAllMachineWorkers：月份错是整批的输入错，不该被逐人
  // 捕获成 errors[] 而让调用方看到 status:'success'。
  assertNotFutureSalaryMonth(month, now);

  const settled: ComputeHourlyPayrollResult[] = [];
  const errors: Array<{ workerId: string; workerName: string; message: string }> = [];
  let workers: Array<{ id: string; displayName: string }>;
  try {
    workers = await db.user.findMany({
      where: {
        OR: [
          {
            role: Role.WORKER,
            isActive: true,
            workerType: { in: [...HOURLY_WORKER_TYPES] },
          },
          {
            attendanceRecords: {
              some: {
                date: { gte: start, lt: end },
                roleSnapshot: Role.WORKER,
                workerTypeSnapshot: { in: [...HOURLY_WORKER_TYPES] },
              },
            },
          },
        ],
      },
      select: { id: true, displayName: true },
    });
  } catch (cause) {
    throw new HourlyBatchUnexpectedError(
      '时薪批量扫描失败',
      { settled, errors },
      cause,
    );
  }

  if (workers.length === 0) return { settled, errors };

  let pinnedRuleBundle: HourlyRuleBundle;
  try {
    pinnedRuleBundle = await loadHourlyRuleBundle(now);
  } catch (cause) {
    throw new HourlyBatchUnexpectedError(
      '时薪规则快照读取失败',
      { settled, errors },
      cause,
    );
  }

  for (const w of workers) {
    try {
      settled.push(
        await computeHourlyPayroll(w.id, month, now, pinnedRuleBundle),
      );
    } catch (err) {
      if (err instanceof HourlyAggregateError) {
        errors.push({
          workerId: w.id,
          workerName: w.displayName,
          message: err.message,
        });
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
  const rows = await db.hourlyWorkerPayroll.findMany({
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
      salaryRuleSnapshot: true,
      worker: { select: { displayName: true } },
    },
  });
  return rows.map((row) => ({
    ...row,
    payrollWorkerType: getHourlyPayrollWorkerType(row.salaryRuleSnapshot),
  }));
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
