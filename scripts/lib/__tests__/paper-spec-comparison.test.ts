import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client';
import { comparisonCaseSchema, comparisonCasesSchema, comparisonDigest, comparePaperSpecCaptures, comparePaperPricePolicyCaptures, type PaperComparisonCapture } from '../paper-spec-comparison';
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
  const run = (coverage: string, phase?: 'legacy' | 'positive') => capturePaperSpecCompatibility(tx as unknown as Prisma.TransactionClient,
    readers as unknown as Awaited<ReturnType<typeof loadPaperComparisonReaders>>, [caseOf(coverage)], new Date('2026-09-20'), 'revision', phase);
  return { tx, readers, calculated, run };
}

describe('capture at real catalog and quote IO boundaries', () => {
  it('passes original facts and fixed clock to quote reader; preserves all result fields and disabled weights', async () => {
    const h = harness(); const output = await h.run('four-decimal');
    expect(h.readers.readOptions).toHaveBeenCalledWith(h.tx, { now: new Date('2026-09-20') });
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
  it('records only the intended new-business admission rejection in the positive phase', async () => {
    const h = harness();
    const admission = new Error('空白封单价未启用'); admission.name = 'CreateOrderQuoteError';
    h.readers.calculate.mockRejectedValue(admission);
    const output = await h.run('zero-price', 'positive');
    expect(output).toMatchObject({ format: 2, policyPhase: 'positive', results: [{
      id: 'zero-price', rejection: { code: 'BLANK_PRICE_NOT_ENABLED' }, quote: null, processing: null,
    }] });
    await expect(h.run('standard', 'positive')).rejects.toThrow(admission);
    await expect(h.run('zero-price', 'legacy')).rejects.toThrow(admission);
    h.readers.calculate.mockRejectedValue(new Error('database unavailable'));
    await expect(h.run('missing-price', 'positive')).rejects.toThrow('database unavailable');
  });
  it('fails if a stopped new-business case unexpectedly receives a quote', async () => {
    await expect(harness().run('missing-price', 'positive')).rejects.toThrow('停售未被拒绝');
  });
});


describe('explicit positive-price policy differences', () => {
  function policyCapture(phase: 'legacy' | 'positive'): PaperComparisonCapture {
    return { ...capture(), format: 2, policyPhase: phase, catalog: { options: [{ id: phase === 'legacy' ? 'old-product' : null }] },
      results: [{ id: 'positive', coverage: 'standard', input: {}, quote: { amount: '135.00' }, processing: {} }] };
  }
  const expected = { policy: 'POSITIVE_BLANK_PRICE_V1' as const, changes: [
    { path: '/catalog/options/0/id', before: '"old-product"', after: 'null', reason: 'CATALOG_IDENTITY' as const },
  ] };
  it('requires exact individual catalog changes rather than ignoring the catalog subtree', () => {
    const before = policyCapture('legacy'), after = policyCapture('positive');
    expect(comparePaperPricePolicyCaptures(before, after, expected)).toEqual([]);
    expect(comparePaperPricePolicyCaptures(before, after, { ...expected, changes: [] })).toContain('/catalog/options/0/id');
    after.catalog = { options: [{ id: 'fabricated-product' }] };
    expect(comparePaperPricePolicyCaptures(before, after, expected)).toContain('/catalog/options/0/id');
  });
  it('cannot whitelist a positive case price change as catalog or admission policy', () => {
    const before = policyCapture('legacy'), after = policyCapture('positive');
    after.results[0]!.quote = { amount: '136.00' };
    for (const reason of ['CATALOG_IDENTITY', 'NEW_BUSINESS_DISABLED', 'HISTORICAL_MATERIAL'] as const) {
      expect(comparePaperPricePolicyCaptures(before, after, { ...expected, changes: [...expected.changes,
        { path: '/results/0/quote/amount', before: '"135.00"', after: '"136.00"', reason }] })).toContain('/results/0/quote/amount');
    }
  });
  it('rejects duplicate and stale expectations', () => {
    expect(comparePaperPricePolicyCaptures(policyCapture('legacy'), policyCapture('positive'), { ...expected, changes: [...expected.changes, ...expected.changes] })).toContain('duplicate-expectation');
    expect(comparePaperPricePolicyCaptures(policyCapture('legacy'), policyCapture('positive'), { ...expected, changes: [...expected.changes,
      { path: '/catalog/options/0/source', before: 'MISSING', after: '"BLANK_PRICE"', reason: 'CATALOG_IDENTITY' }] })).toContain('unused-expectation:/catalog/options/0/source');
  });
  it('rejects reversed or unstated policy phases', () => {
    expect(comparePaperPricePolicyCaptures(policyCapture('positive'), policyCapture('legacy'), expected)).toContain('policy-phase');
  });
});
