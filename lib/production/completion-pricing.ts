import { ProductionInputError } from '@/lib/production/input-error';
import Decimal from 'decimal.js';
import { z } from 'zod';
import type { Prisma, ProductionJob, ProductionOperation } from '@/generated/prisma/client';
import { resolveReporterPieceworkRate } from '@/lib/salary/piecework-rate-selection';
import { foilWageRuleSchema, fullFoilColorCount } from '@/lib/salary/foil-wage';

const basisSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.enum(['MANUAL_REVISION', 'MANUAL_MIXED_COLORS', 'NON_PIECEWORK']) }),
  z.object({ mode: z.literal('AUTOMATIC'), priceBookId: z.string(), priceBookVersion: z.number(), ruleSetSha256: z.string(),
    source: z.string(), policyBookId: z.string().nullable(), policyBookVersion: z.number().nullable(), useUnifiedRates: z.boolean(),
    rate: foilWageRuleSchema.shape.pieceRate,
    smallOrderAmount: foilWageRuleSchema.shape.smallOrderAmount.nullable(),
    setupAmount: foilWageRuleSchema.shape.setupAmount.nullable(), multiplier: z.number().positive(),
  }),
]);
export type CompletionPricingBasis = z.infer<typeof basisSchema>;
const itemsSchema = z.array(z.object({ id: z.string(), quantity: z.number().int().positive(), frontFoilColors: z.array(z.string()), backFoilColors: z.array(z.string()) })).nonempty();

function parsePricingBasis(value: unknown): CompletionPricingBasis {
  const parsed = basisSchema.safeParse(value);
  if (!parsed.success) throw new ProductionInputError('原计薪资料不完整，请先核对历史记录');
  return parsed.data;
}

/** Freeze the rule and original physical inputs at the first registration request. */
export async function completionPricingBasis(tx: Prisma.TransactionClient, job: ProductionJob & { operation: ProductionOperation | null }, at: Date): Promise<CompletionPricingBasis> {
  const snapshot = job.snapshot as Prisma.JsonObject;
  if (snapshot.registrationPricing) return parsePricingBasis(snapshot.registrationPricing);
  if (job.manualPricing) return { mode: 'MANUAL_REVISION' };
  const op = job.operation;
  if (!op) return { mode: 'NON_PIECEWORK' };
  const parsed = itemsSchema.safeParse(snapshot.items);
  if (!parsed.success) throw new ProductionInputError('原生产资料不完整，请先核对历史数量与颜色');
  const items = parsed.data;
  const selected = await resolveReporterPieceworkRate(tx, job.workerId, op.operationType, op.unit, at);
  const { rule, book } = selected;
  const pieceQty = items.reduce((sum, item) => sum.plus(item.quantity), new Decimal(0));
  let multiplier = op.operationType === 'PARTIAL' ? op.payrollPassCount ?? op.plannedQty.div(pieceQty).toNumber() : 1;
  if (op.operationType === 'FULL' && rule.smallOrderAmount !== null && rule.setupAmount !== null) {
    const counts = items.map(item => fullFoilColorCount(item.frontFoilColors, item.backFoilColors));
    if (counts.some(count => count !== counts[0])) return { mode: 'MANUAL_MIXED_COLORS' };
    multiplier = counts[0];
  }
  return parsePricingBasis({ mode: 'AUTOMATIC', priceBookId: book.id, priceBookVersion: book.version, ruleSetSha256: book.ruleSetSha256,
    source: selected.source, policyBookId: selected.policy?.id ?? null, policyBookVersion: selected.policy?.version ?? null,
    useUnifiedRates: selected.policy?.useUnifiedRates ?? true, rate: rule.amount.toString(),
    smallOrderAmount: rule.smallOrderAmount?.toString() ?? null, setupAmount: rule.setupAmount?.toString() ?? null, multiplier });
}
