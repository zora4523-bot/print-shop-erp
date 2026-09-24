import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
const { order, logs } = vi.hoisted(() => ({ order: vi.fn(), logs: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { order: { findFirst: order }, orderLog: { findMany: logs } } }));
import { readOrderActivity } from '../activity';
const admin = { id: 'admin', role: Role.ADMIN };
beforeEach(() => { vi.clearAllMocks(); order.mockResolvedValue({ id: 'order' }); logs.mockResolvedValue([]); });
describe('admin activity access and pagination', () => {
  it.each([Role.SALES, Role.WORKER])('rejects %s before querying commercial audit records', async role => {
    expect(await readOrderActivity('order', { id: 'user', role })).toBeNull();
    expect(order).not.toHaveBeenCalled(); expect(logs).not.toHaveBeenCalled();
  });
  it('does not read logs when the order is missing or inaccessible', async () => {
    order.mockResolvedValue(null);
    expect(await readOrderActivity('missing', admin)).toBeNull(); expect(logs).not.toHaveBeenCalled();
  });
  it('uses stable time/id keyset boundaries and a 21st-row sentinel', async () => {
    const at = new Date('2026-09-11T10:33:00Z');
    logs.mockResolvedValue(Array.from({ length: 21 }, (_, index) => ({ id: `log-${99-index}`, createdAt: at, action: 'ORDER_PLATE_DETAIL_CREATED', remark: '制版 · 12 元', changedFields: {}, operator: { displayName: '管理员', role: Role.ADMIN } })));
    const cursor = { at: at.toISOString(), id: 'log-999' };
    const result = await readOrderActivity('order', admin, cursor);
    expect(logs).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId: 'order', OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: 'log-999' } }] }, take: 21, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
    expect(result?.events).toHaveLength(20);
    expect(result?.events[0]).toMatchObject({ date: '2026/09/11', time: '18:33', actor: '管理员', title: '新增制版明细' });
    expect(result?.nextCursor).toEqual({ at: at.toISOString(), id: 'log-80' });
  });
  it('ends pagination when fewer than 21 rows remain', async () => {
    expect((await readOrderActivity('order', admin))?.nextCursor).toBeNull();
  });
});
