'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  createProductionTaskDisputeSchema,
  reviewProductionTaskDisputeSchema,
} from '@/lib/auth/schemas';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import {
  createTaskDispute,
  reviewTaskDispute,
  TaskDisputeError,
} from '@/lib/production/task-dispute';
import type { TaskDisputeMutationResult } from './task-disputes.types';

export async function createTaskDisputeAction(
  taskId: string,
  _prev: TaskDisputeMutationResult | null,
  formData: FormData,
): Promise<TaskDisputeMutationResult> {
  const actor = await requirePermission('task:dispute:create');
  const parsed = createProductionTaskDisputeSchema.safeParse({
    taskId,
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }
  try {
    const result = await createTaskDispute(parsed.data, actor);
    revalidatePath(`/worker/tasks/${result.taskId}`);
    revalidatePath('/worker/salary');
    revalidatePath(`/orders/${result.orderId}`);
    return {
      status: 'success',
      ...result,
      message: '异议已提交，请等待管理员处理',
    };
  } catch (error) {
    if (error instanceof TaskDisputeError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

export async function reviewTaskDisputeAction(
  disputeId: string,
  _prev: TaskDisputeMutationResult | null,
  formData: FormData,
): Promise<TaskDisputeMutationResult> {
  const actor = await requirePermission('task:dispute:review');
  const parsed = reviewProductionTaskDisputeSchema.safeParse({
    disputeId,
    decision: formData.get('decision'),
    resolution: formData.get('resolution'),
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }
  try {
    const result = await reviewTaskDispute(parsed.data, actor);
    revalidatePath(`/orders/${result.orderId}`);
    revalidatePath(`/worker/tasks/${result.taskId}`);
    revalidatePath('/worker/salary');
    return {
      status: 'success',
      disputeId: result.disputeId,
      taskId: result.taskId,
      orderId: result.orderId,
      message:
        result.status === 'RESOLVED'
          ? '已确认处理该异议'
          : '已驳回该异议',
    };
  } catch (error) {
    if (error instanceof TaskDisputeError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}
