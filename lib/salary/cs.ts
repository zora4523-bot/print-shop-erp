import Decimal from 'decimal.js';
import {
  Role,
  SalaryPeriodStatus,
  SalaryRuleType,
} from '../../generated/prisma/enums';
import { db } from '../db';
import {
  assertExecutionFence,
  type ExecutionFence,
} from '../execution-fence';
import { parseStrictYmd } from '../auth/schemas';
import { todayShanghai } from '../dashboard/shanghai-clock';
import { dispatchNotification } from '../notification/dispatch';
import type { NotificationPayloadFor } from '../notification/events';
import { enqueueNotificationInTransaction } from '../notification/transactional-outbox';
import type { EnqueueClient } from '../background-jobs/repository';
import {
  calcCsCommission,
  calcCsMonthlyBaseTotal,
  calcCsTotalIncome,
  type CsTiersConfig,
} from './cs-commission';
import {
  acquireSalaryRuleSnapshotReadLock,
  getActiveRuleValue,
  type SalaryRuleClient,
} from './rules';
import {
  transitionCsPeriod,
  InvalidCsPeriodTransitionError,
} from './cs/status-machine';
import { csUserLockKey } from './cs-lock';
import {
  clampContinuousMonthlySalaryWindow,
  computeMonthlyPeriodEnd,
  monthlySalaryWindowWithinEmployment,
} from './employment';
import { salaryIdentityLockKey } from './hourly-lock';

// Every mutation of a CS user's period, sales ledger, or payroll ledger uses
// the same user-scoped lock. This serializes settlement against order sales
// accrual and wage payments without first needing a mutable period id.
function csPayrollRequestLockKey(idempotencyKey: string): string {
  return `print-shop-erp:cs-payroll-request:${idempotencyKey}`;
}

// Minimal tx surface for rule reads — we need to go through `tx`

// ─────────────────────────────────────────────────────────────────────
// CS period lifecycle (SPEC §3.7 / §5.3 / §5.5)
// ─────────────────────────────────────────────────────────────────────

export class CsPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsPeriodError';
  }
}

const DECIMAL_10_2_MAX = new Decimal('99999999.99');
const DECIMAL_12_2_MAX = new Decimal('9999999999.99');
const DECIMAL_13_2_MAX = new Decimal('99999999999.99');

function assertStoredMoney(
  value: Decimal,
  max: Decimal,
  label: string,
  options: { allowNegative?: boolean } = {},
): void {
  if (
    !value.isFinite() ||
    (!options.allowNegative && value.isNegative()) ||
    value.decimalPlaces() > 2 ||
    value.abs().gt(max)
  ) {
    throw new CsPeriodError(`${label}超出可保存的金额范围`);
  }
}

// periodEnd is the *inclusive* last day of the period: it's
// periodStart + durationMonths − 1 day. e.g. periodStart 2026-01-01,
// durationMonths=4 → periodEnd 2026-04-30. This matches SPEC §7.3
// "2026-01 ~ 2026-04" (4 calendar months, ending 2026-04-30).
export function computePeriodEnd(
  periodStart: Date,
  durationMonths: number,
): Date {
  return computeMonthlyPeriodEnd(periodStart, durationMonths);
}

export type StartCsPeriodInput = {
  csUserId: string;
  periodStart: string; // YYYY-MM-DD
  durationMonths?: number; // overrides CS_PERIOD_LENGTH
  initialSales?: string | number;
  monthlyBase?: string | number; // overrides CS_BASE_SALARY
  baseMonthsAlreadyPaid?: number; // historical import only
};

export type StartedPeriod = {
  id: string;
  csUserId: string;
  periodStart: string;
  periodEnd: string;
  durationMonths: number;
  monthlyBase: string;
  initialSales: string;
};

function formatYmdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${dd}`;
}

// SalaryPeriod periodStart / periodEnd are @db.Date values represented by
// Prisma at UTC midnight. Convert a real instant to the same date-only
// representation using the Shanghai business calendar before comparing them.
function shanghaiDateColumnValue(at: Date): Date {
  const value = parseStrictYmd(todayShanghai(at));
  if (!value) throw new CsPeriodError('时间参数非法');
  return value;
}

export function isCsPeriodDue(periodEnd: Date, now: Date = new Date()): boolean {
  return periodEnd.getTime() < shanghaiDateColumnValue(now).getTime();
}

function assertPeriodIsDue(periodEnd: Date, now: Date): void {
  if (!isCsPeriodDue(periodEnd, now)) {
    throw new CsPeriodError('客服周期尚未结束，不能提前结算');
  }
}

// Creates a new IN_PROGRESS SalaryPeriod for a CS user. Refuses if the
// user isn't CUSTOMER_SERVICE, if any finance-of-record period overlaps,
// or if required rules (CS_PERIOD_LENGTH / CS_BASE_SALARY) are missing
// and no override is supplied.
export async function startCsPeriod(
  input: StartCsPeriodInput,
  now: Date = new Date(),
  actor?: { id: string; role: Role },
): Promise<StartedPeriod> {
  const start = parseStrictYmd(input.periodStart);
  if (!start) {
    throw new CsPeriodError(
      `周期起始日期非法（应为合法 YYYY-MM-DD）：${input.periodStart}`,
    );
  }

  const baseMonthsAlreadyPaid = input.baseMonthsAlreadyPaid ?? 0;
  if (!Number.isInteger(baseMonthsAlreadyPaid) || baseMonthsAlreadyPaid < 0) {
    throw new CsPeriodError('已发底薪月数必须是非负整数');
  }
  if (baseMonthsAlreadyPaid > 0 && actor?.role !== Role.ADMIN) {
    throw new CsPeriodError('导入已发底薪需要管理员身份');
  }
  let initialSales: Decimal;
  try {
    initialSales =
      input.initialSales === undefined
        ? new Decimal(0)
        : new Decimal(input.initialSales as Decimal.Value);
  } catch {
    throw new CsPeriodError('期初业绩金额非法');
  }
  if (
    !initialSales.isFinite() ||
    initialSales.isNegative() ||
    initialSales.decimalPlaces() > 2 ||
    initialSales.gt('9999999999.99')
  ) {
    throw new CsPeriodError(
      '期初业绩必须是两位小数，且在 0 到 9,999,999,999.99 元之间',
    );
  }
  let monthlyBaseOverride: Decimal | null;
  try {
    monthlyBaseOverride =
      input.monthlyBase === undefined
        ? null
        : new Decimal(input.monthlyBase as Decimal.Value);
  } catch {
    throw new CsPeriodError('月底薪金额非法');
  }
  if (
    monthlyBaseOverride &&
    (!monthlyBaseOverride.isFinite() ||
      monthlyBaseOverride.isNegative() ||
      monthlyBaseOverride.decimalPlaces() > 2 ||
      monthlyBaseOverride.gt('99999999.99'))
  ) {
    throw new CsPeriodError(
      '月底薪必须是两位小数，且在 0 到 99,999,999.99 元之间',
    );
  }

  const created = await db.$transaction(async (tx) => {
    // Identity -> CS user is the global salary lock order. Account employment,
    // role and active-state changes use the same pair before updating User.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(
      input.csUserId,
    )}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${csUserLockKey(
      input.csUserId,
    )}))`;

    const csUser = await tx.user.findUnique({
      where: { id: input.csUserId },
      select: {
        id: true,
        role: true,
        isActive: true,
        employmentStartDate: true,
        employmentEndDate: true,
      },
    });
    if (!csUser) throw new CsPeriodError('客服不存在');
    if (csUser.role !== Role.CUSTOMER_SERVICE) {
      throw new CsPeriodError('不是客服（role != CUSTOMER_SERVICE）');
    }
    if (!csUser.isActive) {
      throw new CsPeriodError('客服账号已停用，不能新建工资周期');
    }

    await acquireSalaryRuleSnapshotReadLock(tx);

    // Resolve both active rules inside this transaction after taking the user
    // lock. A concurrent rule edit can no longer produce a period whose base
    // and duration came from different rule versions.
    const [baseRule, durationRule] = await Promise.all([
      monthlyBaseOverride === null
        ? getActiveRuleValue<{ monthlyBase: string | number }>(
            SalaryRuleType.CS_COMMISSION,
            'CS_BASE_SALARY',
            now,
            tx,
          )
        : Promise.resolve(null),
      input.durationMonths === undefined
        ? getActiveRuleValue<{ months: number }>(
            SalaryRuleType.CS_COMMISSION,
            'CS_PERIOD_LENGTH',
            now,
            tx,
          )
        : Promise.resolve(null),
    ]);
    if (monthlyBaseOverride === null && !baseRule) {
      throw new CsPeriodError('无当前生效的 CS_BASE_SALARY 规则');
    }
    if (input.durationMonths === undefined && !durationRule) {
      throw new CsPeriodError('无当前生效的 CS_PERIOD_LENGTH 规则');
    }
    let monthlyBaseFinal: Decimal;
    try {
      monthlyBaseFinal =
        monthlyBaseOverride ?? new Decimal(baseRule!.monthlyBase);
    } catch {
      throw new CsPeriodError('当前客服底薪规则金额非法');
    }
    const durationMonths = input.durationMonths ?? durationRule!.months;
    assertStoredMoney(
      monthlyBaseFinal,
      DECIMAL_10_2_MAX,
      '当前客服底薪规则金额',
    );
    if (
      !Number.isSafeInteger(durationMonths) ||
      durationMonths < 1 ||
      durationMonths > 24
    ) {
      throw new CsPeriodError('周期月数必须是 1 到 24 的整数');
    }
    if (baseMonthsAlreadyPaid > durationMonths) {
      throw new CsPeriodError('已发底薪月数必须在 0 到周期月数之间');
    }
    const end = computePeriodEnd(start, durationMonths);
    if (!monthlySalaryWindowWithinEmployment(start, end, csUser)) {
      throw new CsPeriodError('客服工资周期不能超出雇佣起止月份');
    }
    const periodBaseTotal = monthlyBaseFinal.times(durationMonths);
    assertStoredMoney(periodBaseTotal, DECIMAL_12_2_MAX, '周期底薪合计');

    // Historical/settled periods are still finance-of-record. Reject overlap
    // with every status rather than allowing a new active row to cover the same
    // business dates.
    const overlap = await tx.salaryPeriod.findFirst({
      where: {
        csUserId: input.csUserId,
        periodStart: { lte: end },
        periodEnd: { gte: start },
      },
      select: { id: true, periodStart: true, periodEnd: true },
    });
    if (overlap) {
      throw new CsPeriodError(
        `该客服已有工资周期（${formatYmdUtc(overlap.periodStart)} ~ ${formatYmdUtc(overlap.periodEnd)}），区间重叠`,
      );
    }

    const period = await tx.salaryPeriod.create({
      data: {
        csUserId: input.csUserId,
        periodStart: start,
        periodEnd: end,
        durationMonths,
        totalSales: '0.00',
        initialSales: initialSales.toFixed(2),
        monthlyBase: monthlyBaseFinal.toFixed(2),
        status: SalaryPeriodStatus.IN_PROGRESS,
      },
      select: {
        id: true,
        csUserId: true,
        periodStart: true,
        periodEnd: true,
        durationMonths: true,
        monthlyBase: true,
        initialSales: true,
      },
    });
    // A zero-base historical period has no monetary payment to import. Do not
    // manufacture a ¥0 payroll row: the database correctly requires every
    // immutable payment ledger entry to carry a positive amount.
    if (baseMonthsAlreadyPaid > 0 && monthlyBaseFinal.gt(0)) {
      await tx.csPayrollPayment.create({
        data: {
          idempotencyKey: `cs-period-opening-base:${period.id}`,
          salaryPeriodId: period.id,
          baseAmount: monthlyBaseFinal
            .times(baseMonthsAlreadyPaid)
            .toFixed(2),
          commissionAmount: '0.00',
          paidAt: now,
          paymentMethod: null,
          referenceNo: null,
          remark: `历史导入：已发 ${baseMonthsAlreadyPaid} 个月底薪`,
          recordedById: actor!.id,
        },
      });
    }
    return period;
  });

  return {
    id: created.id,
    csUserId: created.csUserId,
    periodStart: formatYmdUtc(created.periodStart),
    periodEnd: formatYmdUtc(created.periodEnd),
    durationMonths: created.durationMonths,
    monthlyBase: String(created.monthlyBase),
    initialSales: String(created.initialSales),
  };
}

