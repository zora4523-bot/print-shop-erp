'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import {
  recomputeDailySalarySchema,
  markDailySalaryPaidSchema,
  startCsPeriodSchema,
  recordCsPayrollPaymentSchema,
  recomputeHourlyPayrollSchema,
  markHourlyPayrollPaidSchema,
} from '@/lib/auth/schemas';
import {
  computeDailyForAllMachineWorkers,
  computeDailyWorkerSalary,
  markDailySalaryPaid,
  addDailySalaryAdjustment,
  DailySalaryError,
} from '@/lib/salary/daily';
import {
  createWorkerMachineSalaryRule,
  PieceworkRuleError,
  salaryAdjustmentInputSchema,
  workerMachineRuleInputSchema,
} from '@/lib/salary/piecework-admin';
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
  RecomputeDailyResult,
  SalaryMutationResult,
  StartCsPeriodResult,
  SettleCsPeriodResult,
  SettleReadyCsResult,
  RecomputeHourlyResult,
  PieceworkRuleMutationResult,
  CsPayrollPaymentResult,
} from './owner-salary.types';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import { getDailySalaryRecomputeImpact } from '@/lib/salary/daily-recompute-impact';
import { writeAuditLog } from '@/lib/audit-log';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

// Owner kicks the daily-salary computation manually — useful when
// cron missed, when a worker's late report changes the totals, or
// for historical backfill. Accepts { date, workerId? }: with
// workerId, recomputes that single row; without, iterates every
// active machine worker for that date.
export async function recomputeDailySalaryAction(
  _prev: RecomputeDailyResult | null,
  raw: unknown,
): Promise<RecomputeDailyResult> {
  const actor = await requirePermission('salary:rule:manage');

  const parsed = recomputeDailySalarySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  try {
    const impact = await getDailySalaryRecomputeImpact(
      parsed.data.date,
      parsed.data.workerId,
    );
    const sameImpact =
      _prev?.status === 'confirm' &&
      _prev.impact.candidateWorkerCount === impact.candidateWorkerCount &&
      _prev.impact.affectedWorkerCount === impact.affectedWorkerCount &&
      _prev.impact.createCount === impact.createCount &&
      _prev.impact.overwriteUnpaidCount === impact.overwriteUnpaidCount &&
      _prev.impact.paidSkippedCount === impact.paidSkippedCount;
    const confirmationMatchesPreview =
      parsed.data.confirmed &&
      _prev?.status === 'confirm' &&
      _prev.date === parsed.data.date &&
      _prev.workerId === parsed.data.workerId &&
      // 新 UI 在预检后才输入理由，所以首个空理由允许绑定。
      // 一旦服务端已返回过非空理由，再改理由就必须重新确认。
      (_prev.reason === '' || _prev.reason === parsed.data.reason) &&
      sameImpact;

    // 确认请求也会重新计算 impact。日期/师傅/已绑定理由
    // 变化，或预检后数据变动，都只返回新预检而不写入。
    if (!confirmationMatchesPreview) {
      return {
        status: 'confirm',
        date: parsed.data.date,
        ...(parsed.data.workerId ? { workerId: parsed.data.workerId } : {}),
        reason: parsed.data.reason,
        impact,
      };
    }

    let result: Extract<RecomputeDailyResult, { status: 'success' }>;
    if (parsed.data.workerId) {
      await computeDailyWorkerSalary(parsed.data.workerId, parsed.data.date);
      result = {
        status: 'success',
        date: parsed.data.date,
        workerCount: 1,
        errorCount: 0,
        errors: [],
        impact,
      };
    } else {
      const { settled, errors } = await computeDailyForAllMachineWorkers(
        parsed.data.date,
      );
      result = {
        status: 'success',
        date: parsed.data.date,
        workerCount: settled.length,
        errorCount: errors.length,
        errors,
        impact,
      };
    }

    await writeAuditLog({
      actor,
      action: 'SALARY_DAILY_RECOMPUTE',
      entityType: parsed.data.workerId
        ? 'DailyWorkerSalary'
        : 'DailyWorkerSalaryBatch',
      entityId: parsed.data.workerId
        ? `${parsed.data.date}:${parsed.data.workerId}`
        : parsed.data.date,
      before: { impact },
      after: {
        reason: parsed.data.reason,
        workerCount: result.workerCount,
        errorCount: result.errorCount,
      },
      requestMetadata: {
        source: 'owner-salary.recomputeDailySalaryAction',
      },
    });
    revalidatePath('/owner/salary/daily');
    return result;
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
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  let marked: Awaited<ReturnType<typeof markDailySalaryPaid>>;
  try {
    marked = await markDailySalaryPaid(id, parsed.data.isPaid);
  } catch (err) {
    if (err instanceof DailySalaryError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }
  revalidatePath('/owner/salary/daily');

  // 「仅未发」筛选下标记已发后，这一行会直接从列表消失，承载 success
  // 状态的组件跟着卸载——发钱操作最需要确认的一步反而完全没有反馈。
  // 用 redirect 把确认信息提升到页面级：保留用户当前的筛选，附带刚
  // 处理的师傅名字，由页面渲染一条确认条。
  const back = formData.get('returnTo');
  // returnTo 来自客户端，必须限定前缀，避免变成开放重定向。
  const safeBack =
    typeof back === 'string' && back.startsWith('/owner/salary/daily')
      ? back
      : '/owner/salary/daily';
  const sep = safeBack.includes('?') ? '&' : '?';
  redirect(
    `${safeBack}${sep}marked=${encodeURIComponent(marked.workerName)}` +
      `&markedPaid=${parsed.data.isPaid ? '1' : '0'}`,
  );
}

export async function addDailySalaryAdjustmentAction(
  dailySalaryId: string,
  _prev: SalaryMutationResult | null,
  formData: FormData,
): Promise<SalaryMutationResult> {
  const actor = await requirePermission('salary:rule:manage');
  const parsed = salaryAdjustmentInputSchema.safeParse({
    idempotencyKey: formData.get('idempotencyKey'),
    dailySalaryId,
    type: formData.get('type'),
    amount: formData.get('amount'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    await addDailySalaryAdjustment({
      ...parsed.data,
      actor,
    });
  } catch (err) {
    if (err instanceof DailySalaryError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }
  revalidatePath('/owner/salary/daily');
  revalidatePath(`/owner/salary/daily/${dailySalaryId}`);
  return { status: 'success' };
}

export async function createWorkerMachineSalaryRuleAction(
  _prev: PieceworkRuleMutationResult | null,
  formData: FormData,
): Promise<PieceworkRuleMutationResult> {
  const actor = await requirePermission('salary:rule:manage');
  const parsed = workerMachineRuleInputSchema.safeParse({
    workerId: formData.get('workerId'),
    machineType: formData.get('machineType'),
    dailyBase: formData.get('dailyBase'),
    pieceRate: formData.get('pieceRate'),
    boardRate: formData.get('boardRate'),
    smallOrderThreshold: formData.get('smallOrderThreshold'),
    smallOrderFlatPrice: formData.get('smallOrderFlatPrice'),
    smallOrderInclusive: formData.get('smallOrderInclusive') === 'true',
    largeOrderSetupFee: formData.get('largeOrderSetupFee'),
    multiplierFactors: formData.getAll('multiplierFactors'),
    effectiveFrom: formData.get('effectiveFrom'),
    remark: formData.get('remark'),
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const created = await createWorkerMachineSalaryRule({
      ...parsed.data,
      actor,
    });
    revalidatePath('/owner/salary/piecework-rules');
    revalidatePath(RULE_CENTER_HREFS.workerPiecework);
    return { status: 'success', ruleId: created.id };
  } catch (err) {
    if (err instanceof PieceworkRuleError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }
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
  const actor = await requirePermission('salary:rule:manage');

  const parsed = startCsPeriodSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  try {
    const created = await startCsPeriod(parsed.data, new Date(), actor);
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
  const back = formData.get('returnTo');
  const safeBack =
    typeof back === 'string' && back.startsWith('/owner/salary/hourly')
      ? back
      : '/owner/salary/hourly';
  const sep = safeBack.includes('?') ? '&' : '?';
  redirect(
    `${safeBack}${sep}marked=${encodeURIComponent(marked.workerName)}` +
      `&markedPaid=${parsed.data.isPaid ? '1' : '0'}`,
  );
}
