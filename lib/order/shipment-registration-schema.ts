import { z } from 'zod';

export const shipmentRegistrationSchema = z.object({
  orderId: z.string().regex(/^[\w-]{1,64}$/),
  shipmentId: z.string().regex(/^[\w-]{1,64}$/),
  expectedVersion: z.coerce.number().int().nonnegative(),
  expectedRevision: z.coerce.number().int().nonnegative(),
  expectedEditVersion: z.coerce.number().int().nonnegative(),
  expectedWorkOrderVersion: z.coerce.number().int().positive(),
  expectedPriceRevision: z.coerce.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(),
  trackingNo: z.string().trim().max(64).regex(/^[A-Za-z0-9 -]*$/, '运单号仅支持字母、数字、空格和横线'),
  carrierCode: z.enum(['', 'ZTO', 'SF', 'OTHER']),
  carrierName: z.string().trim().max(80),
  confirm: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.confirm && (!value.trackingNo || !value.carrierCode || (value.carrierCode === 'OTHER' && !value.carrierName))) {
    ctx.addIssue({ code: 'custom', message: '请填写运单号并选择物流公司', path: ['trackingNo'] });
  }
});
export type ShipmentRegistrationInput = z.infer<typeof shipmentRegistrationSchema>;
export type ShipmentRegistrationResult = { ok: true; message: string } | { ok: false; message: string };
