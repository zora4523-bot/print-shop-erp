'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  adminOrderEditSchema,
  type AdminOrderEditResult,
} from '@/lib/order/admin-edit-schema';
import { editAdminOrder } from '@/lib/order/admin-edit';
import { OrderInvariantError } from '@/lib/order';
import { OrderChangeRequestError } from '@/lib/order/change-request-error';

async function runEdit(
  payload: unknown,
  mode: 'preview' | 'save',
): Promise<AdminOrderEditResult> {
  const actor = await requirePermission('order:update:post-schedule');
  const parsed = adminOrderEditSchema.safeParse(payload);
  if (!parsed.success)
    return {
      status: 'error',
      message: parsed.error.issues.map((issue) => issue.message).join('；'),
    };
  try {
    const preview = await editAdminOrder(parsed.data, actor, mode);
    if (preview) return { status: 'preview', preview };
    revalidatePath('/orders');
    revalidatePath(`/orders/${parsed.data.orderId}`);
    revalidatePath(`/orders/${parsed.data.orderId}/edit`);
    return { status: 'saved' };
  } catch (error) {
    if (
      error instanceof OrderInvariantError ||
      error instanceof OrderChangeRequestError
    ) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

// 签名适配层：权限闸口在 runEdit 的 requirePermission。
export async function previewAdminOrderEditAction(
  payload: unknown,
): Promise<AdminOrderEditResult> {
  return runEdit(payload, 'preview');
}
// 签名适配层：权限闸口在 runEdit 的 requirePermission。
export async function saveAdminOrderEditAction(
  payload: unknown,
): Promise<AdminOrderEditResult> {
  return runEdit(payload, 'save');
}
