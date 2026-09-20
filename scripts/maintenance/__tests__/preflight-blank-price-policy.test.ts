import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { buildBlankPricePolicyPreflight, type BlankPricePreflightInput } from '../../lib/blank-price-policy-preflight';
import { readBlankPricePolicyPreflight } from '../preflight-blank-price-policy';
const data = (): BlankPricePreflightInput => ({
  at: new Date('2026-09-20T00:00:00Z'),
  papers: [{ id: 'paper', name: '180g红卡', specification: '180g', isActive: true, outOfStock: false }],
  books: [{ id: 'book', version: 1, isActive: true, effectiveFrom: '2026-09-19T00:00:00Z', effectiveTo: null, notes: {} }],
  rules: [{ id: 'rule', priceBookId: 'book', productId: null, amount: '0.1350', isActive: true, kind: 'BASE', calculationType: 'PER_PIECE',
    triggerCondition: { schemaVersion: 1, target: 'ITEM', pricingRoutes: ['STOCK_BLANK'], paperTypes: ['180g红卡'], specifications: ['中号封'] } }],
  items: [], bom: { papers: [], products: [], boms: [], nodes: [], existingSetting: undefined, migratedTargetIds: [] },
});
describe('positive blank price cutover preflight', () => {
  it('reports price authority with no required Product', () => {
    const report = buildBlankPricePolicyPreflight(data());
    expect(report).toMatchObject({ readyForAutomaticCutover: true, cleanupAuthorized: false,
      prices: { positive: 1, unboundCurrentRows: 1, zero: 0 }, historicalMaterialEvidence: { acceptedBlankItems: 0 } });
  });
  it('reports duplicate identities, missing paper and zero-price history requiring confirmation without manufacturing a rate', () => {
    const input = data();
    input.rules[0]!.amount = '0';
    input.rules.push({ ...input.rules[0]!, id: 'duplicate' });
    input.papers = [];
    input.items = [{ id: 'item', orderId: 'order', pricingRoute: 'STOCK_BLANK', paperType: '红卡', paperWeightGsm: 180,
      specification: '中号封', quantity: 1000, unitPrice: '0.5', fixedFee: '0', subtotal: '500', pricingSnapshot: null }];
    const report = buildBlankPricePolicyPreflight(input);
    expect(report.readyForAutomaticCutover).toBe(false);
    expect(report.prices.duplicateRuleGroups).toEqual([['rule', 'duplicate']]);
    expect(report.prices.missingOrAmbiguousPaperRuleIds).toEqual(['rule', 'duplicate']);
    expect(report.historicalMaterialEvidence.stoppedItemsRequiringManualConfirmation).toEqual(['item']);
  });
  it('only SELECTs in a repeatable READ ONLY transaction and leaves no open transaction', async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes('current_database()')
      ? [{ database: 'test_db', capturedAt: new Date('2026-09-20T00:00:00Z') }] : [] }));
    const report = await readBlankPricePolicyPreflight({ query } as unknown as Pick<Client, 'query'>);
    expect(report.database).toBe('test_db');
    expect(report.cleanupAuthorized).toBe(false);
    const statements = query.mock.calls.map(([sql]) => sql.trim());
    expect(statements[0]).toContain('READ ONLY');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements.slice(1, -1).every((sql) => sql.startsWith('SELECT'))).toBe(true);
  });
  it('rolls back read failure and never attempts repair', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT')) throw new Error('read failed');
      return { rows: [] };
    });
    await expect(readBlankPricePolicyPreflight({ query } as unknown as Pick<Client, 'query'>)).rejects.toThrow('read failed');
    expect(query.mock.calls.map(([sql]) => sql).at(-1)).toBe('ROLLBACK');
  });
});
