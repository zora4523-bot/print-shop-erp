import { z } from 'zod';
import {
  orderChangeRequestItemsSchema,
  previewOrderChangeRequestPricingSchema,
  updateEditableOrderSchema,
} from '../auth/schemas';

export const adminOrderEditSchema = z.object({
  orderId: z.string().min(1).max(128),
  requestId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  expectedWorkOrderVersion: z.number().int().positive(),
  fields: updateEditableOrderSchema,
  items: orderChangeRequestItemsSchema,
  promisedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
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
