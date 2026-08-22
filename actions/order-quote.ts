'use server';

import type { QuoteOrderItemsMutationResult } from './order-quote.types';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import { quoteOrderItemsSchema } from '@/lib/auth/schemas';
import { settlementTypeForOrderCreator } from '@/lib/order/settlement';
import { quoteOrderItemsPreview } from '@/lib/price/quote-service';

export async function quoteOrderItemsAction(
  raw: unknown,
): Promise<QuoteOrderItemsMutationResult> {
  const actor = await requirePermission('order:create');

  const parsed = quoteOrderItemsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const items = await quoteOrderItemsPreview(
      parsed.data.items,
      settlementTypeForOrderCreator(actor.role),
      parsed.data.orderItemCount ?? parsed.data.items.length,
    );
    return { status: 'success', items };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? `报价失败：${error.message}`
          : '报价失败，请稍后重试',
    };
  }
}
