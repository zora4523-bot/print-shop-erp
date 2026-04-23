import Decimal from 'decimal.js';
import { Role, SalaryPeriodStatus } from '../../generated/prisma/enums';
import { db } from '../db';
import { parseStrictYmd } from '../auth/schemas';
import {
  calcCsCommission,
  calcCsMonthlyBaseTotal,
  calcCsTotalIncome,
  type CsTiersConfig,
} from './cs-commission';
import {
  getActiveCsMonthlyBase,
  getActiveCsPeriodLength,
  getActiveCsTiers,
} from './rules';
import {
  transitionCsPeriod,
  InvalidCsPeriodTransitionError,
} from './cs/status-machine';

// ─────────────────────────────────────────────────────────────────────
// CS period lifecycle (SPEC §3.7 / §5.3 / §5.5)
// ─────────────────────────────────────────────────────────────────────

export class CsPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsPeriodError';
  }
}

// Advance a YYYY-MM-DD by N calendar months, keeping UTC midnight.
// Used to compute periodEnd from (periodStart, durationMonths). We
// clamp to the last day of the target month if the source day doesn't
// exist there (e.g. 2026-01-31 + 1 month → 2026-02-28).
function addMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  // Step 1: same-day in target month as if it always exists.
  const candidate = new Date(Date.UTC(y, m + months, d));
  // Step 2: detect JS's silent rollover — if candidate's month isn't
  // the expected (m + months) mod 12, the target day didn't exist
  // (e.g. Feb 31). Clamp to the last day of the intended month.
  const expectedMonth = ((m + months) % 12 + 12) % 12;
  if (candidate.getUTCMonth() !== expectedMonth) {
    // last day of expected month = 0th day of the next
    return new Date(
      Date.UTC(y + Math.floor((m + months) / 12), expectedMonth + 1, 0),
    );
  }
  return candidate;
}

// periodEnd is the *inclusive* last day of the period: it's
// periodStart + durationMonths − 1 day. e.g. periodStart 2026-01-01,
// durationMonths=4 → periodEnd 2026-04-30. This matches SPEC §7.3
// "2026-01 ~ 2026-04" (4 calendar months, ending 2026-04-30).
export function computePeriodEnd(
  periodStart: Date,
  durationMonths: number,
): Date {
  const plus = addMonthsUtc(periodStart, durationMonths);
  return new Date(plus.getTime() - 24 * 60 * 60 * 1000);
}

