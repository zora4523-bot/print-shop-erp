'use server';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { editSalesOrderText, SalesTextEditError, salesTextEditSchema } from '@/lib/order/edit-sales-text';
export async function editSalesTextAction(orderId: string, targetId: string, field: 'itemName' | 'itemRemark', _previous: { error?: string; saved?: boolean } | null, form: FormData) {
  const actor = await requirePermission('order:create');
  const version = form.get('expectedEditVersion');
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)$/.test(version)) return { error: '请刷新工单后重试' };
  const parsed = salesTextEditSchema.safeParse({ orderId, targetId, field, expectedEditVersion: Number(version), value: form.get('value') });
  if (!parsed.success) return { error: '请检查填写内容并刷新后重试' };
  try { await editSalesOrderText(parsed.data, actor); }
  catch (error) { if (error instanceof SalesTextEditError) return { error: error.message }; throw error; }
  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/edit`);
  return { saved: true };
}
