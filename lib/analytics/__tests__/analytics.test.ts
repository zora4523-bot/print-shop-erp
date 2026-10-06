import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));
import { parseAnalyticsFilters, analyticsRange, analyticsPeriod, analyticsUrl } from '../filters';
import { orderReport, structureReport, categoryGroups, paginateTable } from '../reports';
import { analyticsCsv } from '../export';
import { orderWhere, assertAnalyticsActor, checkRecordLimit, type AnalyticsOrder } from '../queries';
const date = new Date('2026-10-02T17:00:00Z');
const filters = parseAnalyticsFilters({ view: 'orders' }, date);
function order(overrides: Partial<AnalyticsOrder> = {}): AnalyticsOrder {
  return { id: 'a', orderNo: 'A', customName: null, customerRef: '=HYPERLINK("bad")', submittedAt: date, status: 'COMPLETED', kind: 'STANDARD', sourceOrderId: null, billingMode: 'CHARGE', pricingStatus: 'CONFIRMED', processingAmount: new Decimal('0.10'), packagingAmount: new Decimal('0.05'), settledFee: null, settledAt: null, submitter: { id: 'sale', displayName: '甲', role: 'SALES' }, items: [], customerCharges: [], agentMonthlyBillItem: null, ...overrides } as AnalyticsOrder;
}
describe('analytics filters and scope', () => {
  it('uses Shanghai midnight, inclusive end dates and month/year rollover', () => {
    expect(filters.from).toBe('2026-10-01'); expect(filters.to).toBe('2026-10-03');
    expect(analyticsRange(filters)).toEqual({ gte: new Date('2026-09-30T16:00Z'), lt: new Date('2026-10-03T16:00Z') });
    expect(analyticsPeriod('previous', new Date('2026-01-01T01:00Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
  it.each([{ from: '2026-02-30' }, { from: '2026-10-04', to: '2026-10-03' }, { from: '2025-01-01', to: '2026-01-02' }, { view: 'x' }, { sales: ['a', 'b'] }, { page: '0' }, { inventoryKind: 'x' }])('rejects invalid input %j', params => expect(() => parseAnalyticsFilters(params, date)).toThrow());
  it('drops unsupported dimensions and preserves only meaningful view transitions', () => {
    expect(parseAnalyticsFilters({ view: 'inventory', sales: 's', customer: 'c' }, date)).toMatchObject({ sales: '', customer: '' });
    const url = new URL(analyticsUrl({ ...filters, customer: '甲', page: 3 }, { view: 'costs' }), 'https://test');
    expect(url.searchParams.get('customer')).toBeNull(); expect(url.searchParams.get('page')).toBeNull();
    expect(orderWhere({ ...filters, paper: '纸', craft: 'FULL' })).toMatchObject({ status: { not: 'CANCELLED' }, items: { some: { paperType: '纸' } } });
    expect(orderWhere(filters, true).status).toBeUndefined();
  });
  it('blocks non-admin reads and never silently truncates totals', () => {
    expect(() => assertAnalyticsActor({ id: 's', role: 'SALES' })).toThrow();
    expect(() => checkRecordLimit(30001)).toThrow(); expect(() => checkRecordLimit(30000)).not.toThrow();
  });
});
describe('analytics money and reporting', () => {
  it('adds exact decimal amounts, avoids packaging double count and ignores waived charges', () => {
    const report = orderReport([order(), order({ id: 'b', processingAmount: new Decimal('0.20'), customerCharges: [{ amount: new Decimal('50'), status: 'WAIVED', category: { name: '作废' } }] })], filters, true);
    expect(report.metrics[1].value).toBe('0.30');
    expect(report.tables[3].rows).toEqual([[{ value: '加工费（含入袋）' }, { value: '0.30', format: 'money' }]]);
    expect(analyticsCsv(report, filters)).toContain("'=HYPERLINK");
  });
  it.each([null, { schemaVersion: 1, processingAmount: '999.00', charges: [] }])('preserves the known frozen total without substituting invalid/missing details: %j', snapshot => {
    const report = orderReport([order({ agentMonthlyBillItem: { bill: { id: 'b', status: 'CONFIRMED' }, settledFeeSnapshot: new Decimal('10'), settlementDetailSnapshot: snapshot, credits: [] } })], filters);
    expect(report.tables[3].rows).toEqual([[{ value: '已出账未分解' }, { value: '10.00', format: 'money' }]]); expect(report.tables[3].note).toContain('1 单');
  });
  it('labels estimates separately from confirmed customer fees', () => {
    const report = orderReport([order({ customerCharges: [{ amount: new Decimal('10'), status: 'ESTIMATED', category: { name: '运费' } }, { amount: new Decimal('20'), status: 'FINAL', category: { name: '运费' } }] })], filters);
    expect(report.tables[3].rows.map(row => row[0].value)).toContain('运费（预估）');
    expect(report.tables[3].rows.map(row => row[0].value)).toContain('运费');
  });
  it('de-duplicates orders within categories and keeps cross-category counts explicit', () => {
    const items = [{ id: '1', craft: 'FULL', crafts: ['FULL', 'legacy-print', 'legacy-full'], paperType: '纸', specification: 'A', quantity: 10, subtotal: new Decimal(1), product: { category: 'CUSTOM_FLAT_FOIL' } }, { id: '2', craft: 'FULL', crafts: [], paperType: '纸', specification: 'B', quantity: 20, subtotal: new Decimal(1), product: { category: 'CUSTOM_FLAT_FOIL' } }] as AnalyticsOrder['items'];
    expect(categoryGroups([order({ items })])[0].count).toBe(1);
    const report = structureReport([order({ items })], { ...filters, view: 'structure' }, new Map([['legacy-print', '特殊印刷'], ['legacy-full', '专版烫金']]));
    expect(report.details.rows[0][1].value).toBe('专版烫金、特殊印刷');
    expect(report.tables[0].rows.map(row => row.map(cell => cell.value))).toEqual([['专版烫金', '1', '30'], ['特殊印刷', '1', '10']]);
    expect(report.metrics[2].value).toBe('30'); expect(report.tables[0].rows[0][1].value).toBe('1');
  });
  it.each(['FULL', 'legacy-full'])('keeps equivalent craft drill-down %s consistent with de-duplicated groups', craft => {
    const items = [{ id: 'a', craft: 'FULL', crafts: ['legacy-full'], quantity: 10 }, { id: 'b', craft: null, crafts: ['legacy-full'], quantity: 5 }] as AnalyticsOrder['items'];
    const report = structureReport([order({ items })], { ...filters, view: 'structure', craft }, new Map([['legacy-full', '专版烫金']]));
    expect(report.metrics[2].value).toBe('15');
    expect(report.tables[0].rows).toHaveLength(1);
    expect(report.tables[0].rows[0].map(cell => cell.value)).toEqual(['专版烫金', '1', '15']);
    expect(report.tables[0].rows[0][0].href).toContain('craft=FULL');
    expect(report.details.rows.map(row => row[1].value)).toEqual(['专版烫金', '专版烫金']);
  });
  it('clamps pagination and full export contains every matching detail', () => {
    const table = { title: 'x', columns: ['x'], rows: Array.from({ length: 26 }, (_, i) => [{ value: String(i) }]) };
    expect(paginateTable(table, 99)).toMatchObject({ page: 2, pages: 2, total: 26, details: { rows: [[{ value: '25' }]] } });
    expect(paginateTable(table, 2, true).details.rows).toHaveLength(26);
  });
});
