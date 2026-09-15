import { paginatedResult, paginationWindow, parsePositiveInt } from '../admin/table';
import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import { Role, WorkerType } from '../../generated/prisma/enums';
import { db } from '../db';
import {
  assertExecutionFence,
  type ExecutionFence,
} from '../execution-fence';
import { parseShanghaiMonth } from '../attendance';
import {
  currentShanghaiMonth,
  isFutureShanghaiMonth,
} from '../dashboard/shanghai-clock';
import {
  calcHourlyPayroll,
  HourlyPayrollError,
  type HourlyPayrollRules,
} from './hourly-payroll';
import {
  employmentCoversDate,
  employmentOverlapsDateRange,
} from './employment';
import {
  hourlyPayrollLockKey,
  salaryIdentityLockKey,
} from './hourly-lock';
import {
  acquireSalaryRuleSnapshotReadLock,
  getActiveCleanerHourlyRate,
  getActiveCookMonthlyBase,
  getActiveCookSpareHourlyRate,
  getActiveOtMultiplier,
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
  cleanerRate: number | null;
  cookMonthly: number | null;
  cookSpareRate: number | null;
  otMultiplier: number | null;
  workHours: WorkHoursConfig | null;
}>;

async function readHourlyRuleBundle(
  now: Date,
  client: Parameters<typeof getActiveCleanerHourlyRate>[1],
): Promise<HourlyRuleBundle> {
  const [
    cleanerRate,
    cookMonthly,
    cookSpareRate,
    otMultiplier,
    workHours,
  ] = await Promise.all([
    getActiveCleanerHourlyRate(now, client),
    getActiveCookMonthlyBase(now, client),
    getActiveCookSpareHourlyRate(now, client),
    getActiveOtMultiplier(now, client),
    getActiveWorkHours(now, client),
  ]);
  return {
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

const DECIMAL_6_2_MAX = new Decimal('9999.99');
const DECIMAL_4_2_MAX = new Decimal('99.99');
const DECIMAL_10_2_MAX = new Decimal('99999999.99');
const DECIMAL_11_2_MAX = new Decimal('999999999.99');

function assertStoredDecimal(
  value: Decimal,
  max: Decimal,
  label: string,
  options: { positive?: boolean } = {},
): void {
  if (
    !value.isFinite() ||
    (options.positive ? value.lte(0) : value.isNegative()) ||
    value.decimalPlaces() > 2 ||
    value.gt(max)
  ) {
    throw new HourlyAggregateError(`${label}超出可保存范围`);
  }
}

function parseStoredDecimal(
  value: unknown,
  max: Decimal,
  label: string,
  options: { positive?: boolean } = {},
): Decimal {
  let parsed: Decimal;
  try {
    parsed = dec(value);
  } catch {
    throw new HourlyAggregateError(`${label}不是合法数值`);
  }
  assertStoredDecimal(parsed, max, label, options);
  return parsed;
}

const ACTIVE_HOURLY_WORKER_TYPES = [
  WorkerType.CLEANER,
  WorkerType.COOK,
] as const;

const HISTORICAL_HOURLY_WORKER_TYPES = [
  WorkerType.PACKER,
  ...ACTIVE_HOURLY_WORKER_TYPES,
] as const;

const HOURLY_WORKER_SELECT = {
  id: true,
  role: true,
  workerType: true,
  isActive: true,
  displayName: true,
  employmentStartDate: true,
  employmentEndDate: true,
} satisfies Prisma.UserSelect;

const HOURLY_ATTENDANCE_SELECT = {
  date: true,
  normalHours: true,
  otHours: true,
  spareHours: true,
  roleSnapshot: true,
  workerTypeSnapshot: true,
} satisfies Prisma.AttendanceSelect;

type HourlyWorker = Prisma.UserGetPayload<{
  select: typeof HOURLY_WORKER_SELECT;
}>;

type HourlyAttendanceRow = Prisma.AttendanceGetPayload<{
  select: typeof HOURLY_ATTENDANCE_SELECT;
}>;

type ActiveHourlyWorkerType = (typeof ACTIVE_HOURLY_WORKER_TYPES)[number];

function isHistoricalHourlyAttendanceRow(
  row: HourlyAttendanceRow,
): row is HourlyAttendanceRow & {
  roleSnapshot: typeof Role.WORKER;
  workerTypeSnapshot: ActiveHourlyWorkerType;
} {
  return (
    row.roleSnapshot === Role.WORKER &&
    isActiveHourlyWorkerType(row.workerTypeSnapshot)
  );
}

function isHourlyWorkerType(value: unknown): value is WorkerType {
  return (HISTORICAL_HOURLY_WORKER_TYPES as readonly unknown[]).includes(value);
}

function isActiveHourlyWorkerType(value: unknown): value is WorkerType {
  return (ACTIVE_HOURLY_WORKER_TYPES as readonly unknown[]).includes(value);
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
// pair is serialized end-to-end. Attendance writers use the same key and
// invalidate an unpaid derivative whenever its source facts really change.

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

function resolveHourlyWorkerType(
  worker: HourlyWorker,
  historicalTypes: readonly WorkerType[],
): WorkerType {
  if (historicalTypes.length > 1) {
    throw new HourlyAggregateError(
      `同一月份存在多个历史时薪工种（${historicalTypes.join('、')}），请先拆分或核对考勤后再结算`,
    );
  }
  if (historicalTypes.length === 1) return historicalTypes[0]!;
  if (
    worker.role === Role.WORKER &&
    worker.isActive &&
    isActiveHourlyWorkerType(worker.workerType)
  ) {
    return worker.workerType;
  }
  if (worker.role !== Role.WORKER) {
    throw new HourlyAggregateError('不是工人（role != WORKER）');
  }
  if (!isActiveHourlyWorkerType(worker.workerType)) {
    throw new HourlyAggregateError(
      '只有清废和厨师继续走时薪月结；打包报工已切换为工序计件结算',
    );
  }
  throw new HourlyAggregateError('工人已停用且本月没有历史时薪考勤');
}

function sumHourlyAttendance(rows: readonly HourlyAttendanceRow[]): {
  totalNormal: Decimal;
  totalOt: Decimal;
  totalSpare: Decimal;
} {
  const totalNormal = rows.reduce(
    (acc, row) => acc.plus(dec(row.normalHours)),
    new Decimal(0),
  );
  const totalOt = rows.reduce(
    (acc, row) => acc.plus(dec(row.otHours)),
    new Decimal(0),
  );
  const totalSpare = rows.reduce(
    (acc, row) => acc.plus(dec(row.spareHours)),
    new Decimal(0),
  );
  assertStoredDecimal(totalNormal, DECIMAL_6_2_MAX, '月正常工时');
  assertStoredDecimal(totalOt, DECIMAL_6_2_MAX, '月加班工时');
  assertStoredDecimal(totalSpare, DECIMAL_6_2_MAX, '月空闲打包工时');
  return { totalNormal, totalOt, totalSpare };
}

function resolveHourlyPayrollRules(
  workerType: WorkerType,
  bundle: HourlyRuleBundle,
): {
  rules: HourlyPayrollRules;
  hourlyRateForSchema: Decimal;
  effectiveOtMultiplier: Decimal;
} {
  const { cleanerRate, cookMonthly, cookSpareRate, otMultiplier } = bundle;
  let rules: HourlyPayrollRules;
  let hourlyRateForSchema: Decimal;
  if (workerType === WorkerType.CLEANER) {
    if (cleanerRate === null) {
      throw new HourlyAggregateError('无当前生效的 CLEANER_HOURLY 规则');
    }
    rules = { hourlyRate: cleanerRate, otMultiplier: otMultiplier ?? 1 };
    hourlyRateForSchema = parseStoredDecimal(
      cleanerRate,
      DECIMAL_6_2_MAX,
      '清废时薪规则',
    );
  } else {
    if (cookMonthly === null) {
      throw new HourlyAggregateError('无当前生效的 COOK_MONTHLY 规则');
    }
    // A missing spare-duty rate deliberately means this cook has no paid
    // packing duty (owner decision 2026-08-19).
    rules = {
      monthlyBase: cookMonthly,
      spareHourlyRate: cookSpareRate ?? 0,
      otMultiplier: otMultiplier ?? 1,
    };
    hourlyRateForSchema = parseStoredDecimal(
      cookSpareRate ?? 0,
      DECIMAL_6_2_MAX,
      '厨师空闲打包时薪规则',
    );
    parseStoredDecimal(cookMonthly, DECIMAL_10_2_MAX, '厨师月薪规则');
  }
  const effectiveOtMultiplier = parseStoredDecimal(
    otMultiplier ?? 1,
    DECIMAL_4_2_MAX,
    '加班倍率规则',
    { positive: true },
  );
  return { rules, hourlyRateForSchema, effectiveOtMultiplier };
}

function calculateHourlyBreakdown(
  workerType: WorkerType,
  totalNormal: Decimal,
  totalOt: Decimal,
  totalSpare: Decimal,
  rules: HourlyPayrollRules,
) {
  try {
    return calcHourlyPayroll(
      {
        workerType,
        totalNormalHours: totalNormal,
        totalOtHours: totalOt,
        totalSpareHours: totalSpare,
      },
      rules,
    );
  } catch (error) {
    if (error instanceof HourlyPayrollError) {
      throw new HourlyAggregateError(error.message);
    }
    throw error;
  }
}

async function computeHourlyPayrollInTx(
  tx: Prisma.TransactionClient,
  workerId: string,
  month: string,
  start: Date,
  end: Date,
  now: Date,
  pinnedRuleBundle?: HourlyRuleBundle,
  fence?: ExecutionFence,
): Promise<ComputeHourlyPayrollResult> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(
      workerId,
    )}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hourlyPayrollLockKey(
      workerId,
      month,
    )}))`;

    const worker = await tx.user.findUnique({
      where: { id: workerId },
      select: HOURLY_WORKER_SELECT,
    });
    if (!worker) throw new HourlyAggregateError('工人不存在');
    if (!employmentOverlapsDateRange(start, end, worker)) {
      throw new HourlyAggregateError(
        `${month} 月不在该员工的雇佣区间内，禁止计薪`,
      );
    }

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
      select: HOURLY_ATTENDANCE_SELECT,
      orderBy: { date: 'asc' },
    });

    // Employment boundaries are inclusive. Filter the source facts before
    // identity classification, aggregation and dailyDetail so every persisted
    // derivative is built from the same eligible row set.
    const employmentRows = rows.filter((row) =>
      employmentCoversDate(row.date, worker),
    );
    const historicalRows = employmentRows.filter(
      isHistoricalHourlyAttendanceRow,
    );
    const historicalTypes = [
      ...new Set(historicalRows.map((row) => row.workerTypeSnapshot)),
    ];
    // Historical attendance owns historical payroll. Current identity is only
    // a fallback for an active hourly worker with no recorded hourly fact, so
    // existing zero-hour / COOK monthly-base behavior remains intact.
    const workerType = resolveHourlyWorkerType(worker, historicalTypes);

    const payrollRows = historicalRows.filter(
      (row) => row.workerTypeSnapshot === workerType,
    );

    const { totalNormal, totalOt, totalSpare } =
      sumHourlyAttendance(payrollRows);

    // Standalone recomputes resolve all rule rows coherently inside this
    // transaction. Batch callers pass one already-frozen bundle so workers A
    // and B cannot straddle an admin rule edit between their transactions.
    if (!pinnedRuleBundle) {
      await acquireSalaryRuleSnapshotReadLock(tx);
    }
    const ruleBundle =
      pinnedRuleBundle ?? (await readHourlyRuleBundle(now, tx));
    const { cleanerRate, cookMonthly, cookSpareRate, otMultiplier, workHours } =
      ruleBundle;
    const { rules, hourlyRateForSchema, effectiveOtMultiplier } =
      resolveHourlyPayrollRules(workerType, ruleBundle);
    const breakdown = calculateHourlyBreakdown(
      workerType,
      totalNormal,
      totalOt,
      totalSpare,
      rules,
    );

    // Full rule snapshot + hour totals + WORK_HOURS config (注意事项 4).
    // Includes every rule we considered, even the ones this workerType
    // didn't use, so a later audit can reconstruct context (e.g. owner
    // wants to know "was OT multiplier already 1.5 when I paid out?").
    const salaryRuleSnapshot = {
      workerType,
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

    const baseSalary = breakdown.monthlyBasePay.gt(0)
      ? breakdown.monthlyBasePay
      : breakdown.normalPay;
    assertStoredDecimal(baseSalary, DECIMAL_11_2_MAX, '基本工资');
    assertStoredDecimal(breakdown.otPay, DECIMAL_11_2_MAX, '加班工资');
    assertStoredDecimal(breakdown.sparePay, DECIMAL_11_2_MAX, '空闲打包工资');
    assertStoredDecimal(breakdown.totalSalary, DECIMAL_11_2_MAX, '工资合计');

    // dailyDetail is a per-day breakdown for the UI drill-down.
    const dailyDetail = payrollRows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      normalHours: String(r.normalHours),
      otHours: String(r.otHours),
      spareHours: String(r.spareHours),
    }));

    // Rule/bill locks may outlive the durable lease while this transaction is
    // waiting. Fence again at the last read-only point before payroll upsert.
    await assertExecutionFence(fence);
    const saved = await tx.hourlyWorkerPayroll.upsert({
      where: { workerId_month: { workerId, month } },
      create: {
        workerId,
        month,
        totalWorkHours: totalNormal.toFixed(2),
        totalOtHours: totalOt.toFixed(2),
        totalSpareHours: totalSpare.toFixed(2),
        hourlyRate: hourlyRateForSchema.toFixed(2),
        otMultiplier: effectiveOtMultiplier.toFixed(2),
        baseSalary: baseSalary.toFixed(2),
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
        otMultiplier: effectiveOtMultiplier.toFixed(2),
        baseSalary: baseSalary.toFixed(2),
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
      otMultiplier: effectiveOtMultiplier.toFixed(2),
      baseSalary: baseSalary.toFixed(2),
      otSalary: breakdown.otPay.toFixed(2),
      spareSalary: breakdown.sparePay.toFixed(2),
      totalSalary: breakdown.totalSalary.toFixed(2),
    };
}

// Monthly computation for a single hourly worker. @@unique([workerId,
// month]) → upsert. Called per-worker from the cron batch and from
// the owner's "重算" button. `now` pins both rule resolution and a batch's
// shared wall-clock instant.
export async function computeHourlyPayroll(
  workerId: string,
  month: string,
  now: Date = new Date(),
  pinnedRuleBundle?: HourlyRuleBundle,
  fence?: ExecutionFence,
): Promise<ComputeHourlyPayrollResult> {
  const { start, end } = parseShanghaiMonth(month);
  assertNotFutureSalaryMonth(month, now);

  // Identity is locked before worker-month inside the same transaction, so
  // account mutations cannot race a stale identity into a payroll snapshot.
  return db.$transaction((tx) =>
    computeHourlyPayrollInTx(
      tx,
      workerId,
      month,
      start,
      end,
      now,
      pinnedRuleBundle,
      fence,
    ),
  );
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
  fence?: ExecutionFence,
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
        AND: [
          {
            OR: [
              {
                role: Role.WORKER,
                isActive: true,
                workerType: { in: [...ACTIVE_HOURLY_WORKER_TYPES] },
              },
              {
                attendanceRecords: {
                  some: {
                    date: { gte: start, lt: end },
                    roleSnapshot: Role.WORKER,
                    workerTypeSnapshot: {
                      in: [...ACTIVE_HOURLY_WORKER_TYPES],
                    },
                  },
                },
              },
            ],
          },
          {
            OR: [
              { employmentStartDate: null },
              { employmentStartDate: { lt: end } },
            ],
          },
          {
            OR: [
              { employmentEndDate: null },
              { employmentEndDate: { gte: start } },
            ],
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
      await assertExecutionFence(fence);
      settled.push(
        await computeHourlyPayroll(w.id, month, now, pinnedRuleBundle, fence),
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
  page?: string | string[];
  pageSize?: string | string[];
}) {
  if (filter.month !== undefined) {
    // Validate month format early — same reason listDailyWorkerSalaries
    // validates date early .
    parseShanghaiMonth(filter.month);
  }
  const where = {
      ...(filter.month ? { month: filter.month } : {}),
      ...(filter.workerId ? { workerId: filter.workerId } : {}),
      ...(filter.isPaid !== undefined ? { isPaid: filter.isPaid } : {}),
  };
  const [total, sums, unpaidSums] = await Promise.all([
    db.hourlyWorkerPayroll.count({ where }),
    db.hourlyWorkerPayroll.aggregate({ where, _sum: { totalSalary: true } }),
    db.hourlyWorkerPayroll.aggregate({ where: { AND: [where, { isPaid: false }] }, _sum: { totalSalary: true } }),
  ]);
  const window = paginationWindow(total,
    parsePositiveInt(filter.page, { defaultValue: 1 }),
    parsePositiveInt(filter.pageSize, { defaultValue: 50, max: 100 }));
  const rows = await db.hourlyWorkerPayroll.findMany({
    take: window.take,
    skip: window.skip,
    where,
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
  const mapped = rows.map((row) => ({
    ...row,
    payrollWorkerType: getHourlyPayrollWorkerType(row.salaryRuleSnapshot),
  }));
  return { ...paginatedResult(mapped, total, window),
    totalSalary: String(sums._sum.totalSalary ?? 0),
    unpaidSalary: String(unpaidSums._sum.totalSalary ?? 0),
  };
}

/** Whole-month confirmation must not inherit the visible page/filter.
 * Read narrow batches so neither full payroll rows nor snapshots accumulate.
 */
export async function getHourlyPayrollMonthContext(month: string) {
  parseShanghaiMonth(month);
  const workerIds: string[] = [];
  const sampleRows: Array<{ workerName: string; totalSalary: string; isPaid: boolean }> = [];
  let existingRecordCount = 0;
  let unpaidRecordCount = 0;
  let unpaidTotal = new Decimal(0);
  let cursor: string | undefined;
  while (true) {
    const rows = await db.hourlyWorkerPayroll.findMany({
      where: { month },
      orderBy: { workerId: 'asc' },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, workerId: true, totalSalary: true, isPaid: true,
        salaryRuleSnapshot: true, worker: { select: { displayName: true } },
      },
    });
    for (const row of rows) {
      workerIds.push(row.workerId);
      if (getHourlyPayrollWorkerType(row.salaryRuleSnapshot) === WorkerType.PACKER) continue;
      existingRecordCount += 1;
      if (!row.isPaid) {
        unpaidRecordCount += 1;
        unpaidTotal = unpaidTotal.plus(String(row.totalSalary));
      }
      if (sampleRows.length < 5) sampleRows.push({
        workerName: row.worker.displayName, totalSalary: String(row.totalSalary), isPaid: row.isPaid,
      });
    }
    if (rows.length < 100) break;
    cursor = rows[rows.length - 1].id;
  }
  return { workerIds, context: {
    existingRecordCount, unpaidRecordCount,
    paidRecordCount: existingRecordCount - unpaidRecordCount,
    unpaidTotal: unpaidTotal.toFixed(2), sampleRows,
  } };
}

export async function markHourlyPayrollPaid(
  id: string,
  isPaid: boolean,
  now: Date = new Date(),
): Promise<{ id: string; isPaid: boolean; workerName: string }> {
  // Same advisory lock as computeHourlyPayroll so a mark-paid landing
  // mid-recompute blocks until the recompute's tx commits — no more
  // paid-row amount overwrite .
  return db.$transaction(async (tx) => {
    // The first read only discovers the immutable lock coordinates. An
    // attendance edit may delete an unpaid derivative while this operation is
    // waiting for the lock, so this row is never trusted for the update.
    const lockIdentity = await tx.hourlyWorkerPayroll.findUnique({
      where: { id },
      select: {
        workerId: true,
        month: true,
      },
    });
    if (!lockIdentity) {
      throw new HourlyAggregateError('月结记录不存在');
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hourlyPayrollLockKey(
      lockIdentity.workerId,
      lockIdentity.month,
    )}))`;

    // Re-read after the shared lock. recordAttendance/removeAttendance delete
    // unpaid payrolls under this same lock when source facts change; using the
    // pre-lock object would let a stale amount be marked paid afterwards.
    const row = await tx.hourlyWorkerPayroll.findUnique({
      where: { id },
      select: {
        workerId: true,
        month: true,
        isPaid: true,
        salaryRuleSnapshot: true,
        worker: { select: { displayName: true } },
      },
    });
    if (!row) {
      throw new HourlyAggregateError('考勤已变更，月结记录已失效，请重新计算');
    }
    if (
      row.workerId !== lockIdentity.workerId ||
      row.month !== lockIdentity.month
    ) {
      throw new HourlyAggregateError('月结归属已变化，请刷新后重试');
    }
    if (
      getHourlyPayrollWorkerType(row.salaryRuleSnapshot) === WorkerType.PACKER
    ) {
      throw new HourlyAggregateError(
        '历史打包时薪快照只读保留；新打包报工已切换为工序计件结算',
      );
    }
    // 当月可以临时重算，但月末前不能标已发；特别是 COOK 的固定月薪
    // 不按进度折算，中途发放会冻结整月金额并阻断后续考勤重算。
    if (isPaid && row.month >= currentShanghaiMonth(now)) {
      throw new HourlyAggregateError(
        `不能将当前或未来月份的月结标记为已发（${row.month}，上海日历）；请等该月结束后再发放`,
      );
    }
    // A lost response or a lock waiter may repeat the same transition. Keep
    // the first payment timestamp and derivative snapshot untouched on replay.
    if (row.isPaid === isPaid) {
      return { id, isPaid: row.isPaid, workerName: row.worker.displayName };
    }
    const updated = await tx.hourlyWorkerPayroll.update({
      where: { id },
      data: {
        isPaid,
        paidAt: isPaid ? now : null,
      },
      select: { id: true, isPaid: true },
    });
    return {
      ...updated,
      workerName: row.worker.displayName,
    };
  });
}
