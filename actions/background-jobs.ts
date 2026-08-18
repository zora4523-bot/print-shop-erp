'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  cancelPendingBackgroundJob,
  retryDeadBackgroundJob,
} from '@/lib/background-jobs/repository';
import type { BackgroundJobMutationResult } from './background-jobs.types';

const JOBS_PATH = '/owner/background-jobs';

export async function retryBackgroundJobAction(
  _prev: BackgroundJobMutationResult | null,
  formData: FormData,
): Promise<BackgroundJobMutationResult> {
  await requirePermission('ops:jobs:manage');
  const jobId = readJobId(formData);
  const done = await retryDeadBackgroundJob(jobId);
  revalidatePath(JOBS_PATH);
  // false = 任务已不在 DEAD 态（别人先处理了 / worker 自己重试了）。
  // 静默 no-op 会让运维以为点成功了。
  if (!done) {
    return { status: 'error', message: '任务状态已变化，请刷新后重试' };
  }
  return { status: 'success', message: '已重新入队' };
}

export async function cancelBackgroundJobAction(
  _prev: BackgroundJobMutationResult | null,
  formData: FormData,
): Promise<BackgroundJobMutationResult> {
  await requirePermission('ops:jobs:manage');
  const jobId = readJobId(formData);
  const done = await cancelPendingBackgroundJob(jobId);
  revalidatePath(JOBS_PATH);
  if (!done) {
    return { status: 'error', message: '任务已开始执行或已结束，无法取消' };
  }
  return { status: 'success', message: '已取消' };
}

function readJobId(formData: FormData): string {
  const value = formData.get('jobId');
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw new Error('invalid background job id');
  }
  return value;
}
