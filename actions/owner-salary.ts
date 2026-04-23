'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  recomputeDailySalarySchema,
  markDailySalaryPaidSchema,
} from '@/lib/auth/schemas';
import {
  computeDailyForAllMachineWorkers,
  computeDailyWorkerSalary,
  markDailySalaryPaid,
  DailySalaryError,
} from '@/lib/salary/daily';
import type {
  RecomputeDailyResult,
  SalaryMutationResult,
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
      const results = await computeDailyForAllMachineWorkers(parsed.data.date);
      count = results.length;
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
