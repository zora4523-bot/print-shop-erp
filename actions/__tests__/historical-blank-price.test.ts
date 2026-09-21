import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), confirm: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/order/confirm-historical-blank-price', () => ({ confirmHistoricalBlankPrice: mocks.confirm, HistoricalBlankPriceError: class extends Error {} }));
import { confirmHistoricalBlankPriceAction } from '../historical-blank-price';
const command = { orderId: 'order', itemId: 'item', expectedOrderRevision: 1, expectedPriceRevision: 2, unitPrice: '0.12', reason: '已核对' };
beforeEach(() => { vi.clearAllMocks(); mocks.permission.mockResolvedValue({ id: 'admin', role: 'ADMIN' }); mocks.confirm.mockResolvedValue({ orderId: 'order', priceRevision: 3 }); });
it('checks price confirmation permission before accepting a command', async () => {
  await expect(confirmHistoricalBlankPriceAction(command)).resolves.toEqual({ status: 'success' });
  expect(mocks.permission).toHaveBeenCalledWith('order:price:confirm');
  expect(mocks.confirm).toHaveBeenCalledWith(command, { id: 'admin', role: 'ADMIN' });
  expect(mocks.revalidate).toHaveBeenCalledWith('/orders/order');
});
it('does not call the domain service when permission is denied', async () => {
  mocks.permission.mockRejectedValue(new Error('Forbidden'));
  await expect(confirmHistoricalBlankPriceAction(command)).rejects.toThrow('Forbidden');
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it('rejects missing reason and client-supplied authority fields', async () => {
  await expect(confirmHistoricalBlankPriceAction({ ...command, reason: '' })).resolves.toMatchObject({ status: 'error' });
  await expect(confirmHistoricalBlankPriceAction({ ...command, historical: true })).resolves.toMatchObject({ status: 'error' });
  expect(mocks.confirm).not.toHaveBeenCalled();
});
