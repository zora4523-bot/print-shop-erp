import Decimal from 'decimal.js';
import { z } from 'zod';

const amount = z.string().regex(/^-?(?:0|[1-9]\d*)\.\d{2}$/);
const schema = z.object({
  schemaVersion: z.literal(1), orderName: z.string().nullable(), processingAmount: amount,
  charges: z.array(z.object({ description: z.string(), amount })),
}).strict();

/** Public amounts only. Never include pricing rules, costs, approvals or wage facts. */
export function createBillSettlementDetail(order: {
  customName: string | null; processingAmount: Decimal.Value;
  customerCharges: Array<{ description: string; amount: Decimal.Value | null }>;
}) {
  return schema.parse({
    schemaVersion: 1, orderName: order.customName,
    processingAmount: new Decimal(order.processingAmount).toFixed(2),
    charges: order.customerCharges.map((charge) => ({
      description: charge.description,
      amount: new Decimal(charge.amount!).toFixed(2),
    })),
  });
}

/** Missing or inconsistent historical evidence must not be replaced by current prices. */
export function readBillSettlementDetail(value: unknown, settledFee: Decimal.Value) {
  const result = schema.safeParse(value);
  if (!result.success) return null;
  const total = result.data.charges.reduce((sum, charge) => sum.plus(charge.amount), new Decimal(result.data.processingAmount));
  return total.eq(settledFee) ? result.data : null;
}