export type StartCsPeriodInput = {
  csUserId: string;
  periodStart: string; // YYYY-MM-DD
  durationMonths?: number; // overrides CS_PERIOD_LENGTH
  initialSales?: string | number;
  monthlyBase?: string | number; // overrides CS_BASE_SALARY
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

// Creates a new IN_PROGRESS SalaryPeriod for a CS user. Refuses if the
// user isn't CUSTOMER_SERVICE, if another IN_PROGRESS period overlaps,
// or if required rules (CS_PERIOD_LENGTH / CS_BASE_SALARY) are missing
// and no override is supplied.
export async function startCsPeriod(
  input: StartCsPeriodInput,
  now: Date = new Date(),
): Promise<StartedPeriod> {
  const start = parseStrictYmd(input.periodStart);
  if (!start) {
    throw new CsPeriodError(
      `周期起始日期非法（应为合法 YYYY-MM-DD）：${input.periodStart}`,
    );
  }

  const csUser = await db.user.findUnique({
    where: { id: input.csUserId },
    select: { id: true, role: true, isActive: true },
  });
  if (!csUser) throw new CsPeriodError('客服不存在');
  if (csUser.role !== Role.CUSTOMER_SERVICE) {
    throw new CsPeriodError('不是客服（role != CUSTOMER_SERVICE）');
  }

  // Resolve rules — either from overrides (import) or active rule.
  const monthlyBase =
    input.monthlyBase !== undefined
      ? new Decimal(input.monthlyBase as Decimal.Value)
      : (() => {
          return null;
        })();
  const monthlyBaseFinal =
    monthlyBase !== null
      ? monthlyBase
      : await (async () => {
          const v = await getActiveCsMonthlyBase(now);
          if (v === null) {
            throw new CsPeriodError('无当前生效的 CS_BASE_SALARY 规则');
          }
          return new Decimal(v);
        })();

  let durationMonths = input.durationMonths;
  if (durationMonths === undefined) {
    const v = await getActiveCsPeriodLength(now);
    if (v === null) {
      throw new CsPeriodError('无当前生效的 CS_PERIOD_LENGTH 规则');
    }
    durationMonths = v;
  }
  if (!Number.isInteger(durationMonths) || durationMonths < 1) {
    throw new CsPeriodError('周期月数必须是 ≥1 的整数');
  }

  const end = computePeriodEnd(start, durationMonths);

  // Overlap guard: any existing IN_PROGRESS period whose range
  // intersects [start, end] would conflict. For MVP we insist on
  // no overlap at all — the next period starts the day after the
  // previous one ends.
  const overlap = await db.salaryPeriod.findFirst({
    where: {
      csUserId: input.csUserId,
      status: SalaryPeriodStatus.IN_PROGRESS,
      periodStart: { lte: end },
      periodEnd: { gte: start },
    },
    select: { id: true, periodStart: true, periodEnd: true },
  });
  if (overlap) {
    throw new CsPeriodError(
      `该客服已有进行中的周期（${formatYmdUtc(overlap.periodStart)} ~ ${formatYmdUtc(overlap.periodEnd)}），区间重叠`,
    );
  }

  const initialSales =
    input.initialSales === undefined
      ? new Decimal(0)
      : new Decimal(input.initialSales as Decimal.Value);

  const created = await db.salaryPeriod.create({
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

// Adds to the active period's totalSales for a given CS user. Intended
// to be called from the bill mark-paid flow in P0 #6 — wired via this
// thin accessor now so we don't need to touch lib/cs.ts from bill code.
export async function accumulateCsSales(
  csUserId: string,
  amount: string | number | Decimal,
  at: Date = new Date(),
): Promise<{ periodId: string; newTotalSales: string } | null> {
  const period = await db.salaryPeriod.findFirst({
    where: {
      csUserId,
      status: SalaryPeriodStatus.IN_PROGRESS,
      periodStart: { lte: at },
      periodEnd: { gte: at },
    },
    select: { id: true, totalSales: true },
  });
  if (!period) return null;

  // Use Prisma's atomic increment so concurrent bill settlements
  // don't lose writes. Prisma `increment` takes a number — we convert
  // via Decimal to avoid float rounding, then Prisma stores the
  // resulting string correctly in the Decimal(12,2) column.
  const inc = new Decimal(amount as Decimal.Value);
  const updated = await db.salaryPeriod.update({
    where: { id: period.id },
    data: { totalSales: { increment: inc.toFixed(2) } },
    select: { id: true, totalSales: true },
  });
  return {
    periodId: updated.id,
    newTotalSales: String(updated.totalSales),
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
};

// Settles a single period: fetches active CS_TIERS, computes commission
// on (totalSales + initialSales), records CustomerServiceCommission,
// transitions period to SETTLED, and starts the next period so the CS
// keeps earning uninterrupted (SPEC §3.7 "自动开启下一个周期").
export async function settleCsPeriod(
  periodId: string,
  now: Date = new Date(),
): Promise<SettledCommission> {
  return db.$transaction(async (tx) => {
    const period = await tx.salaryPeriod.findUnique({
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

    transitionCsPeriod(period.status, SalaryPeriodStatus.SETTLED);

    const tiers = await getActiveCsTiers(now);
    if (!tiers) {
      throw new CsPeriodError('无当前生效的 CS_TIERS 规则');
    }
    // SPEC §5.3: commission is on (totalSales + initialSales)
    const totalForTier = new Decimal(period.totalSales as unknown as string)
      .plus(new Decimal(period.initialSales as unknown as string));
    const breakdown = calcCsCommission(totalForTier, tiers);
    const monthlyBaseTotal = calcCsMonthlyBaseTotal(
      period.monthlyBase as unknown as string,
      period.durationMonths,
    );
    const totalIncome = calcCsTotalIncome(
      monthlyBaseTotal,
      breakdown.commissionAmount,
    );

    await tx.salaryPeriod.update({
      where: { id: period.id },
      data: {
        status: SalaryPeriodStatus.SETTLED,
        settledAt: now,
      },
    });

    const commission = await tx.customerServiceCommission.create({
      data: {
        csUserId: period.csUserId,
        salaryPeriodId: period.id,
        totalSales: totalForTier.toFixed(2),
        tierRate: breakdown.tierRate.toFixed(4),
        commissionAmount: breakdown.commissionAmount.toFixed(2),
        monthlyBaseTotal: monthlyBaseTotal.toFixed(2),
        totalIncome: totalIncome.toFixed(2),
        settledAt: now,
      },
      select: { id: true },
    });

    // Auto-start the next period. SPEC §3.7: next period begins the
    // day after the previous one ends; durationMonths + monthlyBase
    // come from currently active rules (so a rate change applies
    // prospectively, as intended).
    let nextPeriodId: string | null = null;
    const nextStart = new Date(
      (period.periodEnd as Date).getTime() + 24 * 60 * 60 * 1000,
    );
    const activeBase = await getActiveCsMonthlyBase(now);
    const activeDuration = await getActiveCsPeriodLength(now);
    if (activeBase !== null && activeDuration !== null) {
      const nextEnd = computePeriodEnd(nextStart, activeDuration);
      const next = await tx.salaryPeriod.create({
        data: {
          csUserId: period.csUserId,
          periodStart: nextStart,
          periodEnd: nextEnd,
          durationMonths: activeDuration,
          totalSales: '0.00',
          initialSales: '0.00',
          monthlyBase: new Decimal(activeBase).toFixed(2),
          status: SalaryPeriodStatus.IN_PROGRESS,
        },
        select: { id: true },
      });
      nextPeriodId = next.id;
    }
    // If rules are missing, we log (via the return value) and leave
    // the CS without a next period. Owner is expected to restart it
    // manually after the rules get added.

    return {
      commissionId: commission.id,
      periodId: period.id,
      csUserId: period.csUserId,
      totalSales: totalForTier.toFixed(2),
      tierRate: breakdown.tierRate.toFixed(4),
      commissionAmount: breakdown.commissionAmount.toFixed(2),
      monthlyBaseTotal: monthlyBaseTotal.toFixed(2),
      totalIncome: totalIncome.toFixed(2),
      nextPeriodId,
    };
  });
}

// Batch: finds every IN_PROGRESS period whose periodEnd has passed and
// settles it. Used by the "每日扫描" cron endpoint (SPEC §3.7 "周期结束
// 当日（定时任务）"). Serialized so we don't interleave transactions.
export async function settleReadyCsPeriods(
  now: Date = new Date(),
): Promise<SettledCommission[]> {
  const due = await db.salaryPeriod.findMany({
    where: {
      status: SalaryPeriodStatus.IN_PROGRESS,
      periodEnd: { lt: now },
    },
    select: { id: true },
    orderBy: { periodEnd: 'asc' },
  });
  const out: SettledCommission[] = [];
  for (const p of due) {
    out.push(await settleCsPeriod(p.id, now));
  }
  return out;
}

// Mark a commission as fully paid (base + commission in one go).
// Partial payments (paidBase only, then paidCommission later) are a
// P1 follow-up. For MVP, the owner ticks "已发放" and finance moves on.
export async function markCsCommissionPaid(
  id: string,
  isPaid: boolean,
  now: Date = new Date(),
): Promise<{ id: string; isFullyPaid: boolean }> {
  const existing = await db.customerServiceCommission.findUnique({
    where: { id },
    select: {
      id: true,
      monthlyBaseTotal: true,
      commissionAmount: true,
    },
  });
  if (!existing) throw new CsPeriodError('提成记录不存在');

  const updated = await db.customerServiceCommission.update({
    where: { id },
    data: {
      isFullyPaid: isPaid,
      paidBase: isPaid
        ? (existing.monthlyBaseTotal as unknown as string)
        : '0',
      paidCommission: isPaid
        ? (existing.commissionAmount as unknown as string)
        : '0',
      paidAt: isPaid ? now : null,
    },
    select: { id: true, isFullyPaid: true },
  });
  return updated;
}

// ─────────────────────────────────────────────────────────────────────
// Reads for the UI
// ─────────────────────────────────────────────────────────────────────

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
      csUser: { select: { id: true, displayName: true } },
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
