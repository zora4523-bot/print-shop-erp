import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client';
import { comparisonCaseSchema, comparisonCasesSchema, comparisonDigest, comparePaperSpecCaptures, type PaperComparisonCapture } from '../paper-spec-comparison';
import { capturePaperSpecCompatibility, type loadPaperComparisonReaders } from '../capture-paper-spec-compatibility';

const facts = { items: [{ itemKey: '1', fig: 1, productId: 'product', pricingRoute: 'STOCK_BLANK', specification: '中号封80×115',
  actualWidthMm: 80, actualHeightMm: 115, paperType: '160g测试纸', paperWeightGsm: 160, quantity: 2000,
  crafts: ['partial'], frontFoilColors: ['哑金'], backFoilColors: [], foilTechnique: 'FLAT', hasLocalFoil: true, lamination: 'NONE' }],
packagingGroups: [], isSfCollect: true, shipments: [] };
const caseOf = (coverage: string) => comparisonCaseSchema.parse({ id: coverage, coverage, facts });
function capture(): PaperComparisonCapture {
  return { format: 1, provenance: { revision: 'before', database: 'erp_test', capturedAt: '2026-09-20' },
    at: '2026-09-20T00:00:00Z', casesDigest: 'cases', dataDigest: 'rows', catalog: { disabled: false },
    results: [{ id: 'a', input: { configuration: 'CATALOG' }, quote: { unitPrice: '0.1234', manualReasons: [] }, processing: { amount: '246.80' } }] };
}

describe('paper comparison gate', () => {
  it('ignores provenance only and retains exact decimal strings', () => {
    const before = capture(); const after = capture(); after.provenance.revision = 'after';
    expect(comparePaperSpecCaptures(before, after)).toEqual([]);
    after.results[0]!.quote = { unitPrice: '0.1235', manualReasons: [] };
    expect(comparePaperSpecCaptures(before, after)).toEqual(['results']);
  });
  it.each(['format', 'at', 'casesDigest', 'dataDigest', 'catalog', 'results'] as const)('fails closed on %s changes', (key) => {
    const after = { ...capture(), [key]: null } as unknown as PaperComparisonCapture;
    expect(comparePaperSpecCaptures(capture(), after)).toContain(key);
  });
  it('rejects missing or empty evidence even when equal', () => {
    const empty = { ...capture(), results: [] };
    expect(comparePaperSpecCaptures(empty, empty)).toContain('empty-results');
    const incomplete = { results: [] } as unknown as PaperComparisonCapture;
    expect(comparePaperSpecCaptures(incomplete, incomplete)).toContain('dataDigest');
  });
  it('normalizes object ordering, never rounds prices or sorts quote lines', () => {
    expect(comparisonDigest({ a: '0.1234', b: '0' })).toBe(comparisonDigest({ b: '0', a: '0.1234' }));
    expect(comparisonDigest(['first', 'second'])).not.toBe(comparisonDigest(['second', 'first']));
    expect(comparisonDigest('0')).not.toBe(comparisonDigest(null));
  });
  it('requires all three routes, four coverage cases and unique IDs', () => {
    const cases = ['standard', 'missing-price', 'zero-price', 'four-decimal'].map(caseOf);
    expect(comparisonCasesSchema.safeParse(cases).success).toBe(false);
    cases[0]!.facts.items.push({ ...cases[0]!.facts.items[0]!, pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL' },
      { ...cases[0]!.facts.items[0]!, pricingRoute: 'COLOR_PRINT' });
    expect(comparisonCasesSchema.safeParse(cases).success).toBe(true);
    expect(comparisonCasesSchema.safeParse([...cases, cases[0]]).success).toBe(false);
  });
});

function harness() {
  const table = () => ({ findMany: vi.fn().mockResolvedValue([{ id: 'fixture' }]) });
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ database: 'erp_test', capturedAt: new Date('2026-09-20') }]),
    product: table(), material: table(), craft: table(), productCategoryNode: table(), customerPriceBook: table(), customerPriceRule: table(), customerChargeCategory: table() };
  const calculated = { input: { items: [{ itemKey: '1', craft: 'PARTIAL', configuration: { specification: 'CATALOG' } }] },
    quote: { items: [{ itemKey: '1', unitPrice: '0.1234', lines: [{ code: 'PARTIAL_BLANK', amount: '246.80' }] }], manualReasons: [] as { code: string }[] }, processing: { amount: '246.80' } };
  const readers = { readOptions: vi.fn().mockResolvedValue({ products: [], papers: [] }),
    calculate: vi.fn().mockResolvedValue(calculated), buildPapers: vi.fn().mockReturnValue([{ variants: [{ route: 'STOCK_BLANK', specification: '中号封' }] }]),
    weightOptions: vi.fn().mockReturnValue([{ value: 160, disabled: true }]) };
  const run = (coverage: string) => capturePaperSpecCompatibility(tx as unknown as Prisma.TransactionClient,
    readers as unknown as Awaited<ReturnType<typeof loadPaperComparisonReaders>>, [caseOf(coverage)], new Date('2026-09-20'), 'revision');
  return { tx, readers, calculated, run };
}

describe('capture at real catalog and quote IO boundaries', () => {
  it('passes original facts and fixed clock to quote reader; preserves all result fields and disabled weights', async () => {
    const h = harness(); const output = await h.run('four-decimal');
    expect(h.readers.readOptions).toHaveBeenCalledWith(h.tx);
    expect(h.readers.calculate).toHaveBeenCalledWith(h.tx, { now: new Date('2026-09-20'), facts, includeOrderCharges: true });
    expect(output.results[0]).toEqual({ id: 'four-decimal', ...h.calculated });
    expect(output.catalog).toMatchObject({ papers: [{ selections: [{ weights: [{ value: 160, disabled: true }] }] }] });
    expect(output.dataDigest).toMatch(/^[a-f0-9]{64}$/);
  });
  it('does not accept a price existing in a snapshot without a quoted PARTIAL_BLANK line', async () => {
    const h = harness(); h.calculated.quote.items[0]!.lines = [];
    await expect(h.run('four-decimal')).rejects.toThrow('未实际命中');
  });
  it('distinguishes zero from missing price', async () => {
    const h = harness(); h.calculated.quote.items[0]!.unitPrice = '0';
    await expect(h.run('zero-price')).resolves.toBeDefined();
    await expect(h.run('missing-price')).rejects.toThrow('未实际覆盖');
    h.calculated.quote.manualReasons = [{ code: 'PARTIAL_BLANK_PRICE_NOT_FOUND' }];
    await expect(h.run('missing-price')).resolves.toBeDefined();
  });
  it('fails on non-CATALOG standard sizes and propagates adapter failure', async () => {
    const h = harness(); h.calculated.input.items[0]!.configuration.specification = 'RESIZED';
    await expect(h.run('standard')).rejects.toThrow('CATALOG');
    h.readers.calculate.mockRejectedValue(new Error('catalog invalid'));
    await expect(h.run('standard')).rejects.toThrow('catalog invalid');
  });
});
