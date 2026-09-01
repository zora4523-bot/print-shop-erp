'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import {
  InvalidOrderExportRequestError,
  ORDER_EXPORT_PARAMS_MAX_JSON_LENGTH,
  ORDER_EXPORT_SELECTED_MAX,
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
  if (
    !requestKey ||
    (scope !== 'all' && scope !== 'filtered' && scope !== 'selected')
  ) {
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
  let selectedOrderIds: string[] | undefined;
  if (scope === 'selected') {
    try {
      selectedOrderIds = parseSelectedOrderIds(formData);
    } catch {
      return { status: 'invalid', message: '所选工单不合法，请刷新后重试' };
    }
  }

  try {
    const durable = backgroundJobsMode() === 'durable';
    const requested = await requestOrderExport({
      actor,
      requestKey,
      scope: scope as OrderExportScope,
      params,
      selectedOrderIds,
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

function parseSelectedOrderIds(formData: FormData): string[] {
  const repeated = formData
    .getAll('selectedOrderId')
    .map(stringEntry)
    .filter(Boolean);
  if (repeated.length > 0) {
    if (repeated.length > ORDER_EXPORT_SELECTED_MAX) throw new Error('too many');
    return repeated;
  }
  const raw = stringEntry(formData.get('selectedOrderIds'));
  if (!raw || raw.length > ORDER_EXPORT_SELECTED_MAX * 132) {
    throw new Error('invalid selection');
  }
  const parsed = JSON.parse(raw) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.length < 1 ||
    parsed.length > ORDER_EXPORT_SELECTED_MAX ||
    parsed.some((value) => typeof value !== 'string')
  ) {
    throw new Error('invalid selection');
  }
  return parsed;
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
