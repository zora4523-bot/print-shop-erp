'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  reportTaskSchema,
  scheduleOrderSchema,
} from '@/lib/auth/schemas';
import {
  scheduleOrder,
  SchedulingError,
  beginTask,
  reportTask,
  ReportError,
  InvalidTaskTransitionError,
} from '@/lib/production';
import { OrderInvariantError, InvalidOrderTransitionError } from '@/lib/order';
import type {
  ScheduleOrderResult,
  TaskMutationResult,
} from './production.types';

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

// Accepts a structured payload (the UI assembles { orderId, assignments })
// rather than FormData because the assignments array would flatten poorly
// through HTML form keys. The client passes a bound server-action call.
export async function scheduleOrderAction(
  _prev: ScheduleOrderResult | null,
  raw: unknown,
): Promise<ScheduleOrderResult> {
  const actor = await requirePermission('order:schedule');

  const parsed = scheduleOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    const result = await scheduleOrder(parsed.data, actor);
    revalidatePath('/orders');
    revalidatePath(`/orders/${result.orderId}`);
    return {
      status: 'success',
      orderId: result.orderId,
      tasksCreated: result.tasksCreated,
    };
  } catch (err) {
    // Narrow the error types the lib layer throws — any stray
    // exception bubbles up as a 500 so we notice during ops.
    if (err instanceof SchedulingError) {
      return { status: 'error', message: err.message };
    }
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    if (err instanceof InvalidOrderTransitionError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }
}

function mapTaskError(err: unknown): TaskMutationResult | null {
  if (err instanceof ReportError) {
    return { status: 'error', message: err.message };
  }
  if (err instanceof InvalidTaskTransitionError) {
    return { status: 'error', message: err.message };
  }
  if (err instanceof InvalidOrderTransitionError) {
    return { status: 'error', message: err.message };
  }
  if (err instanceof OrderInvariantError) {
    return { status: 'error', message: err.message };
  }
  return null;
}

// Worker clicks "开始生产" on their task — PENDING → IN_PROGRESS.
// OWNER / FOREMAN can also invoke (task:report permission allowlists
// WORKER only; the two overrides travel through the lib's ownership
// guard, not the action permission). Kept minimal — no payload.
export async function beginTaskAction(
  taskId: string,
): Promise<TaskMutationResult> {
  const actor = await requirePermission('task:report');
  try {
    await beginTask(taskId, actor);
  } catch (err) {
    const mapped = mapTaskError(err);
    if (mapped) return mapped;
    throw err;
  }
  revalidatePath('/worker/tasks');
  revalidatePath(`/worker/tasks/${taskId}`);
  return { status: 'success', taskId };
}

// Worker submits final counts — IN_PROGRESS → COMPLETED. Accepts
// FormData since this is a simple three-field form; preprocess in
// reportTaskSchema handles the string → int coercion.
export async function reportTaskAction(
  taskId: string,
  _prev: TaskMutationResult | null,
  formData: FormData,
): Promise<TaskMutationResult> {
  const actor = await requirePermission('task:report');

  const parsed = reportTaskSchema.safeParse({
    completedQty: formData.get('completedQty'),
    defectQty: formData.get('defectQty'),
    reworkQty: formData.get('reworkQty'),
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    await reportTask(taskId, parsed.data, actor);
  } catch (err) {
    const mapped = mapTaskError(err);
    if (mapped) return mapped;
    throw err;
  }

  revalidatePath('/worker/tasks');
  revalidatePath(`/worker/tasks/${taskId}`);
  return { status: 'success', taskId };
}
