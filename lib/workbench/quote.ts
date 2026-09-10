import { z } from 'zod';
import Decimal from 'decimal.js';
import {
  OrderFoilTechnique,
  OrderItemPricingRoute,
} from '@/generated/prisma/enums';
import { NEW_ORDER_PRICING_ROUTES } from '@/lib/order/pricing-route';

export const workbenchQuoteSchema = z
  .object({
    productId: z.string().trim().min(1).max(32),
    specification: z.string().trim().min(1).max(64),
    paperType: z.string().trim().min(1).max(32),
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
  plateFeePending: boolean;
  processingVersion: number;
};
export type WorkbenchQuoteResult =
  | { status: 'success'; quote: WorkbenchQuote }
  | { status: 'error'; message: string };

/** Called on the server only after the current published engine has priced the item. */
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
