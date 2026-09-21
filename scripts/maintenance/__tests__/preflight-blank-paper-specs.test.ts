import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { ProductCategory } from '../../../generated/prisma/enums';
import { buildBlankPaperPreflight, type PreflightProduct } from '../../../lib/price/blank-paper-preflight';
import { preflightConnectionString, readBlankPaperPreflight } from '../preflight-blank-paper-specs';

const paper = { id: 'paper', name: '红卡', specification: '160g' };
const node = { id: 'node', path: 'product.blank_stock', legacyCategory: ProductCategory.BLANK_STOCK, isActive: true };
function product(id: string, changes: Partial<PreflightProduct> = {}): PreflightProduct {
  return { id, category: ProductCategory.BLANK_STOCK, categoryNodeId: 'node', specification: '中号封80×115',
    paperType: '160g红卡', weight: 160, paperMaterialId: null, isActive: true, ...changes };
}
const rule = { id: 'rule', priceBookId: 'current', productId: 'different-product', triggerCondition: {
  pricingRoutes: ['STOCK_BLANK'], paperTypes: ['160g红卡'], specifications: ['中号封'],
} };

describe('stage-zero report without connecting to a database', () => {
  it('reports all six anomaly categories, normalized aliases and a separate 120g bucket', () => {
    const report = buildBlankPaperPreflight({ papers: [paper], nodes: [node], rules: [], products: [
      product('a'), product('b'), product('unknown', { specification: '?' }),
      product('weightless', { paperType: '红卡', weight: null }),
      product('multi', { specification: '中号封80×115 / 大号封90×165' }),
      product('conflict', { weight: 180 }), product('alias', { specification: ' 中号封80x115 ' }),
      product('off-alias', { specification: '中号封80×120', isActive: false }),
      product('retired', { paperType: '120g红卡', weight: 120 }),
    ] });
    expect(report.diagnostics.sameCellMultipleRows.length).toBeGreaterThan(0);
    expect(report.diagnostics.specificationUnparseable.map((row) => row.product.id)).toEqual(['unknown']);
    expect(report.diagnostics.weightUnparseable.map((row) => row.product.id)).toEqual(['weightless']);
    expect(report.diagnostics.multiValue.map((row) => row.product.id)).toEqual(['multi']);
    expect(report.diagnostics.weightConflict.map((row) => row.product.id)).toEqual(['conflict']);
    expect(report.diagnostics.nonExactSpecification.active.map((row) => row.product.id)).toEqual(['multi', 'alias']);
    expect(report.diagnostics.nonExactSpecification.inactive.map((row) => row.product.id)).toEqual(['off-alias']);
    expect(report.diagnostics.nonExactSpecification.normalizedEquivalent.map((row) => row.product.id)).toEqual(['alias']);
    expect(report.retired120g.products.map((row) => row.id)).toEqual(['retired']);
    expect(report.cells.find((cell) => cell.specificationKey === 'mid')?.reason).toBe('identity-conflict');
  });
  it('reports foreign-key conflicts, all-paper duplicate identities and invalid nodes', () => {
    const report = buildBlankPaperPreflight({ papers: [paper, { ...paper, id: 'inactive-paper' }], rules: [], nodes: [node],
      products: [product('bad-link', { paperMaterialId: 'missing' }), product('other-node', { categoryNodeId: 'missing' })] });
    expect(report.foreignKeyConflicts.map((row) => row.product.id)).toEqual(['bad-link']);
    expect(report.duplicatePaperIdentities[0]?.members).toHaveLength(2);
    expect(report.enabledNodeDistribution).toHaveLength(2);
    expect(report.nodeAssignmentReady).toBe(false);
  });
  it('counts linked rows with conflicting or missing text in the same cell', () => {
    const report = buildBlankPaperPreflight({ papers: [paper], nodes: [node], rules: [], products: [
      product('good'), product('missing-text', { paperMaterialId: paper.id, paperType: null, isActive: false }),
    ] });
    expect(report.diagnostics.sameCellMultipleRows).toEqual([
      { key: 'BLANK_STOCK:红卡:160:mid', productIds: ['good', 'missing-text'] },
    ]);
    expect(report.foreignKeyConflicts.map((row) => row.product.id)).toEqual(['missing-text']);
  });
  it.each([
    [[], [node], false],
    [[product('off', { isActive: false })], [node], false],
    [[product('on')], [node], true],
    [[product('on')], [{ ...node, isActive: false }], false],
    [[product('on')], [{ ...node, path: 'product.generic_stock' }], false],
  ])('node readiness does not infer a default from an empty or invalid catalog', (products, nodes, expected) => {
    expect(buildBlankPaperPreflight({ papers: [], rules: [], products, nodes }).nodeAssignmentReady).toBe(expected);
  });
  it('matches current rule text without productId and reports only cells without active rows', () => {
    const base = { papers: [paper], nodes: [node], rules: [rule] };
    const report = buildBlankPaperPreflight({ ...base, products: [product('off', { isActive: false })] });
    expect(report.noEnabledProductWithTextRules).toEqual([
      { paperId: 'paper', specificationKey: 'mid', retired: false, ruleIds: ['rule'] },
    ]);
    expect(buildBlankPaperPreflight({ ...base, products: [product('active')] }).noEnabledProductWithTextRules).toEqual([]);
    expect(buildBlankPaperPreflight({ ...base, products: [product('alias', { specification: '中号封' })] }).noEnabledProductWithTextRules).toEqual([]);
    const malformed = buildBlankPaperPreflight({ ...base, products: [], rules: [{ ...rule, triggerCondition: {} }] });
    expect(malformed.noEnabledProductWithTextRules).toEqual([]);
    expect(malformed.invalidCurrentRuleConditions).toHaveLength(1);
  });
  it('does not broaden the price selector text key using identity-only normalization', () => {
    const report = buildBlankPaperPreflight({ papers: [{ ...paper, name: '纸X' }], nodes: [], products: [],
      rules: [{ ...rule, triggerCondition: { ...rule.triggerCondition, paperTypes: ['160g纸×'] } }] });
    expect(report.noEnabledProductWithTextRules).toEqual([]);
  });
});

