import { beforeEach, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
const { findMany, findFirst } = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: { agentMonthlyBill: { findMany, findFirst } } }));
import { exportSalesBillItems, exportSalesBillList } from '../sales-export';
const actor = { id: 'sales-a', role: Role.SALES };
const item = (i: number) => ({ id: `item-${i}`, orderNoSnapshot: `ORDER-${i}`, workOrderVersionSnapshot: 1, orderStatusSnapshot: 'SETTLED', settledAtSnapshot: new Date('2026-08-01T00:00:00Z'), settledFeeSnapshot: '0.10', order: { customName: '现在改名' }, settlementDetailSnapshot: { schemaVersion: 1, orderName: `历史名称${i}`, processingAmount: '0.10', charges: [] } });
beforeEach(() => { findMany.mockReset().mockResolvedValue([]); findFirst.mockReset().mockResolvedValue({ period: '2026-08', status: 'DRAFT', items: Array.from({ length: 65 }, (_, i) => item(i)) }); });

it('exports all filtered owned bills and ignores pagination/forged account scope', async () => {
  findMany.mockResolvedValue(Array.from({ length: 65 }, () => ({ period: '2026-08', status: 'DRAFT', memberSubtotal: '100.10', adjustmentAmount: '-0.10', totalAmount: '100.00', _count: { items: 2 } })));
  const result = await exportSalesBillList(actor, new URLSearchParams('period=2026-08&status=DRAFT&page=3&agentUserId=foreign'));
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { period: '2026-08', status: 'DRAFT', agentUserId: actor.id } }));
  expect(findMany.mock.calls[0][0]).not.toHaveProperty('skip');
  expect(result.csv.split('\r\n')).toHaveLength(67);
  expect(result.csv).toContain('"100.10","-0.10","100.00"');
  expect(result.csv).toContain('暂计，金额未定稿');
});
it.each(['period=2026-99', 'status=INVALID'])('rejects invalid filter %s before reading', async (query) => {
  await expect(exportSalesBillList(actor, new URLSearchParams(query))).rejects.toThrow();
  expect(findMany).not.toHaveBeenCalled();
});
it('exports every owned member, with the same frozen name search as the page', async () => {
  const all = await exportSalesBillItems(actor, 'bill-a', new URLSearchParams('page=3&agentUserId=foreign'));
  expect(all.csv.split('\r\n')).toHaveLength(67);
  expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'bill-a', agentUserId: actor.id });
  const selected = await exportSalesBillItems(actor, 'bill-a', new URLSearchParams('q=历史名称64'));
  expect(selected.csv).toContain('ORDER-64');
  expect(selected.csv).not.toContain('ORDER-63');
  const renamed = await exportSalesBillItems(actor, 'bill-a', new URLSearchParams('q=现在改名'));
  expect(renamed.csv.split('\r\n')).toHaveLength(2);
});
it('does not substitute current prices or expose private fields', async () => {
  findFirst.mockResolvedValue({ period: '2026-08', status: 'CONFIRMED', items: [{ ...item(1), settlementDetailSnapshot: null, order: { customName: '=SUM(A1)', total: 'PRIVATE-COST' }, reason: 'PRIVATE-REASON' }] });
  const result = await exportSalesBillItems(actor, 'bill-a', new URLSearchParams());
  expect(result.csv).toContain("'=SUM(A1)");
  expect(result.csv).toContain('当前名称');
  expect(result.csv).toContain('费用明细待补');
  expect(result.csv).not.toContain('PRIVATE');
});
it('exports fee evidence only when its frozen components equal the settled total', async () => {
  const detail = { schemaVersion: 1, orderName: '原工单名称', processingAmount: '60.00', charges: [{ description: '快递费', amount: '20.00' }, { description: '包装费', amount: '10.00' }] };
  findFirst.mockResolvedValue({ period: '2026-08', status: 'CONFIRMED', items: [{ ...item(1), settledFeeSnapshot: '90.00', settlementDetailSnapshot: detail }, { ...item(2), settledFeeSnapshot: '80.00', settlementDetailSnapshot: detail }] });
  const result = await exportSalesBillItems(actor, 'bill-a', new URLSearchParams());
  expect(result.csv).toContain('"90.00","60.00","快递费：20.00 元；包装费：10.00 元"');
  expect(result.csv).toContain('"80.00","","费用明细待补"');
});
it('fails closed for another account, invalid IDs, and non-sales roles', async () => {
  findFirst.mockResolvedValue(null);
  await expect(exportSalesBillItems(actor, 'foreign', new URLSearchParams())).rejects.toThrow();
  findFirst.mockClear();
  await expect(exportSalesBillItems(actor, '../bad', new URLSearchParams())).rejects.toThrow();
  await expect(exportSalesBillList({ id: 'admin', role: Role.ADMIN }, new URLSearchParams())).rejects.toThrow();
  expect(findFirst).not.toHaveBeenCalled(); expect(findMany).not.toHaveBeenCalled();
});
it('rejects an overlong search and does not silently truncate large exports', async () => {
  await expect(exportSalesBillItems(actor, 'bill-a', new URLSearchParams({ q: 'x'.repeat(101) }))).rejects.toThrow();
  expect(findFirst).not.toHaveBeenCalled();
  findMany.mockResolvedValue(Array.from({ length: 10_001 }, () => ({})));
  await expect(exportSalesBillList(actor, new URLSearchParams())).rejects.toThrow('10,000');
});

it('distinguishes cancellation fees and never exports unknown internal status codes', async () => {
  findFirst.mockResolvedValue({ period: '2026-08', status: 'CONFIRMED', items: [
    { ...item(1), orderStatusSnapshot: 'CANCELLED' },
    { ...item(2), orderStatusSnapshot: 'SECRET_STATUS' },
  ] });
  const { csv } = await exportSalesBillItems(actor, 'bill-a', new URLSearchParams());
  expect(csv).toContain('结算时状态');
  expect(csv).toContain('已取消（取消费）');
  expect(csv).toContain('未识别配置');
  expect(csv).not.toContain('SECRET_STATUS');
});
