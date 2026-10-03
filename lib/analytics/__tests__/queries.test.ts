import { beforeEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
const transaction = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: { $transaction: transaction } }));
import { analyticsRead, getAnalyticsCrafts, readOrders, readAnalyticsFinance, readAnalyticsTrend, type AnalyticsTx } from '../queries';
import { getAnalyticsOverview } from '../overview';
import { parseAnalyticsFilters } from '../filters';
const filters = parseAnalyticsFilters({ from: '2026-10-01', to: '2026-10-03', sales: 'sales' });
beforeEach(() => vi.clearAllMocks());
describe('read-only analytics sources', () => {
  it('enforces ADMIN before transaction and sets a repeatable read-only snapshot', async () => {
    const execute = vi.fn().mockResolvedValue(0), read = vi.fn().mockResolvedValue('ok');
    transaction.mockImplementationOnce(async run => run({ $executeRaw: execute }));
    await expect(analyticsRead({ id: 's', role: 'SALES' }, read)).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    await expect(analyticsRead({ id: 'a', role: 'ADMIN' }, read)).resolves.toBe('ok');
    expect(execute.mock.calls.map(call => call[0][0])).toEqual(['SET TRANSACTION READ ONLY', "SET LOCAL statement_timeout = '8s'"]);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead', timeout: 15000, maxWait: 5000 });
  });
  it('guards craft options and reads them through the shared read-only transaction', async () => {
    await expect(getAnalyticsCrafts({ id: 's', role: 'SALES' })).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
    const findMany = vi.fn().mockResolvedValue([{ id: 'craft', name: '压纹' }]);
    transaction.mockImplementationOnce(async run => run({ $executeRaw: vi.fn(), craft: { findMany } }));
    await expect(getAnalyticsCrafts({ id: 'a', role: 'ADMIN' })).resolves.toEqual([{ id: 'craft', name: '压纹' }]);
    expect(findMany).toHaveBeenCalledWith({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  });
  it('distinguishes confirmation, receipt, settlement dates and current outstanding', async () => {
    const bills = vi.fn().mockResolvedValueOnce({ _sum: { totalAmount: new Decimal('100.01') } }).mockResolvedValueOnce({ _sum: { totalAmount: new Decimal('10.10') } });
    const receipts = vi.fn().mockResolvedValue({ _sum: { amount: new Decimal('0.20') } });
    const orders = vi.fn().mockResolvedValue({ _sum: { settledFee: null } });
    expect(await readAnalyticsFinance({ agentMonthlyBill: { aggregate: bills }, agentMonthlyBillReceipt: { aggregate: receipts }, order: { aggregate: orders } } as unknown as AnalyticsTx, filters)).toEqual({ issued: '100.01', received: '0.20', outstanding: '10.10', settled: '0.00' });
    expect(bills.mock.calls[0][0].where).toHaveProperty('confirmedAt');
    expect(bills.mock.calls[1][0].where).toEqual({ agentUserId: 'sales', status: 'CONFIRMED' });
    expect(receipts.mock.calls[0][0].where).toHaveProperty('receivedAt');
    expect(orders.mock.calls[0][0].where).toHaveProperty('settledAt');
  });
  it('keeps overview aggregates available beyond the detailed report limit', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ count: BigInt(30001), processing: '3000100.01', pending: BigInt(0), free: BigInt(0) }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    transaction.mockImplementationOnce(async run => run({ $executeRaw: vi.fn(), $queryRaw: query }));
    const result = await getAnalyticsOverview({ id: 'a', role: 'ADMIN' }, filters);
    expect(result.metrics[0].value).toBe('30001'); expect(result.metrics[1].value).toBe('3000100.01');
    expect(query).toHaveBeenCalledTimes(3);
  });
  it.each(['FULL', 'legacy-full'])('expands equivalent primary/catalog filter %s in the same source snapshot', async craft => {
    const count = vi.fn().mockResolvedValue(0), findMany = vi.fn().mockResolvedValue([]);
    const tx = { craft: { findMany: vi.fn().mockResolvedValue([{ id: 'legacy-full', name: '专版烫金' }, { id: 'other', name: '压纹' }]) }, order: { count, findMany } } as unknown as AnalyticsTx;
    await readOrders(tx, { ...filters, view: 'structure', craft, paper: '纸' });
    const expected = { paperType: '纸', OR: [{ craft: 'FULL' }, { crafts: { hasSome: ['FULL', 'legacy-full'] } }] };
    expect(count.mock.calls[0][0].where.items.some).toEqual(expected);
    expect(findMany.mock.calls[0][0].where.items.some).toEqual(expected);
  });
  it('fills daily zeroes for both distinct event types', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ day: '2026-10-02', count: BigInt(2), submitted: BigInt(3) }]) } as unknown as AnalyticsTx;
    expect(await readAnalyticsTrend(tx, filters)).toEqual([{ day: '2026-10-01', count: 0, submitted: 0 }, { day: '2026-10-02', count: 2, submitted: 3 }, { day: '2026-10-03', count: 0, submitted: 0 }]);
    const monthly = await readAnalyticsTrend(tx, { ...filters, from: '2026-01-01', to: '2026-03-31' });
    expect(monthly.map(row => row.day)).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});
