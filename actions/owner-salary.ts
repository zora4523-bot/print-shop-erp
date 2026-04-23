'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import {
  recomputeDailySalarySchema,
  markDailySalaryPaidSchema,
  startCsPeriodSchema,
  markCsCommissionPaidSchema,
  recomputeHourlyPayrollSchema,
  markHourlyPayrollPaidSchema,
} from '@/lib/auth/schemas';
import {
  computeDailyForAllMachineWorkers,
  computeDailyWorkerSalary,
  markDailySalaryPaid,
  DailySalaryError,
} from '@/lib/salary/daily';
import {
  startCsPeriod,
  settleCsPeriod,
  settleReadyCsPeriods,
  markCsCommissionPaid,
  CsPeriodError,
  InvalidCsPeriodTransitionError,
} from '@/lib/salary/cs';
import {
  computeHourlyPayroll,
  computeHourlyForAllInMonth,
  markHourlyPayrollPaid,
  HourlyAggregateError,
} from '@/lib/salary/hourly-aggregate';
import type {
  RecomputeDailyResult,
  SalaryMutationResult,
  StartCsPeriodResult,
  SettleCsPeriodResult,
  SettleReadyCsResult,
  RecomputeHourlyResult,
} from './owner-salary.types';

function collectFieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
) {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

// Owner kicks the daily-salary computation manually — useful when
// cron missed, when a worker's late report changes the totals, or
// for historical backfill. Accepts { date, workerId? }: with
// workerId, recomputes that single row; without, iterates every
// active machine worker for that date.
export async function recomputeDailySalaryAction(
  _prev: RecomputeDailyResult | null,
  raw: unknown,
): Promise<RecomputeDailyResult> {
  await requirePermission('salary:rule:manage');

  const parsed = recomputeDailySalarySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    let count: number;
    if (parsed.data.workerId) {
      await computeDailyWorkerSalary(parsed.data.workerId, parsed.data.date);
      count = 1;
    } else {
      const { settled } = await computeDailyForAllMachineWorkers(
        parsed.data.date,
      );
      count = settled.length;
    }
    revalidatePath('/owner/salary/daily');
    return {
      status: 'success',
      date: parsed.data.date,
      workerCount: count,
    };
  } catch (err) {
    if (err instanceof DailySalaryError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }
}

// Mark / unmark a daily salary row as paid. Finance-only action.
export async function setDailySalaryPaidAction(
  id: string,
  _prev: SalaryMutationResult | null,
  formData: FormData,
): Promise<SalaryMutationResult> {
  await requirePermission('salary:view:all');

  const parsed = markDailySalaryPaidSchema.safeParse({
    isPaid: formData.get('isPaid'),
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  await markDailySalaryPaid(id, parsed.data.isPaid);
  revalidatePath('/owner/salary/daily');
  return { status: 'success' };
}

// ─────────────────────────────────────────────────────────────────────
// CS (客服) actions — SPEC §3.7 / §5.3 / §5.5
// ─────────────────────────────────────────────────────────────────────

// Narrow to the 'error' variant shared by every CS-related result
// type — the caller's own `status: 'success'` shape never conflicts.
function mapCsError(err: unknown): { status: 'error'; message: string } | null {
  if (err instanceof CsPeriodError) {
    return { status: 'error', message: err.message };
  }
  if (err instanceof InvalidCsPeriodTransitionError) {
    return { status: 'error', message: err.message };
  }
  return null;
}

// Owner starts a new CS period. Historical imports (SPEC §5.5) go
// through the same action: set `initialSales` and optionally
// `monthlyBase` / `durationMonths` overrides.
export async function startCsPeriodAction(
  _prev: StartCsPeriodResult | null,
  raw: unknown,
): Promise<StartCsPeriodResult> {
  await requirePermission('salary:rule:manage');

  const parsed = startCsPeriodSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    const created = await startCsPeriod(parsed.data);
    revalidatePath('/owner/salary/cs');
    redirect(`/owner/salary/cs/${created.id}`);
  } catch (err) {
    const mapped = mapCsError(err);
    if (mapped) return mapped;
    throw err;
  }
}

// Manual settle — owner clicks "立即结算" on a specific period, or the
// system runs the batch via settleReadyCsPeriodsAction. Either way,
// the heavy lifting is in lib/salary/cs.ts.
export async function settleCsPeriodAction(
  periodId: string,
): Promise<SettleCsPeriodResult> {
  await requirePermission('salary:rule:manage');

  try {
    const r = await settleCsPeriod(periodId);
    revalidatePath('/owner/salary/cs');
    revalidatePath(`/owner/salary/cs/${periodId}`);
    return {
      status: 'success',
      commissionId: r.commissionId,
      totalSales: r.totalSales,
      tierRate: r.tierRate,
      commissionAmount: r.commissionAmount,
      totalIncome: r.totalIncome,
      nextPeriodId: r.nextPeriodId,
    };
  } catch (err) {
    const mapped = mapCsError(err);
    if (mapped) return mapped;
    throw err;
  }
}

// Owner kicks a batch settlement — scans every IN_PROGRESS period
// whose periodEnd has passed and settles each. Mirrors the cron path
// but triggered from the UI.
export async function settleReadyCsPeriodsAction(): Promise<SettleReadyCsResult> {
  await requirePermission('salary:rule:manage');

  try {
    const { settled, errors } = await settleReadyCsPeriods();
    revalidatePath('/owner/salary/cs');
    return {
      status: 'success',
      settledCount: settled.length,
      errorCount: errors.length,
      errors,
    };
  } catch (err) {
    if (err instanceof Error) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }
}

export async function markCsCommissionPaidAction(
  id: string,
  _prev: SalaryMutationResult | null,
  formData: FormData,
): Promise<SalaryMutationResult> {
  await requirePermission('salary:view:all');

  const parsed = markCsCommissionPaidSchema.safeParse({
    isPaid: formData.get('isPaid'),
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    await markCsCommissionPaid(id, parsed.data.isPaid);
  } catch (err) {
    const mapped = mapCsError(err);
    if (mapped) return mapped;
    throw err;
  }
  revalidatePath('/owner/salary/cs');
  return { status: 'success' };
}

// ─────────────────────────────────────────────────────────────────────
// 时薪工 (PACKER / CLEANER / COOK) actions — SPEC §5.4 / §3.9
// ─────────────────────────────────────────────────────────────────────

// Owner kicks the monthly hourly-payroll computation. With a workerId,
// recomputes that one row; without, runs the batch over every active
// hourly worker.
export async function recomputeHourlyPayrollAction(
  _prev: RecomputeHourlyResult | null,
  raw: unknown,
): Promise<RecomputeHourlyResult> {
  await requirePermission('salary:rule:manage');

  const parsed = recomputeHourlyPayrollSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    if (parsed.data.workerId) {
      await computeHourlyPayroll(parsed.data.workerId, parsed.data.month);
      revalidatePath('/owner/salary/hourly');
      return {
        status: 'success',
        month: parsed.data.month,
        workerCount: 1,
        errorCount: 0,
        errors: [],
      };
    }
    const { settled, errors } = await computeHourlyForAllInMonth(
      parsed.data.month,
    );
    revalidatePath('/owner/salary/hourly');
    return {
      status: 'success',
      month: parsed.data.month,
      workerCount: settled.length,
      errorCount: errors.length,
      errors,
    };
  } catch (err) {
    if (err instanceof HourlyAggregateError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }
}

// Finance toggle — same shape as the daily-salary mark-paid action.
export async function setHourlyPayrollPaidAction(
  id: string,
  _prev: SalaryMutationResult | null,
  formData: FormData,
): Promise<SalaryMutationResult> {
  await requirePermission('salary:view:all');

  const parsed = markHourlyPayrollPaidSchema.safeParse({
    isPaid: formData.get('isPaid'),
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  await markHourlyPayrollPaid(id, parsed.data.isPaid);
  revalidatePath('/owner/salary/hourly');
  return { status: 'success' };
}