export type SettledCommission = {
  commissionId: string;
  periodId: string;
  csUserId: string;
  totalSales: string;
  tierRate: string;
  commissionAmount: string;
  monthlyBaseTotal: string;
  totalIncome: string;
  nextPeriodId: string | null;
  /** True when the durable notification was committed with the settlement. */
  notificationQueued: boolean;
};

type CsSettlementPeriod = {
  id: string;
  csUserId: string;
  periodStart: Date;
  periodEnd: Date;
  durationMonths: number;
  totalSales: unknown;
  initialSales: unknown;
  monthlyBase: unknown;
  status: SalaryPeriodStatus;
};

type CsSettlementUser = {
  role: Role;
  isActive: boolean;
  displayName?: string;
  employmentStartDate: Date | null;
  employmentEndDate: Date | null;
};

type CsSettlementTransactionResult = {
  settlement: SettledCommission;
  postCommitNotification: {
    payload: NotificationPayloadFor<'CS_PERIOD_SETTLED'>;
    dedupeKey: string;
  } | null;
};

type CsSettlementTx = SalaryRuleClient & {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
  salaryPeriod: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<CsSettlementPeriod | null>;
    findFirst: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<{
      id: string;
      periodStart: Date;
      periodEnd: Date;
      status: SalaryPeriodStatus;
    } | null>;
    update: (args: {
      where: { id: string };
      data: unknown;
      select?: unknown;
    }) => Promise<unknown>;
    create: (args: {
      data: unknown;
      select?: unknown;
    }) => Promise<{ id: string }>;
  };
  customerServiceCommission: {
    create: (args: {
      data: unknown;
      select?: unknown;
    }) => Promise<{ id: string }>;
  };
  user: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<CsSettlementUser | null>;
  };
  csPayrollPayment: {
    aggregate: (args: {
      where: unknown;
      _sum: unknown;
      _max?: unknown;
    }) => Promise<{
      _sum: { baseAmount: unknown; commissionAmount: unknown };
      _max?: { paidAt: Date | null };
    }>;
  };
};

async function startNextCsPeriod(
  txc: CsSettlementTx,
  period: CsSettlementPeriod,
  activeBase: { monthlyBase: number },
  nextWindow: NonNullable<
    ReturnType<typeof clampContinuousMonthlySalaryWindow>
  >,
): Promise<string> {
  const nextStart = nextWindow.periodStart;
  const nextEnd = nextWindow.periodEnd;
  const nextOverlap = await txc.salaryPeriod.findFirst({
    where: {
      csUserId: period.csUserId,
      id: { not: period.id },
      periodStart: { lte: nextEnd },
      periodEnd: { gte: nextStart },
    },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
    },
  });
  if (nextOverlap) {
    const isExactPreparedPeriod =
      nextOverlap.status === SalaryPeriodStatus.IN_PROGRESS &&
      nextOverlap.periodStart.getTime() === nextStart.getTime() &&
      nextOverlap.periodEnd.getTime() === nextEnd.getTime();
    if (!isExactPreparedPeriod) {
      throw new CsPeriodError(
        `自动开启的下一周期与已有周期（${formatYmdUtc(nextOverlap.periodStart)} ~ ${formatYmdUtc(nextOverlap.periodEnd)}）重叠`,
      );
    }
    return nextOverlap.id;
  }

  const next = await txc.salaryPeriod.create({
    data: {
      csUserId: period.csUserId,
      periodStart: nextStart,
      periodEnd: nextEnd,
      durationMonths: nextWindow.durationMonths,
      totalSales: '0.00',
      initialSales: '0.00',
      monthlyBase: new Decimal(activeBase.monthlyBase).toFixed(2),
      status: SalaryPeriodStatus.IN_PROGRESS,
    },
    select: { id: true },
  });
  return next.id;
}

