'use server';

import { OrderSettlementType } from '@/generated/prisma/enums';
import type { QuoteExternalOrderChargesMutationResult } from './order-logistics-quote.types';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import { quoteExternalOrderChargesSchema } from '@/lib/auth/schemas';
import { settlementTypeForOrderCreator } from '@/lib/order/settlement';
import {
  OrderCustomerChargeError,
  quoteExternalOrderChargesPreview,
} from '@/lib/price/order-charge-service';

export async function quoteExternalOrderChargesAction(
  raw: unknown,
): Promise<QuoteExternalOrderChargesMutationResult> {
  const actor = await requirePermission('order:create');

  if (
    settlementTypeForOrderCreator(actor.role) !==
    OrderSettlementType.EXTERNAL_SALES
  ) {
    return {
      status: 'error',
      message: '当前账号不使用外部销售结算，无需计算对外快递与耗材费',
    };
  }

  const parsed = quoteExternalOrderChargesSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const quote = await quoteExternalOrderChargesPreview(parsed.data);
    return { status: 'success', quote };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof OrderCustomerChargeError
          ? `物流报价失败：${error.message}`
          : '物流报价失败，请稍后重试',
    };
  }
}
