'use server';

import type {
  OrderPackagingQuotePreview,
  QuoteOrderPackagingGroupsMutationResult,
} from './order-packaging-quote.types';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import { quoteOrderPackagingGroupsSchema } from '@/lib/auth/schemas';
import { settlementTypeForOrderCreator } from '@/lib/order/settlement';
import {
  quoteOrderPackagingGroups,
  type OrderPackagingQuoteResult,
} from '@/lib/price/order-packaging-quote';

function businessPackagingError(message: string): string {
  return /\b[A-Z][A-Z0-9_]{2,}\b/.test(message)
    ? '入袋价格配置异常，请联系管理员'
    : message;
}

function publicPackagingQuote(
  quote: OrderPackagingQuoteResult,
): OrderPackagingQuotePreview {
  return {
    groups: quote.groups.map((group) => ({
      groupKey: group.groupKey,
      complete: group.complete,
      errors: group.errors.map(businessPackagingError),
      suggestedUnitPrice: group.suggestedUnitPrice,
      suggestedSubtotal: group.suggestedSubtotal,
    })),
    suggestedTotal: quote.suggestedTotal,
    requiresAdminConfirmation: quote.requiresAdminConfirmation,
    errors: quote.errors.map(businessPackagingError),
  };
}

export async function quoteOrderPackagingGroupsAction(
  raw: unknown,
): Promise<QuoteOrderPackagingGroupsMutationResult> {
  const actor = await requirePermission('order:create');

  const parsed = quoteOrderPackagingGroupsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const quote = await quoteOrderPackagingGroups(
      parsed.data.groups,
      settlementTypeForOrderCreator(actor.role),
    );
    return { status: 'success', quote: publicPackagingQuote(quote) };
  } catch {
    return {
      status: 'error',
      message: '入袋费报价失败，请稍后重试',
    };
  }
}
