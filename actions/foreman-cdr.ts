'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  CdrBundleError,
  createBundle,
  enqueueBundle,
  revokeBundleAccess,
} from '@/lib/cdr/bundle';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import { derivePublicBaseUrl } from '@/lib/public-base-url';
import { parseStrictYmd } from '@/lib/auth/schemas';
import type { CreateBundleResult, RevokeBundleResult } from './foreman-cdr.types';

// SPEC §3.5：foreman 在 /foreman/cdr 选日期 + 工单 → "生成下载包" →
// 这里写 DesignBundle + 触发 OSS 打包（mock-mode 下占位）→ revalidate
// 列表页。

export async function createBundleAction(
  _prev: CreateBundleResult | null,
  formData: FormData,
): Promise<CreateBundleResult> {
  const actor = await requirePermission('design:bundle:create');

  const fromRaw = formData.get('from');
  const toRaw = formData.get('to');
  const orderIdsRaw = formData.getAll('orderIds');

  const fieldErrors: Record<string, string[]> = {};

  const from = typeof fromRaw === 'string' ? fromRaw.trim() : '';
  if (!from || !parseStrictYmd(from)) {
    fieldErrors.from = ['请选择起始日期 YYYY-MM-DD'];
  }
  const to = typeof toRaw === 'string' && toRaw.trim() ? toRaw.trim() : from;
  if (to && !parseStrictYmd(to)) {
    fieldErrors.to = ['终止日期非法'];
  }
  // FormData.getAll 返 FormDataEntryValue[]；过滤成 string[]
  const orderIds = orderIdsRaw.filter(
    (v): v is string => typeof v === 'string' && v.trim() !== '',
  );
  if (orderIds.length === 0) {
    fieldErrors.orderIds = ['至少勾选 1 个工单'];
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { status: 'invalid', fieldErrors };
  }

  // 拼绝对 downloadUrl 用的 base：优先 APP_PUBLIC_URL（部署期固定）
  // > 请求 headers (proto + host)（dev / split-origin 自然跟随当前
  // 访问域）> 默认 localhost。
  // 在 dev (127.0.0.1 / ngrok) 会回退到 localhost:3000 死链。
  const baseUrl = await derivePublicBaseUrl();

  try {
    if (backgroundJobsMode() === 'durable') {
      const queued = await enqueueBundle(
        { from, to, orderIds, baseUrl },
        { id: actor.id },
      );
      revalidatePath('/foreman/cdr');
      revalidatePath('/owner');
      return {
        status: 'queued',
        bundleId: queued.bundleId,
        jobId: queued.jobId,
        fileCount: queued.fileCount,
      };
    }

    const result = await createBundle(
      { from, to, orderIds, baseUrl },
      { id: actor.id },
    );
    revalidatePath('/foreman/cdr');
    revalidatePath('/owner');
    return {
      status: 'success',
      bundleId: result.bundleId,
      downloadUrl: result.downloadUrl,
      relativePath: result.relativePath,
      expiresAt: result.expiresAt.toISOString(),
      fileCount: result.fileCount,
      isMock: result.isMock,
    };
  } catch (err) {
    if (err instanceof CdrBundleError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }
}

export async function revokeBundleAction(
  _prev: RevokeBundleResult | null,
  formData: FormData,
): Promise<RevokeBundleResult> {
  await requirePermission('design:bundle:create');
  const bundleId = formData.get('bundleId');
  if (typeof bundleId !== 'string' || !bundleId.trim()) {
    return { status: 'error', message: '下载包不存在' };
  }
  try {
    await revokeBundleAccess(bundleId.trim());
    revalidatePath('/foreman/cdr');
    revalidatePath('/owner');
    return { status: 'success' };
  } catch (error) {
    if (error instanceof CdrBundleError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}
