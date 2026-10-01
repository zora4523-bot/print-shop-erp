import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(), revalidatePath: vi.fn(), markPrinted: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/lib/order/print-jobs', () => ({
  markCurrentVersionPrinted: mocks.markPrinted,
  OrderPrintJobError: class OrderPrintJobError extends Error {
    constructor(readonly code: string, message: string) { super(message); }
  },
}));

import { OrderPrintJobError } from '@/lib/order/print-jobs';
import { recordOrderPrintedAction } from '../order-print-record';

const admin = { id: 'admin-1', role: 'ADMIN' };

// 业主 2026-10-02：点「打印」即记已打印——打印页关闭打印对话框后调用。
describe('recordOrderPrintedAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requirePermission.mockResolvedValue(admin);
    mocks.markPrinted.mockResolvedValue({ marked: true });
  });

  it('checks the workflow permission before reading input, then records the rendered version', async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error('FORBIDDEN'));
    await expect(recordOrderPrintedAction({ orderId: 'order-1', workOrderVersion: 2 })).rejects.toThrow('FORBIDDEN');
    expect(mocks.markPrinted).not.toHaveBeenCalled();

    await expect(recordOrderPrintedAction({ orderId: 'order-1', workOrderVersion: 2 }))
      .resolves.toEqual({ status: 'success', marked: true });
    expect(mocks.requirePermission).toHaveBeenLastCalledWith('order:change:review');
    expect(mocks.markPrinted).toHaveBeenCalledWith({ orderId: 'order-1', workOrderVersion: 2 }, admin);
    expect(mocks.revalidatePath.mock.calls).toEqual([['/orders'], ['/orders/order-1']]);
  });

  it('does not revalidate when nothing was pending for that version', async () => {
    mocks.markPrinted.mockResolvedValue({ marked: false });
    await expect(recordOrderPrintedAction({ orderId: 'order-1', workOrderVersion: 2 }))
      .resolves.toEqual({ status: 'success', marked: false });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['missing version', { orderId: 'order-1' }],
    ['non-integer version', { orderId: 'order-1', workOrderVersion: 1.5 }],
    ['extra fields', { orderId: 'order-1', workOrderVersion: 1, state: 'PRINTED' }],
    ['blank order', { orderId: ' ', workOrderVersion: 1 }],
  ])('rejects %s without writing', async (_label, input) => {
    await expect(recordOrderPrintedAction(input)).resolves.toEqual({ status: 'error', message: '打印记录参数无效' });
    expect(mocks.markPrinted).not.toHaveBeenCalled();
  });

  it('reports known print-job conflicts and rethrows unknown failures', async () => {
    mocks.markPrinted.mockRejectedValueOnce(new OrderPrintJobError('IDEMPOTENCY_CONFLICT', '打印任务已变化'));
    await expect(recordOrderPrintedAction({ orderId: 'order-1', workOrderVersion: 2 }))
      .resolves.toEqual({ status: 'error', message: '打印任务已变化' });
    mocks.markPrinted.mockRejectedValueOnce(new Error('database down'));
    await expect(recordOrderPrintedAction({ orderId: 'order-1', workOrderVersion: 2 })).rejects.toThrow('database down');
  });
});
