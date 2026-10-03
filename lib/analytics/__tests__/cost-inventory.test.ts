import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));
import Decimal from 'decimal.js';
import { costReport } from '../costs';
import { inventoryReport } from '../inventory';
import { parseAnalyticsFilters } from '../filters';
import type { AnalyticsOrder, AnalyticsTx } from '../queries';
const filters = parseAnalyticsFilters({ view: 'costs' });
const root = { id: 'root', sourceOrderId: null, status: 'COMPLETED', settledFee: new Decimal('100'), customName: '测试单', orderNo: 'A', agentMonthlyBillItem: null } as AnalyticsOrder;
const row = { id: 'root', tasks: BigInt(1), taskAmount: '999', operations: BigInt(1), reports: BigInt(2), reportAmount: '30', wages: BigInt(1), wageAmount: '5', pendingWages: BigInt(0), outsources: BigInt(1), outsourceAmount: '10', pendingOutsources: BigInt(0) };
function tx(rows = [row], entries: unknown[] = [], reworks: unknown[] = []) { return { $queryRaw: vi.fn().mockResolvedValue(rows), order: { findMany: vi.fn().mockResolvedValue(reworks) }, orderCostEntry: { groupBy: vi.fn().mockResolvedValue(entries) } } as unknown as AnalyticsTx; }
describe('analytics cost evidence', () => {
  it('uses reports instead of legacy tasks, includes wages once and adds rework to original', async () => {
    const result = await costReport(tx([row, { ...row, id: 'child', reportAmount: '-2', wageAmount: '0', outsourceAmount: '0' }], [], [{ id: 'child', sourceOrderId: 'root', orderNo: 'B' }]), [root], filters);
    expect(result.metrics[1].value).toBe('43.00'); expect(result.metrics[2].value).toBe('57.00');
  });
  it('counts completion-only wages even without legacy tasks or operations', async () => {
    const result = await costReport(tx([{ ...row, tasks: BigInt(0), operations: BigInt(0), reports: BigInt(0), outsources: BigInt(0) }]), [root], filters);
    expect(result.metrics[1].value).toBe('5.00');
  });
  it('suppresses legacy manual piecework once completion wages are authoritative', async () => {
    const result = await costReport(tx([{ ...row, tasks: BigInt(0), operations: BigInt(0), reports: BigInt(0), outsources: BigInt(0) }], [{ orderId: 'root', category: 'PIECEWORK', _sum: { amount: new Decimal('90') } }]), [root], filters);
    expect(result.metrics[1].value).toBe('5.00');
  });
  it('keeps unknown costs and unpriced wages out of comparable difference', async () => {
    const pending = await costReport(tx([{ ...row, pendingWages: BigInt(1) }]), [root], filters);
    expect(pending.metrics[2].value).toBeNull();
    const missing = await costReport(tx([]), [root], filters);
    expect(missing.details.rows[0][7].value).toBeNull(); expect(missing.metrics[2].value).toBeNull();
  });
  it('retains cancellation costs without reporting revenue or difference', async () => {
    const result = await costReport(tx(), [{ ...root, status: 'CANCELLED' }], filters);
    expect(result.metrics[1].value).toBe('45.00'); expect(result.details.rows[0][2].value).toBe('100'); expect(result.details.rows[0][8].value).toBeNull();
  });
  it('lists later credits separately and excludes adjusted orders from comparable difference', async () => {
    const result = await costReport(tx(), [{ ...root, agentMonthlyBillItem: { bill: { id: 'b', status: 'PAID' }, settledFeeSnapshot: new Decimal('80'), settlementDetailSnapshot: null, credits: [{ requestedAmount: new Decimal('-20'), allocations: [{ amount: new Decimal('-8'), bill: { status: 'CONFIRMED' } }, { amount: new Decimal('-12'), bill: { status: 'DRAFT' } }] }] } }], filters);
    expect(result.metrics[2].value).toBeNull();
    expect(result.details.rows[0].slice(-2).map(cell => cell.value)).toEqual(['-20.00', '-8.00']);
  });
  it('prefers frozen settlement amount over current values', async () => {
    const result = await costReport(tx(), [{ ...root, agentMonthlyBillItem: { bill: { id: 'b', status: 'PAID' }, settledFeeSnapshot: new Decimal('80'), settlementDetailSnapshot: null, credits: [] } }], filters);
    expect(result.metrics[2].value).toBe('35.00');
  });
});
describe('inventory evidence and precision', () => {
  it('keeps 4-digit prices, rounds line amounts, separates stock date scope and missing price', async () => {
    const purchases = [{ quantity: new Decimal('100'), unitCost: new Decimal('0.1234'), material: { name: '纸', specification: null, unit: '张' }, purchaseOrder: { id: 'p', purchaseNo: 'P', supplierName: 'S', createdAt: new Date() } }, { quantity: new Decimal('10'), unitCost: null, material: { name: '带', specification: null, unit: '米' }, purchaseOrder: { id: 'q', purchaseNo: 'Q', supplierName: 'S', createdAt: new Date() } }];
    const materialCount = vi.fn().mockResolvedValue(0);
    const client = { purchaseOrderItem: { count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValue(purchases) }, purchaseReceiptItem: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) }, material: { count: materialCount, findMany: vi.fn().mockResolvedValue([]) } } as unknown as AnalyticsTx;
    const result = await inventoryReport(client, { ...filters, view: 'inventory', supplier: 'S' });
    expect(result.metrics[0].value).toBe('12.34'); expect(result.details.rows[0][7]).toMatchObject({ value: '0.1234', format: 'price' });
    expect(result.details.rows[1][8].value).toBeNull(); expect(materialCount).toHaveBeenCalledWith({ where: {} });
  });
});
