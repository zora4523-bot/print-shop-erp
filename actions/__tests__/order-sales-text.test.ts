import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ permission: vi.fn(), edit: vi.fn(), revalidate: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: m.permission }));
vi.mock('@/lib/order/edit-sales-text', async (original) => {
  const actual = await original<typeof import('@/lib/order/edit-sales-text')>();
  return { ...actual, editSalesOrderText: m.edit };
});
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));
import { editSalesTextAction } from '../order-sales-text';
import { SalesTextEditError } from '@/lib/order/edit-sales-text';
const data = (version = '2') => { const form = new FormData(); form.set('expectedEditVersion', version); form.set('value', '文字'); return form; };
beforeEach(() => { vi.resetAllMocks(); m.permission.mockResolvedValue({ id: 'sales', role: 'SALES' }); m.edit.mockResolvedValue(true); });
it('requires permission before mutation and refreshes all sales views', async () => {
  expect(await editSalesTextAction('order', 'item', 'itemName', null, data())).toEqual({ saved: true, changed: true });
  expect(m.permission).toHaveBeenCalledWith('order:create');
  expect(m.edit).toHaveBeenCalledWith({ orderId: 'order', targetId: 'item', field: 'itemName', expectedEditVersion: 2, value: '文字' }, { id: 'sales', role: 'SALES' });
  expect(m.revalidate.mock.calls).toEqual([['/orders'], ['/orders/order'], ['/orders/order/edit']]);
});
it.each(['', '-1', '2x', '1.5', '99999999999999999999'])('rejects invalid version %s', async (version) => {
  expect(await editSalesTextAction('order', 'item', 'itemName', null, data(version))).toHaveProperty('error');
  expect(m.edit).not.toHaveBeenCalled();
});
it('does not mutate when permission fails', async () => {
  m.permission.mockRejectedValue(new Error('Forbidden'));
  await expect(editSalesTextAction('order', 'item', 'itemName', null, data())).rejects.toThrow('Forbidden');
  expect(m.edit).not.toHaveBeenCalled();
});
it('preserves recoverable error and releases unchanged saves', async () => {
  m.edit.mockRejectedValueOnce(new SalesTextEditError('版本冲突'));
  expect(await editSalesTextAction('order', 'item', 'itemName', null, data())).toEqual({ error: '版本冲突' });
  expect(m.revalidate).not.toHaveBeenCalled();
  m.edit.mockResolvedValue(false);
  expect(await editSalesTextAction('order', 'item', 'itemName', null, data())).toEqual({ saved: true, changed: false });
});
