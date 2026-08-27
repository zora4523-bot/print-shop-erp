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
import { deriveExternalOrderChargeShipments } from '@/lib/price/external-order-charge-facts';

function businessLogisticsQuoteError(message: string): string {
  return /\b[A-Z][A-Z0-9_]{2,}\b/.test(message)
    ? '物流价目簿配置异常，请联系管理员'
    : message;
}

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
    const quoteInput = parsed.data.items
      ? {
          isSfCollect: parsed.data.isSfCollect,
          shipments: deriveExternalOrderChargeShipments({
            isSfCollect: parsed.data.isSfCollect,
            items: parsed.data.items,
            shipments: parsed.data.shipments.map((shipment) => ({
              shipmentKey: shipment.shipmentKey,
              province: shipment.province,
              itemQuantities: shipment.itemQuantities ?? [],
            })),
          }),
        }
      : parsed.data;
    const quote = await quoteExternalOrderChargesPreview(quoteInput);
    return { status: 'success', quote };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof OrderCustomerChargeError
          ? `物流报价失败：${businessLogisticsQuoteError(error.message)}`
          : '物流报价失败，请稍后重试',
    };
  }
}
