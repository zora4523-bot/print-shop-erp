'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  reportTaskSchema,
  reassignProductionTaskSchema,
  scheduleOrderSchema,
} from '@/lib/auth/schemas';
import {
  scheduleOrder,
  SchedulingError,
  beginTask,
  reportTask,
  reassignProductionTask,
  ReportError,
  InvalidTaskTransitionError,
} from '@/lib/production';
import { OrderInvariantError, InvalidOrderTransitionError } from '@/lib/order';
import type {
  ScheduleOrderResult,
  TaskMutationResult,
} from './production.types';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';

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
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
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
// Only WORKER accounts can invoke this action. The production library also
// enforces that the task belongs to the current worker. Kept minimal — no payload.
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

export async function reassignProductionTaskAction(
  taskId: string,
  orderId: string,
  _prev: TaskMutationResult | null,
  formData: FormData,
): Promise<TaskMutationResult> {
  const actor = await requirePermission('task:assign');
  const parsed = reassignProductionTaskSchema.safeParse({
    workerId: formData.get('workerId'),
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }
  try {
    await reassignProductionTask(taskId, parsed.data.workerId, actor);
  } catch (err) {
    const mapped = mapTaskError(err);
    if (mapped) return mapped;
    throw err;
  }
  revalidatePath(`/orders/${orderId}`);
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
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
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
