'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { OrderInvariantError } from '@/lib/order';
import { AdminOrderWorkflowError } from '@/lib/order/admin-workflow';
import { registerShipment, SHIPMENT_IMAGE_LIMIT } from '@/lib/order/shipment-registration';
import { shipmentRegistrationSchema, type ShipmentRegistrationResult } from '@/lib/order/shipment-registration-schema';

export async function registerShipmentAction(form: FormData): Promise<ShipmentRegistrationResult> {
  const actor = await requirePermission('order:ship');
  const parsed = shipmentRegistrationSchema.safeParse({ ...Object.fromEntries(form), confirm: form.get('confirm') === 'true' });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? '填写内容有误，请检查后重试' };
  try {
    const file = form.get('photo');
    if (file instanceof File && file.size > SHIPMENT_IMAGE_LIMIT) return { ok: false, message: '图片过大，请压缩至 512 KB 以内' };
    const photo = file instanceof File && file.size ? new Uint8Array(await file.arrayBuffer()) : undefined;
    const result = await registerShipment(parsed.data, actor, photo);
    revalidatePath(`/orders/${parsed.data.orderId}`);
    revalidatePath('/orders');
    revalidatePath('/owner');
    revalidatePath('/owner/agent-bills');
    return { ok: true, message: result.completed ? '全部地址已发货，费用已确认' : result.replay ? '该次登记已保存' : parsed.data.confirm ? '该地址已发货' : '物流资料已保存' };
  } catch (error) {
    if (error instanceof OrderInvariantError || error instanceof AdminOrderWorkflowError) return { ok: false, message: error.message };
    return { ok: false, message: '保存失败，请刷新确认登记结果后重试' };
  }
}