// Settles a single period: fetches active CS_TIERS, computes commission
// on (totalSales + initialSales), records CustomerServiceCommission,
// transitions period to SETTLED, and starts the next period so the CS
// keeps earning uninterrupted (SPEC §3.7 "自动开启下一个周期").
async function settleCsPeriodInTx(
  txc: CsSettlementTx,
  periodId: string,
  now: Date,
  fence?: ExecutionFence,
): Promise<CsSettlementTransactionResult> {
    // First look up csUserId (un-locked but ID is immutable, so no
    // race). Then acquire the user-scope lock BEFORE re-reading the
    // period in full, so accumulateCsSales and any concurrent
    // settler for the SAME user all serialize through it.
    const periodLight = await txc.salaryPeriod.findUnique({
      where: { id: periodId },
      select: { csUserId: true },
    });
    if (!periodLight) throw new CsPeriodError('周期不存在');

    await txc.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(
      periodLight.csUserId,
    )}))`;
    await txc.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${csUserLockKey(
      periodLight.csUserId,
    )}))`;

    const period = await txc.salaryPeriod.findUnique({
      where: { id: periodId },
      select: {
        id: true,
        csUserId: true,
        periodStart: true,
        periodEnd: true,
        durationMonths: true,
        totalSales: true,
        initialSales: true,
        monthlyBase: true,
        status: true,
      },
    });
    if (!period) throw new CsPeriodError('周期不存在');

    // Status-machine check. If a concurrent settler got here first,
    // this period is now SETTLED and transitionCsPeriod will throw
    // InvalidCsPeriodTransitionError — which is the right outcome:
    // the first winner already did the work.
    transitionCsPeriod(period.status, SalaryPeriodStatus.SETTLED);
    assertPeriodIsDue(period.periodEnd, now);

    const csUser = await txc.user.findUnique({
      where: { id: period.csUserId },
      select: {
        role: true,
        isActive: true,
        displayName: true,
        employmentStartDate: true,
        employmentEndDate: true,
      },
    });
    if (!csUser) throw new CsPeriodError('客服账号不存在');
    const requestedNextStart = new Date(
      (period.periodEnd as Date).getTime() + 24 * 60 * 60 * 1000,
    );
    const shouldStartNextPeriod =
      csUser.role === Role.CUSTOMER_SERVICE &&
      csUser.isActive &&
      clampContinuousMonthlySalaryWindow(requestedNextStart, 1, csUser) !==
        null;

    await acquireSalaryRuleSnapshotReadLock(txc);

    // Rule reads go through the tx while holding a shared snapshot lock, so
    // a concurrent admin edit cannot make this settlement mix rule versions.
    const tiers = await getActiveRuleValue<CsTiersConfig>(
      SalaryRuleType.CS_COMMISSION,
      'CS_TIERS',
      now,
      txc,
    );
    if (!tiers) {
      throw new CsPeriodError('无当前生效的 CS_TIERS 规则');
    }
    const activeBase = await getActiveRuleValue<{ monthlyBase: number }>(
      SalaryRuleType.CS_COMMISSION,
      'CS_BASE_SALARY',
      now,
      txc,
    );
    const activeDurationValue = await getActiveRuleValue<{ months: number }>(
      SalaryRuleType.CS_COMMISSION,
      'CS_PERIOD_LENGTH',
      now,
      txc,
    );
    if (shouldStartNextPeriod && (!activeBase || !activeDurationValue)) {
      throw new CsPeriodError(
        '缺少当前生效的客服底薪或周期规则，为避免结算后出现空档，本次结算已取消',
      );
    }
    let nextWindow: ReturnType<
      typeof clampContinuousMonthlySalaryWindow
    > = null;
    if (shouldStartNextPeriod) {
      let nextMonthlyBase: Decimal;
      try {
        nextMonthlyBase = new Decimal(activeBase!.monthlyBase);
      } catch {
        throw new CsPeriodError('下一周期月底薪规则金额非法');
      }
      assertStoredMoney(nextMonthlyBase, DECIMAL_10_2_MAX, '下一周期月底薪');
      if (
        !Number.isSafeInteger(activeDurationValue!.months) ||
        activeDurationValue!.months < 1 ||
        activeDurationValue!.months > 24
      ) {
        throw new CsPeriodError('当前客服周期月数规则必须是 1 到 24 的整数');
      }
      nextWindow = clampContinuousMonthlySalaryWindow(
        requestedNextStart,
        activeDurationValue!.months,
        csUser,
      );
      if (!nextWindow) {
        throw new CsPeriodError('下一工资周期不在雇佣区间内');
      }
      assertStoredMoney(
        nextMonthlyBase.times(nextWindow.durationMonths),
        DECIMAL_12_2_MAX,
        '下一周期底薪合计',
      );
    }

    // SPEC §5.3: commission is on (totalSales + initialSales)
    const periodSales = new Decimal(period.totalSales as unknown as string);
    const initialSales = new Decimal(period.initialSales as unknown as string);
    assertStoredMoney(periodSales, DECIMAL_12_2_MAX, '周期业绩', {
      allowNegative: true,
    });
    assertStoredMoney(initialSales, DECIMAL_12_2_MAX, '期初业绩');
    const totalForTier = periodSales.plus(initialSales);
    assertStoredMoney(totalForTier, DECIMAL_12_2_MAX, '提成计算业绩', {
      allowNegative: true,
    });
    const breakdown = calcCsCommission(totalForTier, tiers);
    // Commission is a currency liability. Round it once, before comparisons
    // and persistence, so settlement, payment limits, and UI all use the same
    // cent value (rather than comparing against a hidden fractional cent).
    const commissionAmount = breakdown.commissionAmount.toDecimalPlaces(2);
    const monthlyBaseTotal = calcCsMonthlyBaseTotal(
      period.monthlyBase as unknown as string,
      period.durationMonths,
    );
    assertStoredMoney(monthlyBaseTotal, DECIMAL_12_2_MAX, '周期底薪合计');
    assertStoredMoney(
      commissionAmount,
      DECIMAL_12_2_MAX,
      '客服提成',
    );
    const totalIncome = calcCsTotalIncome(monthlyBaseTotal, commissionAmount);
    assertStoredMoney(totalIncome, DECIMAL_13_2_MAX, '客服应发合计');
    const paidBeforeSettlement = await txc.csPayrollPayment.aggregate({
      where: { salaryPeriodId: period.id },
      _sum: { baseAmount: true, commissionAmount: true },
      _max: { paidAt: true },
    });
    const paidBase = new Decimal(
      (paidBeforeSettlement._sum.baseAmount ?? 0) as Decimal.Value,
    );
    const paidCommission = new Decimal(
      (paidBeforeSettlement._sum.commissionAmount ?? 0) as Decimal.Value,
    );
    if (paidBase.gt(monthlyBaseTotal) || paidCommission.gt(commissionAmount)) {
      throw new CsPeriodError('客服工资发放流水超过本周期应发金额，结算已拒绝');
    }
    const isFullyPaid =
      paidBase.eq(monthlyBaseTotal) &&
      paidCommission.eq(commissionAmount);

    // Full rule snapshot . Stored on the
    // commission so "what was tier 5 then?" stays answerable from
    // persisted data even after the tier table is later edited.
    const ruleSnapshot = {
      tiers,
      monthlyBase: period.monthlyBase as unknown as string,
      durationMonths: period.durationMonths,
      // Include the currently-active base + duration too so a post-
      // period rule update is visible in the audit trail, not just
      // the per-period snapshots that were taken at create time.
      activeAtSettle: {
        monthlyBase: activeBase?.monthlyBase ?? null,
        durationMonths: activeDurationValue?.months ?? null,
      },
    };

    // The user/rule locks above can queue behind another settlement. A worker
    // that lost its durable lease while waiting must stop before changing the
    // period or creating a commission liability.
    await assertExecutionFence(fence);
    await txc.salaryPeriod.update({
      where: { id: period.id },
      data: {
        status: SalaryPeriodStatus.SETTLED,
        settledAt: now,
      },
    });

    const commission = await txc.customerServiceCommission.create({
      data: {
        csUserId: period.csUserId,
        salaryPeriodId: period.id,
        totalSales: totalForTier.toFixed(2),
        tierRate: breakdown.tierRate.toFixed(4),
        commissionAmount: commissionAmount.toFixed(2),
        monthlyBaseTotal: monthlyBaseTotal.toFixed(2),
        totalIncome: totalIncome.toFixed(2),
        paidBase: paidBase.toFixed(2),
        paidCommission: paidCommission.toFixed(2),
        isFullyPaid,
        paidAt: isFullyPaid
          ? (paidBeforeSettlement._max?.paidAt ?? now)
          : null,
        settledAt: now,
        salaryRuleSnapshot: JSON.parse(JSON.stringify(ruleSnapshot)),
      },
      select: { id: true },
    });

    // Auto-start the next period only after the settled liability exists.
    let nextPeriodId: string | null = null;
    if (
      shouldStartNextPeriod &&
      activeBase !== null &&
      activeDurationValue !== null &&
      nextWindow !== null
    ) {
      nextPeriodId = await startNextCsPeriod(
        txc,
        period,
        activeBase,
        nextWindow,
      );
    }
    // Disabled or reassigned accounts settle their historical period but do
    // not accrue a new salary obligation. Active CS accounts are guaranteed a
    // next period above; missing rules abort the entire settlement atomically.

    // Durable mode uses the settlement transaction as an outbox boundary. If
    // enqueue fails the finance mutation rolls back, so a retry can never find
    // an already-SETTLED period whose notification was silently lost.
    const notificationPayload: NotificationPayloadFor<'CS_PERIOD_SETTLED'> = {
      settledCount: 1,
      csName: csUser.displayName ?? period.csUserId,
      totalSales: totalForTier.toFixed(2),
      commission: commissionAmount.toFixed(2),
    };
    const notificationDedupeKey = `notification:CS_PERIOD_SETTLED:${period.id}`;
    const notificationQueued = await enqueueNotificationInTransaction(
      txc as unknown as EnqueueClient,
      'CS_PERIOD_SETTLED',
      notificationPayload,
      { dedupeKey: notificationDedupeKey },
    );

    return {
      settlement: {
        commissionId: commission.id,
        periodId: period.id,
        csUserId: period.csUserId,
        totalSales: totalForTier.toFixed(2),
        tierRate: breakdown.tierRate.toFixed(4),
        commissionAmount: commissionAmount.toFixed(2),
        monthlyBaseTotal: monthlyBaseTotal.toFixed(2),
        totalIncome: totalIncome.toFixed(2),
        nextPeriodId,
        notificationQueued,
      },
      postCommitNotification: notificationQueued
        ? null
        : {
            payload: notificationPayload,
            dedupeKey: notificationDedupeKey,
          },
    };
}

