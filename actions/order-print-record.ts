'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/permissions';
import { markCurrentVersionPrinted, OrderPrintJobError } from '@/lib/order/print-jobs';
import type { OrderPrintRecordResult } from './order-print-record.types';

const inputSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
  workOrderVersion: z.number().int().min(1),
}).strict();

/**
 * 点「打印」即记已打印（业主 2026-10-02）：打印页关闭浏览器打印对话框后调用，
 * 只记录打印页渲染时的那个版本。
 */
export async function recordOrderPrintedAction(input: unknown): Promise<OrderPrintRecordResult> {
  const actor = await requirePermission('order:change:review');
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: 'error', message: '打印记录参数无效' };
  try {
    const result = await markCurrentVersionPrinted(parsed.data, actor);
    if (result.marked) {
      revalidatePath('/orders');
      revalidatePath(`/orders/${parsed.data.orderId}`);
    }
    return { status: 'success', marked: result.marked };
  } catch (error) {
    if (error instanceof OrderPrintJobError) return { status: 'error', message: error.message };
    throw error;
  }
}
