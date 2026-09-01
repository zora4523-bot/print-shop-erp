'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  recordAttendanceSchema,
  removeAttendanceSchema,
} from '@/lib/auth/schemas';
import {
  recordAttendance,
  removeAttendance,
  AttendanceError,
} from '@/lib/attendance';
import type { AttendanceMutationResult } from './foreman-attendance.types';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';

function revalidateAttendanceAndPayrollPaths(): void {
  revalidatePath('/foreman/attendance');
  // A real attendance change invalidates the unpaid hourly derivative in the
  // same transaction, so both owner and worker payroll reads must refresh.
  revalidatePath('/owner/salary');
  revalidatePath('/owner/salary/hourly');
  revalidatePath('/worker/salary');
}

// Foreman records one (worker, date) attendance row. Idempotent by
// design — same (worker, date) re-posts overwrite via upsert.
//
// Attendance is an independent HR responsibility, not a production-task
// assignment capability.
export async function recordAttendanceAction(
  _prev: AttendanceMutationResult | null,
  raw: unknown,
): Promise<AttendanceMutationResult> {
  const actor = await requirePermission('attendance:manage');

  const parsed = recordAttendanceSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  try {
    await recordAttendance(
      parsed.data.workerId,
      parsed.data.date,
      {
        normalHours: parsed.data.normalHours,
        otHours: parsed.data.otHours,
        spareHours: parsed.data.spareHours,
        workUnits: parsed.data.workUnits,
        leaveUnits: parsed.data.leaveUnits,
        leaveType: parsed.data.leaveType,
        remark: parsed.data.remark ?? null,
      },
      actor,
    );
  } catch (err) {
    if (err instanceof AttendanceError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidateAttendanceAndPayrollPaths();
  return { status: 'success' };
}

// Remove one (worker, date) row — "请假 = 没有行" semantic. Idempotent:
// removing a row that doesn't exist still returns success.
export async function removeAttendanceAction(
  _prev: AttendanceMutationResult | null,
  raw: unknown,
): Promise<AttendanceMutationResult> {
  const actor = await requirePermission('attendance:manage');

  const parsed = removeAttendanceSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  try {
    await removeAttendance(parsed.data.workerId, parsed.data.date, actor);
  } catch (err) {
    if (err instanceof AttendanceError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidateAttendanceAndPayrollPaths();
  return { status: 'success' };
}
