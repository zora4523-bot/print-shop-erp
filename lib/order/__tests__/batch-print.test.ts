import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { ClaimedBackgroundJob } from '@/lib/background-jobs/types';
const m = vi.hoisted(() => ({
  user: vi.fn(), find: vi.fn(), update: vi.fn(), worker: vi.fn(), order: vi.fn(),
  enqueue: vi.fn(), html: vi.fn(), render: vi.fn(), write: vi.fn(), read: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: { user: { findUnique: m.user }, backgroundJob: { findUnique: m.find, updateMany: m.update }, backgroundWorkerHeartbeat: { findFirst: m.worker } } }));
vi.mock('@/lib/background-jobs/repository', () => ({ enqueueBackgroundJob: m.enqueue, BackgroundJobLeaseLostError: class extends Error {} }));
vi.mock('@/lib/background-jobs/clock', () => ({ databaseNow: async () => new Date('2026-09-13') }));
vi.mock('@/lib/order/print-view', () => ({ getOrderForPrint: m.order }));
vi.mock('@/lib/order/print-html', () => ({ buildPrintHtml: m.html }));
vi.mock('@/lib/settings', () => ({ getSetting: async () => ({ name: 'Factory' }) }));
vi.mock('@/lib/pdf/render', () => ({ renderHtmlToPdf: m.render }));
vi.mock('@/lib/pdf/artifacts', () => ({ readPdfArtifact: m.read, writePdfArtifact: m.write, cleanupOldPdfArtifacts: vi.fn() }));
vi.mock('@/lib/pdf/order-snapshot', () => ({ orderPdfSnapshotKey: (order: { id: string; version: number }) => `${order.id}:${order.version}` }));
import { BatchPrintAccessError, BatchPrintSelectionError, requestBatchPrint, handleBatchPrintJob, batchPrintStatus, downloadBatchPrint } from '../batch-print';
const payload = { actorId: 'admin', baseUrl: 'https://example.test', orders: [{ id: 'a', key: 'a:1' }, { id: 'b', key: 'b:1' }] };
const job = { id: 'j', type: 'ORDER_BATCH_PDF', payload, workerId: 'worker', attempts: 1, assertLease: vi.fn() } as unknown as ClaimedBackgroundJob;

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ isActive: true, role: 'ADMIN' });
  m.order.mockImplementation(async (id: string) => ({ id, version: 1 }));
  m.enqueue.mockResolvedValue({ job: { id: 'j' } });
  m.update.mockResolvedValue({ count: 1 });
  m.worker.mockResolvedValue({ workerId: 'w' });
  m.html.mockImplementation(async (order: { id: string }) => order.id);
  m.render.mockImplementation(async ({ html }: { html: string }) => {
    const doc = await PDFDocument.create(); doc.addPage(html === 'a' ? [100, 200] : [300, 400]);
    return Buffer.from(await doc.save());
  });
  m.find.mockResolvedValue({ ...job, status: 'PENDING', result: null });
  m.read.mockResolvedValue(Buffer.from('pdf'));
});

