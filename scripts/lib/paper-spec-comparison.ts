import { createHash } from 'node:crypto';
import { z } from 'zod';
import { OrderFoilTechnique, OrderLamination, OrderPackagingMode } from '../../generated/prisma/enums';

export const comparisonCaseSchema = z.object({
  id: z.string().min(1),
  coverage: z.enum(['standard', 'missing-price', 'zero-price', 'four-decimal', 'historical-stopped']),
  historicalOrderItemIds: z.array(z.string().min(1)).optional(),
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
  format: 1 | 2;
  policyPhase?: 'legacy' | 'positive';
  provenance: { revision: string; database: string; capturedAt: string };
  at: string; casesDigest: string; dataDigest: string;
  catalog: unknown; results: { id: string; coverage?: PaperComparisonCase['coverage']; rejection?: { code: 'BLANK_PRICE_NOT_ENABLED' }; input: unknown; quote: unknown; processing: unknown }[];
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

export const paperPricePolicyExpectationsSchema = z.object({
  policy: z.literal('POSITIVE_BLANK_PRICE_V1'),
  changes: z.array(z.object({
    /** JSON pointer to one scalar (or empty collection), never a whole subtree. */
    path: z.string().startsWith('/'),
    before: z.string(), after: z.string(),
    reason: z.enum(['CATALOG_IDENTITY', 'NEW_BUSINESS_DISABLED', 'HISTORICAL_MATERIAL']),
  }).strict()).max(100000),
}).strict();
export type PaperPricePolicyExpectations = z.infer<typeof paperPricePolicyExpectationsSchema>;

function leafChanges(before: unknown, after: unknown, path: string): Array<{ path: string; before: string; after: string }> {
  const isCollection = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
  const encode = (value: unknown) => value === undefined ? 'MISSING' : stableComparisonJson(value);
  if (isCollection(before) || isCollection(after)) {
    const kind = (value: unknown) => value === undefined ? 'missing' : Array.isArray(value) ? 'array' : isCollection(value) ? 'object' : 'scalar';
    const left = isCollection(before) ? Object.entries(before) : [];
    const right = isCollection(after) ? Object.entries(after) : [];
    const keys = [...new Set([...left.map(([key]) => key), ...right.map(([key]) => key)])].sort();
    const beforeMap = new Map(left), afterMap = new Map(right);
    const metadata = kind(before) !== kind(after)
      ? [{ path: `${path}/$kind`, before: kind(before), after: kind(after) }] : [];
    if (kind(before) === 'scalar' || kind(after) === 'scalar') metadata.push({ path: `${path}/$value`,
      before: kind(before) === 'scalar' ? encode(before) : 'MISSING', after: kind(after) === 'scalar' ? encode(after) : 'MISSING' });
    return [...metadata, ...keys.flatMap((key) => leafChanges(beforeMap.get(key), afterMap.get(key), `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`))];
  }
  return encode(before) === encode(after) ? [] : [{ path, before: encode(before), after: encode(after) }];
}

/** Every changed leaf must match an exact, reviewable expected value. No ignored fields. */
export function comparePaperPricePolicyCaptures(
  before: PaperComparisonCapture,
  after: PaperComparisonCapture,
  expectations: PaperPricePolicyExpectations,
): string[] {
  const errors: string[] = [];
  for (const key of ['format', 'at', 'casesDigest', 'dataDigest'] as const) {
    if (before[key] === undefined || after[key] === undefined || before[key] !== after[key]) errors.push(key);
  }
  if (before.format !== 2 || after.format !== 2 || before.policyPhase !== 'legacy' || after.policyPhase !== 'positive') errors.push('policy-phase');
  if (expectations.policy !== 'POSITIVE_BLANK_PRICE_V1') errors.push('unsupported-policy');
  if (!before.results.length || !after.results.length) errors.push('empty-results');
  if (before.results.length !== after.results.length || before.results.some((entry, index) =>
    entry.id !== after.results[index]?.id || entry.coverage !== after.results[index]?.coverage)) errors.push('case-identity');
  const expectedByPath = new Map(expectations.changes.map((change) => [change.path, change]));
  if (expectedByPath.size !== expectations.changes.length) errors.push('duplicate-expectation');
  const allowed = (change: PaperPricePolicyExpectations['changes'][number]): boolean => {
    if (change.reason === 'CATALOG_IDENTITY') return change.path.startsWith('/catalog/');
    const match = /^\/results\/(\d+)\/(?:input|quote|processing|rejection)(?:\/|$)/.exec(change.path);
    const entry = match ? after.results[Number(match[1])] : null;
    if (change.reason === 'NEW_BUSINESS_DISABLED') return Boolean(entry &&
      ['zero-price', 'missing-price'].includes(entry.coverage ?? '') && entry.rejection?.code === 'BLANK_PRICE_NOT_ENABLED');
    return Boolean(entry?.coverage === 'historical-stopped' && !entry.rejection);
  };
  const actual = [...leafChanges(before.catalog, after.catalog, '/catalog'), ...leafChanges(before.results, after.results, '/results')];
  for (const change of actual) {
    const expected = expectedByPath.get(change.path);
    if (!expected || !allowed(expected) || expected.before !== change.before || expected.after !== change.after) errors.push(change.path);
    expectedByPath.delete(change.path);
  }
  for (const unused of expectedByPath.keys()) errors.push(`unused-expectation:${unused}`);
  return errors;
}