export async function settleCsPeriod(
  periodId: string,
  now: Date = new Date(),
  fence?: ExecutionFence,
): Promise<SettledCommission> {
  const committed = await db.$transaction((tx) =>
    settleCsPeriodInTx(tx as unknown as CsSettlementTx, periodId, now, fence),
  );
  if (committed.postCommitNotification) {
    await dispatchNotification(
      'CS_PERIOD_SETTLED',
      committed.postCommitNotification.payload,
      { dedupeKey: committed.postCommitNotification.dedupeKey },
    );
  }
  return committed.settlement;
}

// Batch: finds every IN_PROGRESS period whose inclusive periodEnd is before
// today's Shanghai date and settles it. Used by the daily cron endpoint.
export type BatchSettleResult = {
  settled: SettledCommission[];
  errors: Array<{ periodId: string; message: string }>;
};

const MAX_CS_PERIODS_PER_SETTLEMENT_RUN = 10_000;

// A batch can commit earlier periods before a later database/programming
// failure occurs. Each committed period already owns its notification through
// the transaction outbox or post-commit inline fallback; preserve the partial
// result only for progress reporting, then rethrow for Sentry/job retry.
export class CsBatchUnexpectedError extends Error {
  readonly partialResult: BatchSettleResult;

  constructor(message: string, partialResult: BatchSettleResult, cause: unknown) {
    super(message, { cause });
    this.name = 'CsBatchUnexpectedError';
    this.partialResult = partialResult;
  }
}

