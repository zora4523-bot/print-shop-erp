import Decimal from 'decimal.js';
import { z } from 'zod';

const money = z.string().regex(/^\d{1,10}(\.\d{1,4})?$/, '工价须为非负数，最多四位小数');
export const foilWageRuleSchema = z.object({
  pieceRate: money,
  smallOrderAmount: money,
  setupAmount: money,
}).strict();
export type FoilWageRule = z.infer<typeof foilWageRuleSchema>;
export const FOIL_WAGE_THRESHOLD = 1000;
export const DEFAULT_FOIL_WAGES = {
  PARTIAL: { pieceRate: '0.0070', smallOrderAmount: '12.0000', setupAmount: '5.0000' },
  FULL: { pieceRate: '0.0100', smallOrderAmount: '20.0000', setupAmount: '10.0000' },
} satisfies Record<string, FoilWageRule>;

/** Job quantity selects the band; a report's batch size never selects it. */
export function calculateFoilJobWage(quantity: number, count: number, raw: FoilWageRule) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(count) || count <= 0 || count > 999) {
    throw new Error('计薪数量与次数须为正整数，次数最多 999');
  }
  const rule = foilWageRuleSchema.parse(raw);
  const small = quantity <= FOIL_WAGE_THRESHOLD;
  const pieceAmount = small ? new Decimal(0) : new Decimal(quantity).mul(count).mul(rule.pieceRate);
  const fixedAmount = new Decimal(small ? rule.smallOrderAmount : rule.setupAmount).mul(count).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return {
    band: small ? 'SMALL' as const : 'LARGE' as const,
    quantity,
    count,
    pieceAmount: pieceAmount.toFixed(2, Decimal.ROUND_HALF_UP),
    fixedAmount: fixedAmount.toFixed(2, Decimal.ROUND_HALF_UP),
    totalAmount: pieceAmount.plus(fixedAmount).toFixed(2, Decimal.ROUND_HALF_UP),
  };
}

/** FULL counts distinct ink colours, never front/back occurrences. */
export function fullFoilColorCount(front: readonly string[], back: readonly string[]): number {
  const colors = new Set([...front, ...back].map((color) => color.trim()).filter(Boolean));
  if (colors.size < 1 || colors.size > 3) throw new Error('专版须有 1–3 个颜色，请核对款式颜色');
  return colors.size;
}
