'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { editItemRemark, editItemRemarkSchema, EditItemRemarkError } from '@/lib/order/edit-item-remark';
import type { OrderMutationResult } from './order.types';

export async function editItemRemarkAction(
  orderId: string, itemId: string, _previous: OrderMutationResult | null, form: FormData,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:create');
  const version = form.get('expectedEditVersion');
  const parsed = editItemRemarkSchema.safeParse({ orderId, itemId,
    expectedEditVersion: typeof version === 'string' && /^(0|[1-9]\d*)$/.test(version) ? Number(version) : NaN,
    remark: form.get('remark') });
  if (!parsed.success) return { status: 'invalid', fieldErrors: parsed.error.flatten().fieldErrors };
  try { await editItemRemark(parsed.data, actor); }
  catch (error) {
    if (error instanceof EditItemRemarkError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/edit`);
  return { status: 'success' };
}
