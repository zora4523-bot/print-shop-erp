import { z } from 'zod';
import { createOrderQuoteItemsSchema } from '@/lib/auth/schemas';
import { NEW_ORDER_PRICING_ROUTES } from '@/lib/order/pricing-route';

/** One canonical order item; monetary fields are not part of this contract. */
export const workbenchItemQuoteSchema = z.object({
  item: createOrderQuoteItemsSchema.shape.items.element
    .safeExtend({
      pricingRoute: z.enum(NEW_ORDER_PRICING_ROUTES),
    })
    .refine((item) => item.manualQuoteReason == null, {
      message: '请使用目录中的纸张与工艺',
      path: ['manualQuoteReason'],
    }),
});
export type WorkbenchItemQuoteInput = z.infer<typeof workbenchItemQuoteSchema>;
