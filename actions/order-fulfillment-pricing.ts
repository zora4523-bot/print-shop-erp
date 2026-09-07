'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import {
  finalizeFulfillmentPricing,
  FulfillmentPricingError,
  previewFulfillmentPricing,
} from '@/lib/order/fulfillment-pricing';
import {
  finalizeFulfillmentPricingSchema,
  previewFulfillmentPricingSchema,
} from '@/lib/order/fulfillment-pricing-input';
import type {
  FinalizeFulfillmentPricingResult,
  PreviewFulfillmentPricingResult,
} from './order-fulfillment-pricing.types';

export async function previewFulfillmentPricingAction(
  _prev: PreviewFulfillmentPricingResult | null,
  raw: unknown,
): Promise<PreviewFulfillmentPricingResult> {
  const actor = await requirePermission('order:price:confirm');
  const parsed = previewFulfillmentPricingSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }
  try {
    return { status: 'success', preview: await previewFulfillmentPricing(parsed.data, actor) };
  } catch (error) {
    if (error instanceof FulfillmentPricingError) return { status: 'error', message: error.message };
    throw error;
  }
}

export async function finalizeFulfillmentPricingAction(
  _prev: FinalizeFulfillmentPricingResult | null,
  raw: unknown,
): Promise<FinalizeFulfillmentPricingResult> {
  const actor = await requirePermission('order:price:confirm');
  const parsed = finalizeFulfillmentPricingSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }
  try {
    const result = await finalizeFulfillmentPricing(parsed.data, actor);
    revalidatePath('/orders');
    revalidatePath(`/orders/${result.orderId}`);
    revalidatePath('/owner/bills');
    revalidatePath('/sales/bills');
    return { status: 'success', result, orderId: result.orderId };
  } catch (error) {
    if (error instanceof FulfillmentPricingError) return { status: 'error', message: error.message };
    throw error;
  }
}
