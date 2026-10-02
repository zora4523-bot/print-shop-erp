import Decimal from 'decimal.js';
import { z } from 'zod';

const amount = z.string().regex(/^-?(?:0|[1-9]\d*)\.\d{2}$/);
const breakdownSchema = z.object({
  schemaVersion: z.literal(1), orderName: z.string().nullable(), processingAmount: amount,
  charges: z.array(z.object({ description: z.string(), amount })),
}).strict();
const cancellationSchema = z.object({
  schemaVersion: z.literal(2), kind: z.literal('CANCELLATION'),
  orderName: z.string().nullable(), settlementAmount: amount,
}).strict();
const schema = z.union([breakdownSchema, cancellationSchema]);

/** Public amounts only. Missing breakdowns never become invented zero amounts. */
export function createBillSettlementDetail(order: {
  customName: string | null; processingAmount: Decimal.Value | null;
  status?: string; settledFee?: Decimal.Value | null;
  customerCharges: Array<{ description: string; amount: Decimal.Value | null; status?: string }>;
}) {
  try {
    if (order.status === 'CANCELLED') {
      if (order.settledFee == null) return null;
      return cancellationSchema.parse({ schemaVersion: 2, kind: 'CANCELLATION',
        orderName: order.customName, settlementAmount: new Decimal(order.settledFee).toFixed(2) });
    }
    const charges = order.customerCharges.filter(charge => charge.status !== 'WAIVED');
    if (order.processingAmount == null || charges.some(charge => charge.amount == null)) return null;
    return breakdownSchema.parse({
      schemaVersion: 1, orderName: order.customName,
      processingAmount: new Decimal(order.processingAmount).toFixed(2),
      charges: charges.map(charge => ({ description: charge.description, amount: new Decimal(charge.amount as Decimal.Value).toFixed(2) })),
    });
  } catch { return null; }
}

/** Missing or inconsistent historical evidence must not be replaced by current prices. */
export function readBillSettlementDetail(value: unknown, settledFee: Decimal.Value) {
  const result = schema.safeParse(value);
  if (!result.success) return null;
  try {
    const data = result.data;
    if (data.schemaVersion === 2) {
      return new Decimal(data.settlementAmount).eq(settledFee)
        ? { ...data, processingAmount: null, charges: [{ description: '取消结算金额', amount: data.settlementAmount }] } : null;
    }
    const total = data.charges.reduce((sum, charge) => sum.plus(charge.amount), new Decimal(data.processingAmount));
    return total.eq(settledFee) ? data : null;
  } catch { return null; }
}