// Batch: finds every IN_PROGRESS period whose periodEnd has passed
// and settles each. Per-period try/catch so one bad period doesn't
// abort the whole batch (e.g. missing CS_TIERS rule, or a concurrent
// settler already handled this period).
export async function settleReadyCsPeriods(
  now: Date = new Date(),
  maxPeriods: number = MAX_CS_PERIODS_PER_SETTLEMENT_RUN,
  fence?: ExecutionFence,
): Promise<BatchSettleResult> {
  if (!Number.isSafeInteger(maxPeriods) || maxPeriods < 1) {
    throw new CsPeriodError('单次结算周期上限必须是正整数');
  }
  const today = shanghaiDateColumnValue(now);
  const settled: SettledCommission[] = [];
  const errors: Array<{ periodId: string; message: string }> = [];
  const attemptedIds = new Set<string>();

  // Re-query after every wave. Settling a long-overdue period creates its
  // contiguous successor, which may itself already be due; a one-shot query
  // would leave the active CS account without a period covering today until
  // several later cron runs. Failed ids are excluded so one bad rule cannot
  // spin forever or prevent other accounts from catching up.
  const dueWhere = () => ({
    status: SalaryPeriodStatus.IN_PROGRESS,
    periodEnd: { lt: today },
    ...(attemptedIds.size > 0
      ? { id: { notIn: [...attemptedIds] } }
      : {}),
  });
  while (attemptedIds.size < maxPeriods) {
    let due: Array<{ id: string }>;
    try {
      due = await db.salaryPeriod.findMany({
        where: dueWhere(),
        select: { id: true },
        orderBy: { periodEnd: 'asc' },
        take: Math.min(500, maxPeriods - attemptedIds.size),
      });
    } catch (cause) {
      throw new CsBatchUnexpectedError(
        '客服周期批量扫描失败',
        { settled, errors },
        cause,
      );
    }
    // Keep a defensive in-memory filter as well: it makes the loop safe even
    // if a test double or non-Prisma adapter ignores the `notIn` predicate.
    const freshDue = due.filter((period) => !attemptedIds.has(period.id));
    if (freshDue.length === 0) break;

    for (const period of freshDue) {
      attemptedIds.add(period.id);
      try {
        await assertExecutionFence(fence);
        settled.push(await settleCsPeriod(period.id, now, fence));
      } catch (err) {
        if (
          err instanceof CsPeriodError ||
          err instanceof InvalidCsPeriodTransitionError
        ) {
          // Expected business/configuration failure: keep processing other
          // accounts and return a safe operator-facing message.
          errors.push({ periodId: period.id, message: err.message });
          continue;
        }
        throw new CsBatchUnexpectedError(
          `客服周期 ${period.id} 结算发生系统错误`,
          { settled, errors },
          err,
        );
      }
    }
  }
  if (attemptedIds.size >= maxPeriods) {
    let remaining: { id: string } | null;
    try {
      remaining = await db.salaryPeriod.findFirst({
        where: dueWhere(),
        select: { id: true },
        orderBy: { periodEnd: 'asc' },
      });
    } catch (cause) {
      throw new CsBatchUnexpectedError(
        '客服周期批量余量检查失败',
        { settled, errors },
        cause,
      );
    }
    if (remaining) {
      errors.push({
        periodId: 'batch-limit',
        message: `单次最多结算 ${maxPeriods} 个客服工资周期，仍有待处理周期，请重试`,
      });
    }
  }
  return { settled, errors };
}

