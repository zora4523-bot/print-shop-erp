'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  reportTaskSchema,
  batchTaskMutationSchema,
  batchScheduleOrdersSchema,
  reassignProductionTaskSchema,
  scheduleOrderSchema,
} from '@/lib/auth/schemas';
import {
  scheduleOrder,
  SchedulingError,
  beginTask,
  beginTasks,
  reportTask,
  reportTasks,
  reassignProductionTask,
  ReportError,
  InvalidTaskTransitionError,
} from '@/lib/production';
import { OrderInvariantError, InvalidOrderTransitionError } from '@/lib/order';
import type {
  BatchScheduleOrdersActionResult,
  BatchTaskMutationResult,
  ScheduleOrderResult,
  TaskMutationResult,
} from './production.types';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import { scheduleOrdersToWorker } from '@/lib/production/batch-scheduling';
import { UnauthorizedError } from '@/lib/auth/errors';

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

export async function batchScheduleOrdersAction(
  raw: unknown,
): Promise<BatchScheduleOrdersActionResult> {
  let actor: Awaited<ReturnType<typeof requirePermission>>;
  try {
    // Keep authorization as the first operation. A page can remain open after
    // its account is deleted or disabled, so an expired JWT must become a
    // recoverable action result instead of an unhandled route error.
    actor = await requirePermission('order:schedule');
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { status: 'unauthorized', message: err.message };
    }
    throw err;
  }
  const parsed = batchScheduleOrdersSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const result = await scheduleOrdersToWorker(parsed.data, actor);
    if (result.assigned.length === 0) {
      return {
        status: 'error',
        message:
          result.failed[0]?.message ?? '所选工单没有可以完成的排产任务',
      };
    }
    revalidatePath('/foreman/scheduling');
    revalidatePath('/orders');
    for (const assigned of result.assigned) {
      revalidatePath(`/orders/${assigned.orderId}`);
    }
    return {
      status: result.failed.length === 0 ? 'success' : 'partial',
      ...result,
    };
  } catch (err) {
    if (err instanceof SchedulingError) {
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
    overrideReason: formData.get('overrideReason') ?? '',
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }
  try {
    await reassignProductionTask(
      taskId,
      parsed.data.workerId,
      actor,
      parsed.data.overrideReason ?? '',
    );
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

export async function beginTasksAction(
  raw: unknown,
): Promise<BatchTaskMutationResult> {
  const actor = await requirePermission('task:report');
  const parsed = batchTaskMutationSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }
  try {
    const result = await beginTasks(parsed.data.taskIds, actor);
    revalidatePath('/worker/tasks');
    revalidatePath('/worker/orders');
    for (const taskId of result.taskIds) {
      revalidatePath(`/worker/tasks/${taskId}`);
    }
    return { status: 'success', taskIds: result.taskIds };
  } catch (error) {
    const mapped = mapTaskError(error);
    if (mapped?.status === 'error') return mapped;
    throw error;
  }
}

export async function reportTasksAction(
  raw: unknown,
): Promise<BatchTaskMutationResult> {
  const actor = await requirePermission('task:report');
  const parsed = batchTaskMutationSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }
  try {
    const result = await reportTasks(parsed.data.taskIds, actor);
    revalidatePath('/worker/tasks');
    revalidatePath('/worker/orders');
    for (const taskId of result.taskIds) {
      revalidatePath(`/worker/tasks/${taskId}`);
    }
    return { status: 'success', taskIds: result.taskIds };
  } catch (error) {
    const mapped = mapTaskError(error);
    if (mapped?.status === 'error') return mapped;
    throw error;
  }
}
