import Decimal from 'decimal.js';
import { z } from 'zod';

const number = z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/)]);
const money = number.refine((value) => {
  const decimal = new Decimal(value);
  return decimal.decimalPlaces() <= 2 && decimal.lte('9999999999.99');
}, 'Money must fit Decimal(12,2) without rounding');
const sourceRow = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]+$/), channel: z.literal('大表哥'),
  name: z.string().nullable(), date: z.iso.date(), file: z.string(), sheet: z.string(), row: z.number().int().positive(),
  amount: money.nullable(), components: z.array(money.nullable()).length(6),
  quantity: z.union([z.number().finite(), z.string()]).nullable(),
  g: z.union([z.number().finite(), z.string()]).nullable(), h: z.union([z.number().finite(), z.string()]).nullable(),
  styles: z.union([z.number().finite(), z.string()]).nullable(), process: z.string().nullable(),
  paper: z.string().nullable(), size: z.string().nullable(), pack: z.string().nullable(),
});

/** Test replay only: the original date is NOT evidence of shipment or settlement. */
export function parseSalesHistoryPreview(input: unknown) {
  const rows = z.array(sourceRow).min(1).max(5000).parse(input);
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('Duplicate source row IDs');
  return rows.map((row) => {
    const amount = row.amount === null ? null : new Decimal(row.amount).toFixed(2);
    const parts = row.components.map((value) => value === null ? null : new Decimal(value).toFixed(2));
    const sum = parts.reduce<Decimal>((total, value) => total.plus(value ?? 0), new Decimal(0));
    const balanced = amount !== null && sum.eq(amount);
    const totals = [row.h, row.g, row.quantity].map((value) => number.safeParse(value));
    const numericTotal = totals.find((value) => value.success);
    const conflictingTotals = totals[0].success && totals[1].success && !new Decimal(totals[0].data).eq(totals[1].data);
    const quantity = !conflictingTotals && numericTotal?.success ? new Decimal(numericTotal.data) : null;
    if (quantity && (!quantity.isInteger() || quantity.isNegative() || quantity.gt(2_147_483_647))) throw new Error('Invalid source quantity');
    const processing = new Decimal(parts[0] ?? 0).plus(parts[1] ?? 0).plus(parts[2] ?? 0);
    if (processing.gt('9999999999.99')) throw new Error('Processing amount exceeds database range');
    return { ...row, amount, parts, balanced, conflictingTotals, quantityRaw: row.quantity, quantity: quantity?.toNumber() ?? null,
      processing: processing.toFixed(2),
      difference: amount === null ? null : sum.minus(amount).toFixed(2) };
  });
}
