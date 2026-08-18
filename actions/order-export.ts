'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import {
  InvalidOrderExportRequestError,
  ORDER_EXPORT_PARAMS_MAX_JSON_LENGTH,
  processOrderExportInline,
  requestOrderExport,
  type OrderExportParams,
  type OrderExportScope,
} from '@/lib/order/export';

export type OrderExportActionResult =
  | { status: 'invalid'; message: string }
  | { status: 'error'; message: string }
  | { status: 'queued'; exportId: string }
  | { status: 'success'; exportId: string };

export async function requestOrderExportAction(
  _previous: OrderExportActionResult | null,
  formData: FormData,
): Promise<OrderExportActionResult> {
  const actor = await requirePermission('order:export:all');

  const requestKey = stringEntry(formData.get('requestKey'));
  const scope = stringEntry(formData.get('scope'));
  const paramsRaw = stringEntry(formData.get('params'));
  if (!requestKey || (scope !== 'all' && scope !== 'filtered')) {
    return { status: 'invalid', message: '导出请求不完整，请刷新页面后重试' };
  }
  if (paramsRaw.length > ORDER_EXPORT_PARAMS_MAX_JSON_LENGTH) {
    return { status: 'invalid', message: '筛选条件过长' };
  }

  let params: OrderExportParams;
  try {
    params = parseParams(paramsRaw);
  } catch {
    return { status: 'invalid', message: '筛选条件不合法' };
  }

  try {
    const durable = backgroundJobsMode() === 'durable';
    const requested = await requestOrderExport({
      actor,
      requestKey,
      scope: scope as OrderExportScope,
      params,
      durable,
    });
    if (!durable && requested.status === 'PENDING') {
      await processOrderExportInline(requested.id);
    }
    revalidatePath('/orders');
    if (requested.status === 'FAILED' || requested.status === 'EXPIRED') {
      return {
        status: 'error',
        message: '这次导出请求已失效，请刷新页面后重新导出',
      };
    }
    if (requested.status === 'READY') {
      return { status: 'success', exportId: requested.id };
    }
    return durable
      ? { status: 'queued', exportId: requested.id }
      : { status: 'success', exportId: requested.id };
  } catch (error) {
    if (error instanceof InvalidOrderExportRequestError) {
      return { status: 'invalid', message: error.message };
    }
    throw error;
  }
}

function parseParams(raw: string): OrderExportParams {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid params');
  }
  const result: OrderExportParams = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') throw new Error('invalid params');
    result[key] = value;
  }
  return result;
}

function stringEntry(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}
