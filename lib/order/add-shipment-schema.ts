import { z } from 'zod';

const id = z.string().trim().min(1).max(128);
export const addOrderShipmentSchema = z
  .object({
    orderId: id,
    sourceShipmentId: id,
    expectedRevision: z.number().int().nonnegative(),
    expectedEditVersion: z.number().int().nonnegative(),
    expectedWorkOrderVersion: z.number().int().positive(),
    expectedPriceRevision: z.number().int().nonnegative(),
    receiverName: z.string().trim().min(1, '请填写收件人').max(64),
    receiverPhone: z.string().trim().min(1, '请填写收货电话').max(32),
    receiverAddress: z.string().trim().min(1, '请填写收货地址').max(256),
    destinationProvince: z.string().trim().min(1, '请填写计费省份').max(32),
    lines: z
      .array(
        z.object({
          orderItemId: id,
          quantity: z
            .number()
            .int('分货数量须为整数')
            .min(0, '分货数量不能小于 0')
            .max(100000000, '分货数量超出范围'),
        }),
      )
      .min(1)
      .max(100),
    shippingFee: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, '请填写有效快递费')
      .optional(),
    packingMaterialFee: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, '请填写有效纸箱费')
      .optional(),
    overrideReason: z.string().trim().max(500).optional(),
    previewToken: z.string().max(128).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.lines.map((line) => line.orderItemId)).size !==
      value.lines.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: '款式不能重复',
      });
    if (
      (value.shippingFee !== undefined ||
        value.packingMaterialFee !== undefined) &&
      !value.overrideReason
    )
      ctx.addIssue({
        code: 'custom',
        path: ['overrideReason'],
        message: '请填写人工费用说明',
      });
    if (!value.lines.some((line) => line.quantity > 0))
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: '请为新地址分配数量',
      });
  });
export type AddOrderShipmentInput = z.infer<typeof addOrderShipmentSchema>;
export type AddOrderShipmentPreview = {
  token: string;
  pricingMode: 'REQUOTE' | 'ON_SUBMIT' | 'UNCHANGED';
  sequence: number;
  oldTotal: string;
  newTotal: string;
  delta: string;
  charges: {
    sequence: number;
    shippingFee: string;
    packingMaterialFee: string;
  }[];
};
export type AddOrderShipmentResult =
  | { status: 'preview'; preview: AddOrderShipmentPreview }
  | { status: 'saved' }
  | { status: 'error'; message: string };
