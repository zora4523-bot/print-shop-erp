import { z } from 'zod';
import {
  orderChangeRequestItemsSchema,
  parseStrictYmd,
  previewOrderChangeRequestPricingSchema,
  updateEditableOrderSchema,
} from '../auth/schemas';

export const adminOrderEditSchema = z.object({
  orderId: z.string().min(1).max(128),
  requestId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  expectedWorkOrderVersion: z.number().int().positive(),
  fields: updateEditableOrderSchema.partial({ promisedDate: true, isUrgent: true }),
  items: orderChangeRequestItemsSchema,
  promisedDate: z
    .string()
    .refine((value) => parseStrictYmd(value) !== null, '请填写有效的承诺交期')
    .nullable()
    .optional(),
  pendingChargeResolutions:
    previewOrderChangeRequestPricingSchema.shape.pendingChargeResolutions,
  expectedQuoteToken: z.string().max(256).nullable().optional(),
  expectedPriceRevision: z.number().int().nonnegative().optional(),
});

export type AdminOrderEditInput = z.input<typeof adminOrderEditSchema>;
export type AdminOrderEditCommand = z.output<typeof adminOrderEditSchema>;
export type AdminOrderEditPreview = {
  oldTotal: string;
  newTotal: string | null;
  quoteToken: string | null;
  priceRevision: number;
  complete: boolean;
  changesRevision: boolean;
  blockers: string[];
  pendingCharges?: import('./change-request').OrderChangePendingChargePreview[];
};
export type AdminOrderEditResult =
  | { status: 'preview'; preview: AdminOrderEditPreview }
  | { status: 'saved' }
  | { status: 'error'; message: string };
