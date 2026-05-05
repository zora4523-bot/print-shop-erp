'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requirePermission } from '@/lib/auth/permissions';
import { CdrBundleError, createBundle } from '@/lib/cdr/bundle';
import { parseStrictYmd } from '@/lib/auth/schemas';
import type { CreateBundleResult } from './foreman-cdr.types';

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
  // 访问域）> 默认 localhost。Codex round 121 medium：之前从 env 读
  // 在 dev (127.0.0.1 / ngrok) 会回退到 localhost:3000 死链。
  const baseUrl = await deriveBaseUrl();

  try {
    const result = await createBundle(
      { from, to, orderIds, baseUrl },
      { id: actor.id },
    );
    revalidatePath('/foreman/cdr');
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

/**
 * 从 Next.js request headers 推 baseUrl（含 protocol、不含尾斜线）。
 *   1. APP_PUBLIC_URL env 显式配置 → 直接用（部署期最稳，跨进程一致）
 *   2. x-forwarded-proto + (x-forwarded-host || host) → 推 base（dev /
 *      Vercel preview / 内网代理 默认走这条；自动跟随当前访问域）
 *   3. 兜底 http://localhost:3000（极端情况，单测 / scripts 没 request
 *      scope 时不会走到 action 层，所以不会真用到）
 */
async function deriveBaseUrl(): Promise<string> {
  if (process.env.APP_PUBLIC_URL) {
    return process.env.APP_PUBLIC_URL.replace(/\/+$/, '');
  }
  try {
    const h = await headers();
    const proto =
      h.get('x-forwarded-proto') ?? (h.get('host') ? 'http' : null);
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (proto && host) {
      return `${proto}://${host}`;
    }
  } catch {
    // headers() 抛 = no request scope；走兜底
  }
  return 'http://localhost:3000';
}
