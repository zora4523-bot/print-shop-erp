'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { repairLegacyProductionFactsSchema } from '@/lib/auth/schemas';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import { LegacyProductionFactsError, repairLegacyProductionFacts } from '@/lib/order/legacy-production-facts';
import type { RepairLegacyProductionFactsResult } from './order-production-facts.types';

export async function repairLegacyProductionFactsAction(
  _prev: RepairLegacyProductionFactsResult | null, formData: FormData,
): Promise<RepairLegacyProductionFactsResult> {
  const actor = await requirePermission('order:production-facts:repair');
  const items = Array.from(formData.keys()).flatMap((key) => {
    const match = /^items\.(\d+)\.itemId$/u.exec(key);
    if (!match) return [];
    const prefix = `items.${match[1]}`;
    return [{ itemId: formData.get(key), craft: formData.get(`${prefix}.craft`) || undefined,
      unitsPerBag: formData.get(`${prefix}.unitsPerBag`) }];
  });
  const parsed = repairLegacyProductionFactsSchema.safeParse({
    orderId: formData.get('orderId'), expectedOrderRevision: formData.get('expectedOrderRevision'),
    items, packagingMode: formData.get('packagingMode') || undefined,
  });
  if (!parsed.success) return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  try {
    const result = await repairLegacyProductionFacts(parsed.data, actor);
    revalidatePath(`/orders/${result.orderId}`);
    revalidatePath(`/orders/${result.orderId}/edit`);
    return { status: 'success', result };
  } catch (error) {
    if (error instanceof LegacyProductionFactsError) return { status: 'error', message: error.message };
    throw error;
  }
}
