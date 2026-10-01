import { z } from 'zod';
import Decimal from 'decimal.js';
import { formatMoney } from '@/lib/dashboard/format';
import { formatRate } from '@/lib/format/unit-price';

export const REPORT_OPERATION_LABELS: Record<string, string> = { PARTIAL: '局部烫金', FULL: '专版烫金', PACKING: '打包入袋' };
export const REPORT_UNIT_LABELS: Record<string, string> = { PER_PASS: '下', PER_PIECE: '个', PER_BAG: '袋', PER_BOX: '盒' };
const decimal = z.string().refine((value) => {
  try { return new Decimal(value).isFinite(); } catch { return false; }
});
const foilSchema = z.object({ payroll: z.object({ foilWage: z.object({
  mode: z.literal('TIERED'), band: z.enum(['SMALL', 'LARGE']),
  multiplier: z.number().int().positive(), smallOrderAmount: decimal, setupRate: decimal,
  pieceAmount: decimal, fixedAmount: decimal, fixedAlreadyRecorded: z.boolean(),
}) }) });

/** Display saved ledger facts, never reprice a historic report using current rules. */
export function reportWageLines(report: {
  entryType: string; operationType: string; unit: string; chargeableQty: string;
  rate: string; amount: string; snapshot: unknown;
}): string[] {
  if (report.entryType === 'ADJUSTMENT') return ['人工调整', `调整金额 ${formatMoney(report.amount)}`];
  if (report.entryType === 'REVERSAL') return ['原报工冲正', `冲正金额 ${formatMoney(report.amount)}`];
  const parsed = foilSchema.safeParse(report.snapshot);
  if (parsed.success) {
    const detail = parsed.data.payroll.foilWage;
    const countUnit = report.operationType === 'FULL' ? '色' : '次';
    const lines = detail.band === 'SMALL'
      ? [`小单包价（含装版）：${formatRate(detail.smallOrderAmount)} 元 × ${detail.multiplier} ${countUnit}`,
        `本次包价 ${formatMoney(detail.fixedAmount)}`]
      : [`计件费 ${formatMoney(detail.pieceAmount)}`,
        `装版标准：${formatRate(detail.setupRate)} 元 × ${detail.multiplier} ${countUnit}`,
        `本次装版费 ${formatMoney(detail.fixedAmount)}`];
    if (detail.fixedAlreadyRecorded) lines.push('装版／包价已在此前报工或承接记录中计入');
    return [...lines, `本次记录 ${formatMoney(report.amount)}`];
  }
  const snapshot = z.object({ payroll: z.object({ foilWage: z.object({ mode: z.literal('MANUAL') }) }) }).safeParse(report.snapshot);
  if (snapshot.success) return ['人工核定计件', `本次暂计 ${formatMoney(report.amount)}`];
  // Old/incomplete snapshots can include fixed fees. Never invent a linear
  // explanation that contradicts the immutable amount actually recorded.
  const hasFoilMetadata = z.object({ payroll: z.object({ foilWage: z.unknown().refine((value) => value != null) }) }).safeParse(report.snapshot).success;
  if (hasFoilMetadata || !new Decimal(report.chargeableQty).times(report.rate).toDecimalPlaces(2).eq(report.amount)) {
    return ['按报工时保存的工资记录展示', `本次记录 ${formatMoney(report.amount)}`];
  }
  return [`计薪 ${report.chargeableQty} ${REPORT_UNIT_LABELS[report.unit] ?? '单位'} × ${formatRate(report.rate)} 元`, `本次记录 ${formatMoney(report.amount)}`];
}
