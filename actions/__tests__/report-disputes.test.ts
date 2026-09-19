import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), create: vi.fn(), review: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }));
vi.mock('@/lib/production/report-dispute', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/production/report-dispute')>();
  return { ...original, createReportDispute: mocks.create, reviewReportDispute: mocks.review };
});
import { createReportDisputeAction, reviewReportDisputeAction } from '../report-disputes';
beforeEach(() => { vi.clearAllMocks(); mocks.permission.mockResolvedValue({ id: 'actor', role: 'WORKER' }); });
it('requires create permission, validates input and refreshes only related paths', async () => {
  const form = new FormData(); form.set('reason', '请核对装版金额');
  mocks.create.mockResolvedValue({ reportId: 'report', orderId: 'order', operationId: 'op' });
  expect((await createReportDisputeAction('report', null, form)).status).toBe('success');
  expect(mocks.permission).toHaveBeenCalledWith('task:dispute:create');
  expect(mocks.refresh).toHaveBeenCalledWith('/worker/reports/report');
  expect(mocks.refresh).toHaveBeenCalledWith('/orders/order');
});
it('rejects missing reason before write', async () => {
  expect((await createReportDisputeAction('report', null, new FormData())).status).toBe('error');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('requires review permission before any write', async () => {
  mocks.permission.mockRejectedValue(new Error('forbidden'));
  await expect(reviewReportDisputeAction('report', null, new FormData())).rejects.toThrow('forbidden');
  expect(mocks.review).not.toHaveBeenCalled();
});
