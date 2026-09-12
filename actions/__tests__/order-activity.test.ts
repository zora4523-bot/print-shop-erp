import { beforeEach, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
const { permission, read } = vi.hoisted(() => ({ permission: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: permission }));
vi.mock('@/lib/order/activity', () => ({ readOrderActivity: read }));
import { loadOrderActivity } from '../order-activity';
const input = { orderId: 'order', cursor: { at: '2026-09-11T10:33:00.000Z', id: 'log' } };
beforeEach(() => { vi.clearAllMocks(); permission.mockResolvedValue({ id: 'admin', role: Role.ADMIN }); read.mockResolvedValue({ events: [], nextCursor: null }); });
it('checks authorization on every request before parsing or loading', async () => {
  permission.mockRejectedValue(new Error('denied'));
  await expect(loadOrderActivity(input)).rejects.toThrow('denied');
  expect(permission).toHaveBeenCalledWith('order:view:all'); expect(read).not.toHaveBeenCalled();
});
it('rejects invalid cursors without reading records', async () => {
  expect(await loadOrderActivity({ ...input, cursor: { at: 'yesterday', id: 'log' } })).toMatchObject({ ok: false });
  expect(read).not.toHaveBeenCalled();
});
it('returns no records for an inaccessible order', async () => {
  read.mockResolvedValue(null);
  expect(await loadOrderActivity(input)).toEqual({ ok: false, message: '工单不存在或无权访问' });
});
it('passes validated input and authenticated identity', async () => {
  expect(await loadOrderActivity(input)).toMatchObject({ ok: true });
  expect(read).toHaveBeenCalledWith('order', { id: 'admin', role: Role.ADMIN }, input.cursor);
});