export type RecordCsPayrollPaymentInput = {
  idempotencyKey: string;
  baseAmount: string;
  commissionAmount: string;
  paidAt: Date;
  paymentMethod?: string | null;
  referenceNo?: string | null;
  remark?: string | null;
};

export type RecordCsPayrollPaymentResult = {
  paymentId: string;
  paidBase: string;
  paidCommission: string;
  isFullyPaid: boolean;
};

function normalizedOptionalText(value?: string | null): string | null {
  return value?.trim() || null;
}

function sameInstant(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

function laterInstant(left: Date | null | undefined, right: Date): Date {
  return left && left.getTime() > right.getTime() ? left : right;
}

// Append one CS payroll payment. Bottom salary may be paid while the period is
// active; commission is locked until settlement determines its final amount.
// The immutable payment ledger is authoritative, while the commission row
// keeps query-friendly paid totals once it exists.
export async function recordCsPayrollPayment(
  salaryPeriodId: string,
  input: RecordCsPayrollPaymentInput,
  actor: { id: string; role: Role },
): Promise<RecordCsPayrollPaymentResult> {
  if (actor.role !== Role.ADMIN) {
    throw new CsPeriodError('只有管理员可以记录客服工资发放');
  }
  if (Number.isNaN(input.paidAt.getTime())) {
    throw new CsPeriodError('发放时间不合法');
  }
  let baseAmount: Decimal;
  let commissionAmount: Decimal;
  try {
    baseAmount = new Decimal(input.baseAmount);
    commissionAmount = new Decimal(input.commissionAmount);
  } catch {
    throw new CsPeriodError('底薪或提成发放金额非法');
  }
  if (
    !baseAmount.isFinite() ||
    !commissionAmount.isFinite() ||
    baseAmount.isNegative() ||
    commissionAmount.isNegative() ||
    baseAmount.decimalPlaces() > 2 ||
    commissionAmount.decimalPlaces() > 2 ||
    baseAmount.gt('9999999999.99') ||
    commissionAmount.gt('9999999999.99') ||
    baseAmount.plus(commissionAmount).isZero()
  ) {
    throw new CsPeriodError('底薪和提成必须为非负金额，且本次发放合计必须大于 0');
  }

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${csPayrollRequestLockKey(
      input.idempotencyKey,
    )}))`;

    const replay = await tx.csPayrollPayment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: {
        id: true,
        salaryPeriodId: true,
        baseAmount: true,
        commissionAmount: true,
        paidAt: true,
        paymentMethod: true,
        referenceNo: true,
        remark: true,
        recordedById: true,
      },
    });
    if (replay) {
      if (
        replay.salaryPeriodId !== salaryPeriodId ||
        replay.recordedById !== actor.id ||
        !new Decimal(replay.baseAmount).eq(baseAmount) ||
        !new Decimal(replay.commissionAmount).eq(commissionAmount) ||
        !sameInstant(replay.paidAt, input.paidAt) ||
        replay.paymentMethod !== normalizedOptionalText(input.paymentMethod) ||
        replay.referenceNo !== normalizedOptionalText(input.referenceNo) ||
        replay.remark !== normalizedOptionalText(input.remark)
      ) {
        throw new CsPeriodError('工资发放请求标识已被其他记录使用，请刷新后重试');
      }
      const totals = await tx.csPayrollPayment.aggregate({
        where: { salaryPeriodId },
        _sum: { baseAmount: true, commissionAmount: true },
      });
      const commission = await tx.customerServiceCommission.findUnique({
        where: { salaryPeriodId },
        select: { isFullyPaid: true },
      });
      return {
        paymentId: replay.id,
        paidBase: new Decimal(totals._sum.baseAmount ?? 0).toFixed(2),
        paidCommission: new Decimal(
          totals._sum.commissionAmount ?? 0,
        ).toFixed(2),
        isFullyPaid: commission?.isFullyPaid ?? false,
      };
    }

    const lightPeriod = await tx.salaryPeriod.findUnique({
      where: { id: salaryPeriodId },
      select: { csUserId: true },
    });
    if (!lightPeriod) throw new CsPeriodError('客服周期不存在');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${csUserLockKey(
      lightPeriod.csUserId,
    )}))`;

    const period = await tx.salaryPeriod.findUnique({
      where: { id: salaryPeriodId },
      select: {
        id: true,
        monthlyBase: true,
        durationMonths: true,
        commissions: {
          select: {
            id: true,
            commissionAmount: true,
            monthlyBaseTotal: true,
          },
        },
      },
    });
    if (!period) throw new CsPeriodError('客服周期不存在');

    const commission = period.commissions[0] ?? null;
    if (!commission && commissionAmount.gt(0)) {
      throw new CsPeriodError('周期尚未结算，不能提前发放提成');
    }
    const totals = await tx.csPayrollPayment.aggregate({
      where: { salaryPeriodId },
      _sum: { baseAmount: true, commissionAmount: true },
      _max: { paidAt: true },
    });
    const paidBase = new Decimal(totals._sum.baseAmount ?? 0);
    const paidCommission = new Decimal(totals._sum.commissionAmount ?? 0);
    const baseLimit = commission
      ? new Decimal(commission.monthlyBaseTotal)
      : new Decimal(period.monthlyBase).times(period.durationMonths);
    const commissionLimit = commission
      ? new Decimal(commission.commissionAmount)
      : new Decimal(0);
    const nextBase = paidBase.plus(baseAmount);
    const nextCommission = paidCommission.plus(commissionAmount);
    if (nextBase.gt(baseLimit)) {
      throw new CsPeriodError(
        `底薪发放超出剩余金额（剩余 ${baseLimit.minus(paidBase).toFixed(2)}）`,
      );
    }
    if (nextCommission.gt(commissionLimit)) {
      throw new CsPeriodError(
        `提成发放超出剩余金额（剩余 ${commissionLimit.minus(paidCommission).toFixed(2)}）`,
      );
    }

    const payment = await tx.csPayrollPayment.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        salaryPeriodId,
        baseAmount: baseAmount.toFixed(2),
        commissionAmount: commissionAmount.toFixed(2),
        paidAt: input.paidAt,
        paymentMethod: normalizedOptionalText(input.paymentMethod),
        referenceNo: normalizedOptionalText(input.referenceNo),
        remark: normalizedOptionalText(input.remark),
        recordedById: actor.id,
      },
      select: { id: true },
    });
    const isFullyPaid =
      commission !== null &&
      nextBase.eq(baseLimit) &&
      nextCommission.eq(commissionLimit);
    if (commission) {
      await tx.customerServiceCommission.update({
        where: { id: commission.id },
        data: {
          paidBase: nextBase.toFixed(2),
          paidCommission: nextCommission.toFixed(2),
          isFullyPaid,
          paidAt: isFullyPaid
            ? laterInstant(totals._max?.paidAt, input.paidAt)
            : null,
        },
      });
    }
    return {
      paymentId: payment.id,
      paidBase: nextBase.toFixed(2),
      paidCommission: nextCommission.toFixed(2),
      isFullyPaid,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Reads for the UI
// ─────────────────────────────────────────────────────────────────────

// Active 客服 accounts for the "新建客服周期" form picker. Kept in lib/
// so the page never imports Prisma directly (CLAUDE.md §3).
export async function listActiveCsUsers() {
  return db.user.findMany({
    where: { role: Role.CUSTOMER_SERVICE, isActive: true },
    orderBy: { displayName: 'asc' },
    select: { id: true, displayName: true, username: true },
  });
}

export async function listCsPeriods(filter: {
  csUserId?: string;
  status?: SalaryPeriodStatus;
} = {}) {
  return db.salaryPeriod.findMany({
    where: {
      ...(filter.csUserId ? { csUserId: filter.csUserId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: [{ periodStart: 'desc' }],
    select: {
      id: true,
      csUserId: true,
      periodStart: true,
      periodEnd: true,
      durationMonths: true,
      totalSales: true,
      initialSales: true,
      monthlyBase: true,
      status: true,
      settledAt: true,
      csUser: { select: { id: true, displayName: true } },
    },
  });
}

export async function getCsPeriodDetail(id: string) {
  return db.salaryPeriod.findUnique({
    where: { id },
    select: {
      id: true,
      csUserId: true,
      periodStart: true,
      periodEnd: true,
      durationMonths: true,
      totalSales: true,
      initialSales: true,
      monthlyBase: true,
      status: true,
      settledAt: true,
      createdAt: true,
      csUser: {
        select: {
          id: true,
          displayName: true,
          role: true,
          isActive: true,
        },
      },
      salesEntries: {
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          type: true,
          amount: true,
          occurredAt: true,
          orderRevision: true,
          remark: true,
          createdAt: true,
          order: { select: { id: true, orderNo: true } },
        },
      },
      payrollPayments: {
        orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          baseAmount: true,
          commissionAmount: true,
          paidAt: true,
          paymentMethod: true,
          referenceNo: true,
          remark: true,
          recordedBy: { select: { displayName: true } },
        },
      },
      commissions: {
        select: {
          id: true,
          totalSales: true,
          tierRate: true,
          commissionAmount: true,
          monthlyBaseTotal: true,
          totalIncome: true,
          paidBase: true,
          paidCommission: true,
          isFullyPaid: true,
          settledAt: true,
          paidAt: true,
        },
      },
    },
  });
}

export { InvalidCsPeriodTransitionError };
export type { CsTiersConfig };
