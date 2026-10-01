import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(), revalidatePath: vi.fn(), recordRenderedPrint: vi.fn(), recordBatchPrint: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/lib/order/print-jobs', () => ({
  recordRenderedPrint: mocks.recordRenderedPrint,
  OrderPrintJobError: class OrderPrintJobError extends Error {
    constructor(readonly code: string, message: string) { super(message); }
  },
}));
vi.mock('@/lib/order/batch-print', () => ({
  recordBatchPrint: mocks.recordBatchPrint,
  BatchPrintAccessError: class BatchPrintAccessError extends Error {},
  BatchPrintSelectionError: class BatchPrintSelectionError extends Error {},
}));

import { OrderPrintJobError } from '@/lib/order/print-jobs';
import { BatchPrintAccessError, BatchPrintSelectionError } from '@/lib/order/batch-print';
import { recordBatchPrintAction, recordOrderPrintedAction } from '../order-print-record';

const admin = { id: 'admin-1', role: 'ADMIN' };
const rendered = { orderId: 'order-1', workOrderVersion: 2, revision: 6 };

// 业主 2026-10-02：点「打印」即记已打印——打印页关闭打印对话框、打开或下载批量打印文件时调用。
describe('recordOrderPrintedAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requirePermission.mockResolvedValue(admin);
    mocks.recordRenderedPrint.mockResolvedValue('MARKED');
  });

  it('checks the workflow permission before reading input, then records the rendered content', async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error('FORBIDDEN'));
    await expect(recordOrderPrintedAction(rendered)).rejects.toThrow('FORBIDDEN');
    expect(mocks.recordRenderedPrint).not.toHaveBeenCalled();

    await expect(recordOrderPrintedAction(rendered)).resolves.toEqual({ status: 'success', outcome: 'MARKED' });
    expect(mocks.requirePermission).toHaveBeenLastCalledWith('order:change:review');
    expect(mocks.recordRenderedPrint).toHaveBeenCalledWith(rendered, admin);
    expect(mocks.revalidatePath.mock.calls).toEqual([['/orders'], ['/orders/order-1']]);
  });

  it.each(['ALREADY_PRINTED', 'STALE', 'NOT_PRINTABLE'])('returns %s without revalidating', async (outcome) => {
    mocks.recordRenderedPrint.mockResolvedValue(outcome);
    await expect(recordOrderPrintedAction(rendered)).resolves.toEqual({ status: 'success', outcome });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['missing revision', { orderId: 'order-1', workOrderVersion: 1 }],
    ['non-integer version', { ...rendered, workOrderVersion: 1.5 }],
    ['extra fields', { ...rendered, state: 'PRINTED' }],
    ['blank order', { ...rendered, orderId: ' ' }],
  ])('rejects %s without writing', async (_label, input) => {
    await expect(recordOrderPrintedAction(input)).resolves.toEqual({ status: 'error', message: '打印记录参数无效' });
    expect(mocks.recordRenderedPrint).not.toHaveBeenCalled();
  });

  it('reports known print-job errors and rethrows unknown failures', async () => {
    mocks.recordRenderedPrint.mockRejectedValueOnce(new OrderPrintJobError('ORDER_NOT_FOUND', '工单不存在'));
    await expect(recordOrderPrintedAction(rendered)).resolves.toEqual({ status: 'error', message: '工单不存在' });
    mocks.recordRenderedPrint.mockRejectedValueOnce(new Error('database down'));
    await expect(recordOrderPrintedAction(rendered)).rejects.toThrow('database down');
  });
});

describe('recordBatchPrintAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requirePermission.mockResolvedValue(admin);
    mocks.recordBatchPrint.mockResolvedValue({ marked: 2 });
  });

  it('checks permission first, records the whole file and revalidates the list', async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error('FORBIDDEN'));
    await expect(recordBatchPrintAction('job_1')).rejects.toThrow('FORBIDDEN');
    expect(mocks.recordBatchPrint).not.toHaveBeenCalled();
    await expect(recordBatchPrintAction('job_1')).resolves.toEqual({ status: 'success', marked: 2 });
    expect(mocks.requirePermission).toHaveBeenLastCalledWith('order:change:review');
    expect(mocks.recordBatchPrint).toHaveBeenCalledWith('admin-1', 'job_1');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/orders');
  });

  it('rejects a malformed job id without touching the file', async () => {
    await expect(recordBatchPrintAction('../x')).resolves.toEqual({ status: 'error', message: '打印任务无效' });
    expect(mocks.recordBatchPrint).not.toHaveBeenCalled();
  });

  it.each([
    [null, '打印文件尚未就绪'],
    [new BatchPrintAccessError(), '打印任务不存在或无权访问'],
    [new BatchPrintSelectionError([]), '工单内容已变化，请重新选择并生成'],
    [new OrderPrintJobError('ORDER_NOT_FOUND', '工单不存在'), '工单不存在'],
  ])('maps %s to a visible error', async (failure, message) => {
    if (failure === null) mocks.recordBatchPrint.mockResolvedValue(null);
    else mocks.recordBatchPrint.mockRejectedValue(failure);
    await expect(recordBatchPrintAction('job_1')).resolves.toEqual({ status: 'error', message });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('rethrows unexpected failures', async () => {
    mocks.recordBatchPrint.mockRejectedValue(new Error('database down'));
    await expect(recordBatchPrintAction('job_1')).rejects.toThrow('database down');
  });
});
