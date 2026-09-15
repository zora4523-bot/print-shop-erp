import { z } from 'zod';
import Decimal from 'decimal.js';
import {
  OrderFoilTechnique,
  OrderItemPricingRoute,
} from '@/generated/prisma/enums';
import { NEW_ORDER_PRICING_ROUTES } from '@/lib/order/pricing-route';
import type { CreateOrderManualReasonCode } from '@/lib/price/create-order/types';

const PRICING_REASON_MESSAGES: Record<CreateOrderManualReasonCode, string> = {
  CONFIGURATION_OUTSIDE_NOTE: '该组合需要管理员确认报价',
  CUSTOM_PAPER: '所选纸张尚未纳入自动报价，请联系管理员核价',
  CUSTOM_CRAFT: '所选工艺尚未纳入自动报价，请联系管理员核价',
  MANUAL_PAPER_WEIGHT: '所选纸张克重需要管理员确认后核价',
  RESIZED: '所选尺寸需要管理员单独核价',
  PARTIAL_BLANK_PRICE_NOT_FOUND:
    '所选规格和纸张暂无局部烫金价格，请选择其他组合或联系管理员核价',
  PARTIAL_TEN_THOUSAND_ENVELOPE: '万元封局部烫金需要管理员单独核价',
  FULL_ICE_WHITE_ADMIN_PRICING:
    '冰白纸专版烫金由管理员手动核价，请提交工单后等待核价',
  FULL_PRICE_NOT_FOUND: '所选数量暂无专版烫金价格，请联系管理员核价',
  FULL_PAPER_SURCHARGE_NOT_FOUND:
    '所选纸张暂无专版烫金价格，请选择其他纸张或联系管理员核价',
  FULL_WEST_ENVELOPE_SURCHARGE_NOT_FOUND:
    '所选西封暂无完整专版烫金价格，请联系管理员核价',
  FULL_SECOND_COLOR_SURCHARGE_NOT_FOUND:
    '专版双色烫金暂无完整价格，请联系管理员核价',
  FULL_SPECIAL_EFFECT_PRICE_NOT_FOUND:
    '所选特殊烫金工艺暂无完整价格，请联系管理员核价',
  FULL_THREE_OR_MORE_COLORS: '专版烫金三色及以上需要管理员核价',
  FULL_TEN_THOUSAND_ENVELOPE: '万元封专版烫金需要管理员单独核价',
  PRINT_PRICE_NOT_FOUND: '所选纸张、规格和数量暂无彩印价格，请联系管理员核价',
  PRINT_QUANTITY_OVER_LIMIT: '所选数量超出彩印自动报价范围，请联系管理员核价',
  PRINT_FINISHING_PRICE_NOT_FOUND: '所选彩印工艺暂无完整价格，请联系管理员核价',
  PRINT_FOIL_PRICE_NOT_FOUND:
    '所选彩印加烫金组合暂无完整价格，请联系管理员核价',
  PRINT_FOIL_MANUAL_PRICE_INCLUDES_PLATE:
    '彩印加烫金需核对包含制版费的整款报价',
};

/** Only controlled sales guidance crosses the boundary, never engine messages. */
export function workbenchPricingReasons(
  reasons: readonly { code: CreateOrderManualReasonCode }[],
): string[] {
  const fallback = '该组合暂未取得完整加工费，请联系管理员核价';
  return [
    ...new Set(
      reasons.length
        ? reasons.map(({ code }) =>
            Object.hasOwn(PRICING_REASON_MESSAGES, code)
              ? PRICING_REASON_MESSAGES[code]
              : fallback,
          )
        : [fallback],
    ),
  ];
}

export const workbenchQuoteSchema = z
  .object({
    productId: z.string().trim().min(1).max(32),
    specification: z.string().trim().min(1).max(64),
    // This is a catalog selection label: material name (64) + up to 2000g (5).
    // The action resolves it into paper name and weight before order validation.
    paperType: z.string().trim().min(1).max(69),
    pricingRoute: z.enum(NEW_ORDER_PRICING_ROUTES),
    quantity: z.number().int().min(1).max(9_999_999),
    frontFoilColors: z.array(z.string().trim().min(1).max(32)).max(3),
    backFoilColors: z.array(z.string().trim().min(1).max(32)).max(3),
    foilTechnique: z.enum([
      OrderFoilTechnique.NONE,
      OrderFoilTechnique.FLAT,
      OrderFoilTechnique.RELIEF,
      OrderFoilTechnique.RAISED,
    ]),
    markup: z.number().int().min(0).max(100),
  })
  .superRefine((value, context) => {
    if (
      value.pricingRoute !== OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL &&
      (value.foilTechnique === OrderFoilTechnique.RELIEF ||
        value.foilTechnique === OrderFoilTechnique.RAISED)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['foilTechnique'],
        message: '浮雕与激凸请使用专版烫金路线',
      });
    }
  });

export type WorkbenchQuoteInput = z.infer<typeof workbenchQuoteSchema>;
export type WorkbenchQuote = {
  baseAmount: string | null;
  suggestedAmount: string | null;
  markupAmount: string | null;
  lines: { name: string; rate: string; units: string; amount: string }[];
  needsPricing: boolean;
  pricingReasons?: string[];
  plateFeePending: boolean;
  processingVersion: number;
};
export type WorkbenchQuoteResult =
  | { status: 'success'; quote: WorkbenchQuote }
  | { status: 'error'; message: string };

/** Applies a sales markup to an authoritative base amount; never an order settlement amount. */
export function suggestWorkbenchAmount(base: string | null, markup: number) {
  if (base === null) return { suggestedAmount: null, markupAmount: null };
  const amount = new Decimal(base);
  const suggested = amount
    .mul(new Decimal(100).plus(markup))
    .div(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return {
    suggestedAmount: suggested.toFixed(2),
    markupAmount: suggested.minus(amount).toFixed(2),
  };
}
