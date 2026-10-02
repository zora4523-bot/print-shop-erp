'use server';

import { readCdrProgress } from '@/lib/cdr/history';
import { z } from 'zod';
import { workbenchRegenerationSelection } from '@/lib/cdr/workbench';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { CdrBundleError, createBundle, enqueueBundle } from '@/lib/cdr/bundle';
import { cdrSelectionSchema } from '@/lib/cdr/workbench-model';
import { derivePublicBaseUrl } from '@/lib/public-base-url';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import type { CreateBundleResult } from './foreman-cdr.types';

export async function createWorkbenchBundleAction(_prev: CreateBundleResult | null, form: FormData): Promise<CreateBundleResult> {
  const actor = await requirePermission('design:bundle:create');
  let value: unknown;
  if (form.has('bundleId')) {
    const id = z.string().min(1).max(128).safeParse(form.get('bundleId'));
    if (!id.success) return { status: 'error', message: '下载包不存在' };
    try { value = await workbenchRegenerationSelection(id.data); }
    catch (error) {
      if (error instanceof CdrBundleError) {
        revalidatePath('/owner');
        return { status: 'error', message: error.message };
      }
      throw error;
    }
  } else {
    try { value = JSON.parse(String(form.get('selection'))); } catch { return { status: 'error', message: '请选择工单' }; }
  }
  const parsed = cdrSelectionSchema.safeParse(value);
  if (!parsed.success) return { status: 'error', message: '请选择 1 至 100 个不重复的工单' };
  const input = { orderIds: parsed.data.map((r) => r.id), from: '', workbenchSelection: parsed.data, baseUrl: await derivePublicBaseUrl() };
  try {
    let result: CreateBundleResult;
    if (backgroundJobsMode() === 'durable') {
      const r = await enqueueBundle(input, actor);
      result = { status: 'queued', bundleId: r.bundleId, jobId: r.jobId, fileCount: r.fileCount };
    } else {
      const r = await createBundle(input, actor);
      result = { status: 'success', bundleId: r.bundleId, fileCount: r.fileCount, downloadUrl: r.downloadUrl,
        relativePath: r.relativePath, expiresAt: r.expiresAt.toISOString(), isMock: r.isMock };
    }
    revalidatePath('/owner');
    revalidatePath('/foreman/cdr');
    return result;
  } catch (error) {
    if (error instanceof CdrBundleError) {
      revalidatePath('/owner');
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

export async function getWorkbenchBundleProgressAction(bundleId: string) {
  await requirePermission('design:bundle:create');
  const id = z.string().min(1).max(128).safeParse(bundleId);
  if (!id.success) return null;
  return readCdrProgress(id.data);
}