describe('batch PDF invariants', () => {
  it('rejects non-admins and inactive accounts before reading any orders', async () => {
    m.user.mockResolvedValue({ isActive: true, role: 'SALES' });
    await expect(requestBatchPrint('a', {}, 'https://example.test')).rejects.toBeInstanceOf(BatchPrintAccessError);
    m.user.mockResolvedValue({ isActive: false, role: 'ADMIN' });
    await expect(requestBatchPrint('a', {}, 'https://example.test')).rejects.toBeInstanceOf(BatchPrintAccessError);
    expect(m.order).not.toHaveBeenCalled();
  });
  it.each([[], ['a', 'a'], Array.from({ length: 51 }, (_, i) => String(i))])('rejects invalid selection %j', async (orderIds) => {
    await expect(requestBatchPrint('admin', { requestId: crypto.randomUUID(), orderIds }, 'https://example.test')).rejects.toThrow();
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it('retains selected order and deduplicates the same request', async () => {
    const input = { requestId: crypto.randomUUID(), orderIds: ['b', 'a'] };
    await requestBatchPrint('admin', input, payload.baseUrl);
    await requestBatchPrint('admin', input, payload.baseUrl);
    const [first] = m.enqueue.mock.calls[0];
    expect(first.payload.orders).toEqual([{ id: 'b', key: 'b:1' }, { id: 'a', key: 'a:1' }]);
    expect(first.dedupeKey).toBe(m.enqueue.mock.calls[1][0].dedupeKey);
  });
  it('does not queue a partial selection', async () => {
    m.order.mockResolvedValue(null);
    await expect(requestBatchPrint('admin', { requestId: crypto.randomUUID(), orderIds: ['a', 'b'] }, payload.baseUrl)).rejects.toMatchObject({ issues: [{ position: 1, message: expect.any(String) }, { position: 2, message: expect.any(String) }] });
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it('merges real PDFs in selection order with fenced progress', async () => {
    const result = await handleBatchPrintJob(job);
    expect(result).toMatchObject({ completed: 2, artifactName: 'j-1.pdf', issues: [] });
    const merged = await PDFDocument.load(m.write.mock.calls[0][1]);
    expect(merged.getPages().map((page) => page.getSize())).toEqual([{ width: 100, height: 200 }, { width: 300, height: 400 }]);
    expect(m.update.mock.calls.map(([call]) => call.data.result.completed)).toEqual([0, 1, 2]);
    expect(m.update.mock.calls[0][0].where).toMatchObject({ lockedBy: 'worker', attempts: 1, status: 'RUNNING' });
  });
  it('reports the failing order and never publishes a partial PDF', async () => {
    m.render.mockRejectedValueOnce(new Error('private rendering path'));
    expect(await handleBatchPrintJob(job)).toMatchObject({ completed: 0, issues: [{ position: 1, message: expect.not.stringContaining('private') }] });
    expect(m.write).not.toHaveBeenCalled();
  });
  it('rejects content changes during rendering', async () => {
    m.order.mockResolvedValueOnce({ id: 'a', version: 1 }).mockResolvedValueOnce({ id: 'b', version: 1 }).mockResolvedValue({ id: 'a', version: 2 });
    expect(await handleBatchPrintJob(job)).toMatchObject({ issues: expect.arrayContaining([{ position: 1, message: expect.any(String) }]) });
    expect(m.write).not.toHaveBeenCalled();
  });
  it('losing a lease prevents generation', async () => {
    m.update.mockResolvedValue({ count: 0 });
    await expect(handleBatchPrintJob(job)).rejects.toThrow();
    expect(m.render).not.toHaveBeenCalled();
  });
  it('does not expose another actor’s task', async () => {
    await expect(batchPrintStatus('other', 'j')).rejects.toBeInstanceOf(BatchPrintAccessError);
    await expect(downloadBatchPrint('other', 'j')).rejects.toBeInstanceOf(BatchPrintAccessError);
  });
  it('reports worker unavailability and resumes existing progress', async () => {
    m.worker.mockResolvedValue(null);
    expect(await batchPrintStatus('admin', 'j')).toMatchObject({ status: 'unavailable', total: 2 });
    m.worker.mockResolvedValue({ workerId: 'w' });
    expect(await batchPrintStatus('admin', 'j')).toMatchObject({ status: 'pending' });
  });
  it('rechecks contents even after reading the finished artifact', async () => {
    m.find.mockResolvedValue({ ...job, status: 'SUCCEEDED', result: { completed: 2, issues: [], artifactName: 'j.pdf' } });
    m.order.mockResolvedValueOnce({ id: 'a', version: 1 }).mockResolvedValueOnce({ id: 'b', version: 1 }).mockResolvedValue({ id: 'a', version: 2 });
    await expect(downloadBatchPrint('admin', 'j')).rejects.toBeInstanceOf(BatchPrintSelectionError);
    expect(m.read).toHaveBeenCalledOnce();
  });
  it('never downloads a partially failed result', async () => {
    m.find.mockResolvedValue({ ...job, status: 'SUCCEEDED', result: { completed: 1, issues: [{ position: 2, message: 'failed' }], artifactName: 'j.pdf' } });
    expect(await downloadBatchPrint('admin', 'j')).toBeNull();
    expect(m.read).not.toHaveBeenCalled();
  });
});
