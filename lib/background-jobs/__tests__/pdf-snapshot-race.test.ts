import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../../generated/prisma/enums';
import type { PrintOrder } from '../../order/print-types';
import type { ClaimedBackgroundJob } from '../types';
import { orderPdfSnapshotKey } from '../../pdf/order-snapshot';
const mocks = vi.hoisted(() => ({ user: vi.fn(), order: vi.fn(), write: vi.fn(), render: vi.fn() }));
vi.mock('../../db', () => ({ db: { user: { findUnique: mocks.user } } }));
vi.mock('../repository', () => ({ enqueueBackgroundJob: vi.fn() }));
vi.mock('../../order/print-view', () => ({ getOrderForPrint: mocks.order }));
vi.mock('../../settings', () => ({ getSetting: async () => ({ name: '工厂' }) }));
vi.mock('../../order/print-html', () => ({ buildPrintHtml: async () => '<html></html>' }));
vi.mock('../../pdf/render', () => ({ renderHtmlToPdf: mocks.render }));
vi.mock('../../pdf/artifacts', () => ({ writePdfArtifact: mocks.write, cleanupOldPdfArtifacts: vi.fn(), readPdfArtifact: vi.fn() }));
import { handleOrderPdfJob } from '../pdf';
const order = { id: 'order-1', orderNo: 'GD-1', workOrderVersion: 3, items: [] } as unknown as PrintOrder;
function job(): ClaimedBackgroundJob {
  return { id: 'job-1', type: 'ORDER_PDF', queue: 'HEAVY', dedupeKey: 'test', maxAttempts: 2, workerId: 'worker-1', claimedAt: new Date('2026-09-11T00:00:00Z'), attempts: 1, payload: { orderId: order.id, expectedWorkOrderVersion: 3, baseUrl: 'https://erp.example.com', actor: { id: 'admin-1', role: Role.ADMIN }, snapshotKey: orderPdfSnapshotKey(order, '工厂') } };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ role: Role.ADMIN, isActive: true });
  mocks.order.mockResolvedValue(order);
  mocks.render.mockResolvedValue(Buffer.from('%PDF-test'));
});
describe('PDF worker race boundaries', () => {
  it('stores the verified snapshot once', async () => {
    await expect(handleOrderPdfJob(job())).resolves.toMatchObject({ artifactName: 'job-1-1.pdf', workOrderVersion: 3 });
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith('job-1-1.pdf', Buffer.from('%PDF-test'));
  });
  it.each(['revoked', 'role', 'version', 'content'])('does not publish bytes when %s changes during rendering', async (change) => {
    if (change === 'revoked') mocks.user.mockResolvedValueOnce({ role: Role.ADMIN, isActive: true }).mockResolvedValueOnce({ role: Role.ADMIN, isActive: false });
    if (change === 'role') mocks.user.mockResolvedValueOnce({ role: Role.ADMIN, isActive: true }).mockResolvedValueOnce({ role: Role.SALES, isActive: true });
    if (change === 'version') mocks.order.mockResolvedValueOnce(order).mockResolvedValueOnce({ ...order, workOrderVersion: 4 });
    if (change === 'content') mocks.order.mockResolvedValueOnce(order).mockResolvedValueOnce({ ...order, customName: 'changed' });
    await expect(handleOrderPdfJob(job())).rejects.toThrow();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('checks a lost lease before publishing bytes', async () => {
    const lease = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('lease lost'));
    await expect(handleOrderPdfJob({ ...job(), assertLease: lease })).rejects.toThrow('lease lost');
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
