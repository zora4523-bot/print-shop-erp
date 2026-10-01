'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/permissions';
import { BatchPrintAccessError, BatchPrintSelectionError, recordBatchPrint } from '@/lib/order/batch-print';
import { OrderPrintJobError, recordRenderedPrint } from '@/lib/order/print-jobs';
import type { BatchPrintRecordResult, OrderPrintRecordResult } from './order-print-record.types';

const inputSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
  workOrderVersion: z.number().int().min(1),
  revision: z.number().int().min(0),
}).strict();

const jobIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/**
 * 点「打印」即记已打印（业主 2026-10-02）：打印页关闭浏览器打印对话框后调用，
 * 只记录打印页渲染时的那份内容（版本与修订号）。
 */
export async function recordOrderPrintedAction(input: unknown): Promise<OrderPrintRecordResult> {
  const actor = await requirePermission('order:change:review');
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: 'error', message: '打印记录参数无效' };
  try {
    const outcome = await recordRenderedPrint(parsed.data, actor);
    if (outcome === 'MARKED') {
      revalidatePath('/orders');
      revalidatePath(`/orders/${parsed.data.orderId}`);
    }
    return { status: 'success', outcome };
  } catch (error) {
    if (error instanceof OrderPrintJobError) return { status: 'error', message: error.message };
    throw error;
  }
}

/** 打开或下载批量打印文件时调用：文件里的工单整批记为已打印，任一失败整批不记。 */
export async function recordBatchPrintAction(jobId: unknown): Promise<BatchPrintRecordResult> {
  const actor = await requirePermission('order:change:review');
  const parsed = jobIdSchema.safeParse(jobId);
  if (!parsed.success) return { status: 'error', message: '打印任务无效' };
  try {
    const result = await recordBatchPrint(actor.id, parsed.data);
    if (!result) return { status: 'error', message: '打印文件尚未就绪' };
    if (result.marked > 0) revalidatePath('/orders');
    return { status: 'success', marked: result.marked };
  } catch (error) {
    if (error instanceof BatchPrintAccessError) return { status: 'error', message: '打印任务不存在或无权访问' };
    if (error instanceof BatchPrintSelectionError) return { status: 'error', message: '工单内容已变化，请重新选择并生成' };
    if (error instanceof OrderPrintJobError) return { status: 'error', message: error.message };
    throw error;
  }
}
