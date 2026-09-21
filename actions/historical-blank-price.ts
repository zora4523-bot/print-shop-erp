'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { confirmHistoricalBlankPriceSchema } from '@/lib/order/historical-blank-price-input';
import { confirmHistoricalBlankPrice, HistoricalBlankPriceError } from '@/lib/order/confirm-historical-blank-price';

export async function confirmHistoricalBlankPriceAction(raw: unknown): Promise<
  { status: 'success' } | { status: 'error'; message: string }
> {
  const actor = await requirePermission('order:price:confirm');
  const parsed = confirmHistoricalBlankPriceSchema.safeParse(raw);
  if (!parsed.success) return { status: 'error', message: parsed.error.issues[0]?.message ?? '请检查输入' };
  try {
    const result = await confirmHistoricalBlankPrice(parsed.data, actor);
    revalidatePath(`/orders/${result.orderId}`);
    revalidatePath('/owner/order-changes');
    return { status: 'success' };
  } catch (error) {
    if (error instanceof HistoricalBlankPriceError) return { status: 'error', message: error.message };
    throw error;
  }
}
