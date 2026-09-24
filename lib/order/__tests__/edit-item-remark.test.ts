import { beforeEach, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  tx: { $executeRaw: vi.fn(), order: { findUnique: vi.fn(), update: vi.fn() },
    orderItem: { findFirst: vi.fn(), update: vi.fn() }, orderLog: { create: vi.fn() } },
}));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
import { editItemRemark } from '../edit-item-remark';

const input = { orderId: 'order', itemId: 'item', expectedEditVersion: 3, remark: '新备注' };
const actor = { id: 'admin', role: Role.ADMIN };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((work) => work(mocks.tx));
  mocks.tx.order.findUnique.mockResolvedValue({ submitterId: 'cs', status: 'DRAFT', editVersion: 3, _count: { changeRequests: 0 } });
  mocks.tx.orderItem.findFirst.mockResolvedValue({ remark: '旧备注', sequence: 2 });
});
it('saves only the remark and audits as ADMIN', async () => {
  expect(await editItemRemark(input, actor)).toBe(true);
  expect(mocks.tx.orderItem.findFirst).toHaveBeenCalledWith({ where: { id: 'item', orderId: 'order' }, select: { remark: true, sequence: true } });
  expect(mocks.tx.orderItem.update).toHaveBeenCalledWith({ where: { id: 'item' }, data: { remark: '新备注' } });
  expect(mocks.tx.order.update).toHaveBeenCalledWith({ where: { id: 'order' }, data: { revision: { increment: 1 }, editVersion: { increment: 1 } } });
  expect(mocks.tx.orderLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    changedFields: { itemRemark: { itemId: 'item', before: '旧备注', after: '新备注' } },
  }) });
});
it('clears optional remark and ignores an unchanged value', async () => {
  await editItemRemark({ ...input, remark: '   ' }, actor);
  expect(mocks.tx.orderItem.update).toHaveBeenCalledWith({ where: { id: 'item' }, data: { remark: null } });
  vi.clearAllMocks();
  expect(await editItemRemark({ ...input, remark: ' 旧备注 ' }, actor)).toBe(false);
  expect(mocks.tx.order.update).not.toHaveBeenCalled();
  expect(mocks.tx.orderLog.create).not.toHaveBeenCalled();
});
it('normalizes browser form line endings before persisting', async () => {
  await editItemRemark({ ...input, remark: ' 第一行\r\n第二行\r第三行 ' }, actor);
  expect(mocks.tx.orderItem.update).toHaveBeenCalledWith({ where: { id: 'item' }, data: { remark: '第一行\n第二行\n第三行' } });
});
it.each([{ status: 'SETTLED' }, { status: 'SHIPPED' }, { editVersion: 4 }, { _count: { changeRequests: 1 } }])('rejects unavailable order %j without writes', async (override) => {
  mocks.tx.order.findUnique.mockResolvedValue({ submitterId: 'cs', status: 'DRAFT', editVersion: 3, _count: { changeRequests: 0 }, ...override });
  await expect(editItemRemark(input, actor)).rejects.toThrow();
  expect(mocks.tx.orderItem.update).not.toHaveBeenCalled();
});
it('rejects another order item', async () => {
  mocks.tx.orderItem.findFirst.mockResolvedValue(null);
  await expect(editItemRemark(input, actor)).rejects.toThrow('不属于');
  expect(mocks.tx.orderItem.update).not.toHaveBeenCalled();
});
it.each([Role.SALES, Role.WORKER])('rejects unauthorized role %s before database access', async (role) => {
  await expect(editItemRemark(input, { ...actor, role })).rejects.toThrow('当前账号');
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it.each([{ remark: '字'.repeat(1001) }, { unitPrice: '1' }, { expectedEditVersion: -1 }])('rejects invalid fields %j before database access', async (override) => {
  await expect(editItemRemark({ ...input, ...override }, actor)).rejects.toThrow();
  expect(mocks.transaction).not.toHaveBeenCalled();
});
