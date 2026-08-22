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
  OverReportError,
  InvalidTaskTransitionError,
} from '@/lib/production';
import { OrderInvariantError, InvalidOrderTransitionError } from '@/lib/order';
import type {
  BatchScheduleOrdersActionResult,
  BatchTaskMutationResult,
  ReportTaskFormValues,
  ReportTaskMutationResult,
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

// 返回类型刻意收窄到 { status: 'error' }：它实际只会产出这一种，声明成
// TaskMutationResult 会让下面 reportTaskAction 里的 `{ ...mapped, values }`
// 推不出正确的联合。四个既有调用点在收紧后都仍然可编译。
function mapTaskError(
  err: unknown,
): { status: 'error'; message: string } | null {
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

// Form-shaped wrapper over beginTaskAction. React only emits the native
// form action + hidden $ACTION_ID when the function handed to
// useActionState is itself a Server Action reference of (prevState,
// formData) shape — a client-side `async () => boundAction()` closure has
// no $$FORM_ACTION and silently drops the zero-JS submit path.
//
// taskId rides in a hidden field rather than a `.bind` closure, mirroring
// setOrderUrgentAction: the value is server-rendered, so it stays correct
// with or without hydration. Trusting it is safe because beginTaskAction
// re-checks permission and lib/production enforces that the task belongs
// to the calling worker. See DECISIONS.md 2026-08-17.
export async function beginTaskFormAction(
  _prev: TaskMutationResult | null,
  formData: FormData,
): Promise<TaskMutationResult> {
  const taskId = formData.get('taskId');
  if (typeof taskId !== 'string' || taskId === '') {
    return { status: 'error', message: '任务参数缺失，请刷新后重试' };
  }
  return beginTaskAction(taskId);
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
// 原样取回一个字段用于回填。截断到 32 字符：这三个框都是数量，正常值远
// 短于此，超长只可能是被改过的请求，没必要原样吐回页面。
function reportFormString(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === 'string' ? raw.slice(0, 32) : '';
}

export async function reportTaskAction(
  taskId: string,
  _prev: ReportTaskMutationResult | null,
  formData: FormData,
): Promise<ReportTaskMutationResult> {
  const actor = await requirePermission('task:report');

  // 回填值在校验之前就取好：任何一条失败路径都要带着它返回，否则零 JS 下
  // 输入框会被重置回 defaultValue（计划数），而师傅只会以为系统接受了他
  // 刚才填的数字。
  const values: ReportTaskFormValues = {
    completedQty: reportFormString(formData, 'completedQty'),
    defectQty: reportFormString(formData, 'defectQty'),
    reworkQty: reportFormString(formData, 'reworkQty'),
    overReportConfirmed: formData.get('overReportConfirmed') !== null,
  };

  const parsed = reportTaskSchema.safeParse({
    completedQty: formData.get('completedQty'),
    defectQty: formData.get('defectQty'),
    reworkQty: formData.get('reworkQty'),
    overReportConfirmed: formData.get('overReportConfirmed'),
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
      values,
    };
  }

  try {
    await reportTask(taskId, parsed.data, actor);
  } catch (err) {
    // 顺序不能反：OverReportError 继承 ReportError，先走 mapTaskError 会把
    // 「勾一下就能过」也吞成通用 error，复选框就永远不会出现。
    // 这两种结局对师傅是完全不同的动作，必须给完全不同的呈现：
    //   confirmable → 挂在复选框上的字段错误（「请勾选…后再提交」）
    //   不可确认    → 顶部 role="alert"（「已达 N 倍上限，请核对数量」）
    if (err instanceof OverReportError && err.confirmable) {
      return {
        status: 'invalid',
        fieldErrors: { overReportConfirmed: [err.message] },
        values,
        overReport: {
          plannedQty: err.plannedQty,
          totalReported: err.totalReported,
        },
      };
    }
    const mapped = mapTaskError(err);
    if (mapped) return { ...mapped, values };
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
