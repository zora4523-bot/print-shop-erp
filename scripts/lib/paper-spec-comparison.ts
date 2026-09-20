import { createHash } from 'node:crypto';
import { z } from 'zod';
import { OrderFoilTechnique, OrderLamination, OrderPackagingMode } from '../../generated/prisma/enums';

export const comparisonCaseSchema = z.object({
  id: z.string().min(1),
  coverage: z.enum(['standard', 'missing-price', 'zero-price', 'four-decimal']),
  facts: z.object({
    items: z.array(z.object({
      itemKey: z.string().min(1), fig: z.number().int().positive(), productId: z.string().nullable(),
      pricingRoute: z.enum(['STOCK_BLANK', 'CUSTOM_SINGLE_FLAT_FOIL', 'COLOR_PRINT']),
      specification: z.string(), actualWidthMm: z.number().nullable(), actualHeightMm: z.number().nullable(),
      paperType: z.string(), paperWeightGsm: z.number().int().positive(), quantity: z.number().int().positive(),
      crafts: z.array(z.string()), frontFoilColors: z.array(z.string()), backFoilColors: z.array(z.string()),
      foilTechnique: z.enum(OrderFoilTechnique), hasLocalFoil: z.boolean().nullable(), lamination: z.enum(OrderLamination),
    }).strict()).min(1),
    packagingGroups: z.array(z.object({ groupKey: z.string(), mode: z.enum(OrderPackagingMode),
      items: z.array(z.object({ itemKey: z.string(), unitsPerBag: z.number().int().positive().nullable() }).strict()),
    }).strict()),
    isSfCollect: z.boolean(),
    shipments: z.array(z.object({ shipmentKey: z.string(), province: z.string().nullable(),
      itemQuantities: z.record(z.string(), z.number().int().nonnegative()),
    }).strict()),
  }).strict(),
}).strict();
export const comparisonCasesSchema = z.array(comparisonCaseSchema).min(4).superRefine((cases, ctx) => {
  if (new Set(cases.map((entry) => entry.id)).size !== cases.length) ctx.addIssue({ code: 'custom', message: '用例 ID 不能重复' });
  for (const coverage of ['standard', 'missing-price', 'zero-price', 'four-decimal']) {
    if (!cases.some((entry) => entry.coverage === coverage)) ctx.addIssue({ code: 'custom', message: `缺少 ${coverage} 用例` });
  }
  for (const route of ['STOCK_BLANK', 'CUSTOM_SINGLE_FLAT_FOIL', 'COLOR_PRINT']) {
    if (!cases.some((entry) => entry.facts.items.some((item) => item.pricingRoute === route))) ctx.addIssue({ code: 'custom', message: `缺少 ${route} 路线` });
  }
});
export type PaperComparisonCase = z.infer<typeof comparisonCaseSchema>;

/** Sort object keys, retaining array order and exact decimal strings. */
export function stableComparisonJson(value: unknown): string {
  const json = JSON.parse(JSON.stringify(value)) as unknown;
  const sort = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(sort)
    : entry !== null && typeof entry === 'object'
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)])) : entry;
  return JSON.stringify(sort(json));
}
export function comparisonDigest(value: unknown): string {
  return createHash('sha256').update(stableComparisonJson(value)).digest('hex');
}
export type PaperComparisonCapture = {
  format: 1;
  provenance: { revision: string; database: string; capturedAt: string };
  at: string; casesDigest: string; dataDigest: string;
  catalog: unknown; results: { id: string; input: unknown; quote: unknown; processing: unknown }[];
};

export function comparePaperSpecCaptures(before: PaperComparisonCapture, after: PaperComparisonCapture): string[] {
  const differences: string[] = [];
  for (const key of ['format', 'at', 'casesDigest', 'dataDigest', 'catalog', 'results'] as const) {
    if (before[key] === undefined || after[key] === undefined ||
      stableComparisonJson(before[key]) !== stableComparisonJson(after[key])) differences.push(key);
  }
  if (before.format !== 1 || after.format !== 1) differences.push('unsupported-format');
  if (!Array.isArray(before.results) || !before.results.length || !Array.isArray(after.results) || !after.results.length) differences.push('empty-results');
  return differences;
}
