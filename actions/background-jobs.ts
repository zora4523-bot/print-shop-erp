'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  cancelPendingBackgroundJob,
  retryDeadBackgroundJob,
} from '@/lib/background-jobs/repository';

const JOBS_PATH = '/owner/background-jobs';

export async function retryBackgroundJobAction(formData: FormData): Promise<void> {
  await requirePermission('ops:jobs:manage');
  const jobId = readJobId(formData);
  await retryDeadBackgroundJob(jobId);
  revalidatePath(JOBS_PATH);
}

export async function cancelBackgroundJobAction(formData: FormData): Promise<void> {
  await requirePermission('ops:jobs:manage');
  const jobId = readJobId(formData);
  await cancelPendingBackgroundJob(jobId);
  revalidatePath(JOBS_PATH);
}

function readJobId(formData: FormData): string {
  const value = formData.get('jobId');
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw new Error('invalid background job id');
  }
  return value;
}