describe('read-only transaction and explicit connection selection', () => {
  it('never falls back to DATABASE_URL', () => {
    expect(() => preflightConnectionString([])).toThrow('显式');
    expect(() => preflightConnectionString(['--database-url', 'postgres://localhost/'])).toThrow();
    expect(preflightConnectionString(['--database-url', 'postgres://localhost/target'])).toBe('postgres://localhost/target');
  });
  it('only SELECTs inside a READ ONLY snapshot, prints database metadata, and rolls back', async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes('current_database()')
      ? [{ database: 'explicit_target', capturedAt: '2026-09-20' }] : [] }));
    const report = await readBlankPaperPreflight({ query } as unknown as Pick<Client, 'query'>);
    expect(report.database).toBe('explicit_target');
    const sql = query.mock.calls.map(([sql]) => sql.trim());
    expect(sql[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(sql.at(-1)).toBe('ROLLBACK');
    expect(sql.slice(1, -1).every((sql) => sql.startsWith('SELECT'))).toBe(true);
    expect(sql.find((sql) => sql.includes('JOIN "CustomerPriceBook"'))).toContain('b."effectiveTo" > CURRENT_TIMESTAMP');
    expect(sql.find((sql) => sql.includes('FROM "Material"'))).not.toContain('"isActive"');
    expect(sql.find((sql) => sql.includes('FROM "Product"'))).not.toContain('WHERE');
  });
  it('rolls back on a failed read without attempting repairs', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT')) throw new Error('read failure');
      return { rows: [] };
    });
    await expect(readBlankPaperPreflight({ query } as unknown as Pick<Client, 'query'>)).rejects.toThrow('read failure');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'SELECT current_database() AS database, CURRENT_TIMESTAMP::text AS "capturedAt"', 'ROLLBACK',
    ]);
  });
});
