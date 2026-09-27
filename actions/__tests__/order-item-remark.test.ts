import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ permission: vi.fn(), edit: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/order/edit-item-remark', async (original) => ({
  ...await original<typeof import('@/lib/order/edit-item-remark')>(), editItemRemark: mocks.edit,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));
import { editItemRemarkAction } from '../order-item-remark';
import { EditItemRemarkError } from '@/lib/order/edit-item-remark';

function form(version = '3') {
  const data = new FormData();
  data.set('expectedEditVersion', version);
  data.set('remark', '新备注');
  return data;
}
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({ id: 'admin', role: 'ADMIN' }); });
it('requires permission before mutation and refreshes only related pages', async () => {
  expect(await editItemRemarkAction('order', 'item', null, form())).toEqual({ status: 'success' });
  expect(mocks.permission).toHaveBeenCalledWith('order:create');
  expect(mocks.edit).toHaveBeenCalledWith({ orderId: 'order', itemId: 'item', expectedEditVersion: 3, remark: '新备注' }, { id: 'admin', role: 'ADMIN' });
  expect(mocks.revalidate.mock.calls).toEqual([['/orders'], ['/orders/order'], ['/orders/order/edit']]);
});
it('rejects permission before reading or changing order', async () => {
  mocks.permission.mockRejectedValue(new Error('denied'));
  await expect(editItemRemarkAction('order', 'item', null, form())).rejects.toThrow('denied');
  expect(mocks.edit).not.toHaveBeenCalled();
});
it.each(['', '-1', '3.5', '3x'])('returns structured errors for invalid version %s', async (version) => {
  expect(await editItemRemarkAction('order', 'item', null, form(version))).toMatchObject({ status: 'invalid', fieldErrors: { expectedEditVersion: expect.any(Array) } });
  expect(mocks.edit).not.toHaveBeenCalled();
});
it('keeps domain conflicts local and does not refresh on failure', async () => {
  mocks.edit.mockRejectedValue(new EditItemRemarkError('工单已更新，请刷新后重新填写'));
  expect(await editItemRemarkAction('order', 'item', null, form())).toEqual({ status: 'error', message: '工单已更新，请刷新后重新填写' });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
