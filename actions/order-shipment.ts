'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  addOrderShipment,
  AddOrderShipmentError,
} from '@/lib/order/add-shipment';
import {
  addOrderShipmentSchema,
  type AddOrderShipmentResult,
} from '@/lib/order/add-shipment-schema';
import { OrderCustomerChargeError } from '@/lib/price/order-charge-service';

export async function addOrderShipmentAction(
  payload: unknown,
  mode: 'preview' | 'save',
): Promise<AddOrderShipmentResult> {
  const actor = await requirePermission('order:create');
  const parsed = addOrderShipmentSchema.safeParse(payload);
  if (!parsed.success)
    return {
      status: 'error',
      message: parsed.error.issues.map((issue) => issue.message).join('；'),
    };
  if (mode !== 'preview' && mode !== 'save')
    return { status: 'error', message: '操作无效，请刷新页面' };
  try {
    const preview = await addOrderShipment(parsed.data, actor, mode);
    if (preview) return { status: 'preview', preview };
    revalidatePath('/orders');
    revalidatePath(`/orders/${parsed.data.orderId}`);
    revalidatePath(`/orders/${parsed.data.orderId}/edit`);
    return { status: 'saved' };
  } catch (error) {
    if (
      error instanceof AddOrderShipmentError ||
      error instanceof OrderCustomerChargeError
    )
      return { status: 'error', message: error.message };
    throw error;
  }
}
