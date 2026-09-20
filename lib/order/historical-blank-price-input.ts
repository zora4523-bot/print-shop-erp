import { z } from 'zod';

const recordId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/, '请选择有效记录');
export const confirmHistoricalBlankPriceSchema = z.object({
  orderId: recordId,
  itemId: recordId,
  expectedOrderRevision: z.number().int().min(1),
  expectedPriceRevision: z.number().int().min(0),
  unitPrice: z.string().trim().regex(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,4})?$/, '材料单价最多四位小数'),
  reason: z.string().trim().min(1, '请填写定价依据').max(500),
}).strict();
export type ConfirmHistoricalBlankPriceInput = z.infer<typeof confirmHistoricalBlankPriceSchema>;

export function canConfirmHistoricalBlankPrice(status: string): boolean {
  return ['SUBMITTED', 'PENDING_FACTORY', 'CONFIRMED', 'ON_HOLD', 'RELEASED',
    'FOILING', 'PACKING', 'SCHEDULING', 'IN_PRODUCTION'].includes(status);
}
