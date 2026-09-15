'use server';

import { requirePermission } from '@/lib/auth/permissions';
import { derivePublicBaseUrl } from '@/lib/public-base-url';
import { BatchPrintSelectionError, requestBatchPrint } from '@/lib/order/batch-print';
import { batchPrintRequestSchema, type BatchPrintIssue } from '@/lib/order/batch-print-contract';

export type BatchPrintActionResult =
  | { status: 'queued'; jobId: string }
  | { status: 'error'; message: string; issues: BatchPrintIssue[] };

export async function requestBatchPrintAction(input: unknown): Promise<BatchPrintActionResult> {
  const actor = await requirePermission('order:view:all');
  const parsed = batchPrintRequestSchema.safeParse(input);
  if (!parsed.success) return { status: 'error', message: '请选择 1 至 50 张不同工单', issues: [] };
  try {
    const jobId = await requestBatchPrint(actor.id, parsed.data, await derivePublicBaseUrl());
    return { status: 'queued', jobId };
  } catch (error) {
    return {
      status: 'error', message: '未能创建打印文件，请检查所选工单后重试',
      issues: error instanceof BatchPrintSelectionError ? error.issues : [],
    };
  }
}
