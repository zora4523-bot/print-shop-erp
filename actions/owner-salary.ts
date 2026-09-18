'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { appendReceipt, safeReturnTo } from '@/lib/admin/receipt';
import { requirePermission } from '@/lib/auth/permissions';
import {
  startCsPeriodSchema,
  recordCsPayrollPaymentSchema,
  recomputeHourlyPayrollSchema,
  markHourlyPayrollPaidSchema,
} from '@/lib/auth/schemas';
import {
  startCsPeriod,
  settleCsPeriod,
  settleReadyCsPeriods,
  recordCsPayrollPayment,
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
  SalaryMutationResult,
  StartCsPeriodResult,
  SettleCsPeriodResult,
  SettleReadyCsResult,
  RecomputeHourlyResult,
  CsPayrollPaymentResult,
} from './owner-salary.types';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
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
  const actor = await requirePermission('salary:rule:manage');

  const parsed = startCsPeriodSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  try {
    const created = await startCsPeriod(parsed.data, new Date(), actor);
    revalidatePath('/owner/salary/cs');
    redirect(appendReceipt(`/owner/salary/cs/${created.id}`, { created: '1' }));
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
    // Only the known business error is a safe UI message; anything else
    // (Prisma, etc.) rethrows to onRequestError → Sentry rather than
    // being swallowed into a toast that hides the fault from monitoring.
    if (err instanceof CsPeriodError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }
}

export async function recordCsPayrollPaymentAction(
  salaryPeriodId: string,
  _prev: CsPayrollPaymentResult | null,
  formData: FormData,
): Promise<CsPayrollPaymentResult> {
  const actor = await requirePermission('salary:view:all');

  const parsed = recordCsPayrollPaymentSchema.safeParse({
    idempotencyKey: formData.get('idempotencyKey'),
    baseAmount: formData.get('baseAmount'),
    commissionAmount: formData.get('commissionAmount'),
    paidAt: formData.get('paidAt'),
    paymentMethod: formData.get('paymentMethod'),
    referenceNo: formData.get('referenceNo'),
    remark: formData.get('remark'),
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  try {
    const payment = await recordCsPayrollPayment(
      salaryPeriodId,
      parsed.data,
      actor,
    );
    revalidatePath('/owner/salary/cs');
    revalidatePath(`/owner/salary/cs/${salaryPeriodId}`);
    return {
      status: 'success',
      paidBase: payment.paidBase,
      paidCommission: payment.paidCommission,
      isFullyPaid: payment.isFullyPaid,
    };
  } catch (err) {
    const mapped = mapCsError(err);
    if (mapped) return mapped;
    throw err;
  }
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
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
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
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  let marked: Awaited<ReturnType<typeof markHourlyPayrollPaid>>;
  try {
    marked = await markHourlyPayrollPaid(id, parsed.data.isPaid);
  } catch (err) {
    if (err instanceof HourlyAggregateError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }
  revalidatePath('/owner/salary/hourly');
  redirect(
    appendReceipt(safeReturnTo(formData.get('returnTo'), '/owner/salary/hourly'), {
      marked: marked.workerName,
      markedPaid: parsed.data.isPaid ? '1' : '0',
    }),
  );
}
