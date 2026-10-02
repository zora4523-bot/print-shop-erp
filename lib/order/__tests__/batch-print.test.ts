import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { ClaimedBackgroundJob } from '@/lib/background-jobs/types';
const m = vi.hoisted(() => ({
  active: vi.fn(), user: vi.fn(), find: vi.fn(), update: vi.fn(), worker: vi.fn(), order: vi.fn(),
  enqueue: vi.fn(), html: vi.fn(), render: vi.fn(), write: vi.fn(), read: vi.fn(), available: vi.fn(), recordInTx: vi.fn(), transaction: vi.fn(), booked: vi.fn(), lock: vi.fn(), versions: vi.fn(),
}));
const tx = { $executeRaw: m.lock, orderPrintAttempt: { findMany: m.booked }, user: { findUnique: m.user }, order: { findMany: m.versions } };
vi.mock('@/lib/db', () => ({ db: { $transaction: m.transaction, orderPrintAttempt: { findMany: m.booked }, user: { findUnique: m.user }, backgroundJob: { findFirst: m.active, findUnique: m.find, updateMany: m.update }, backgroundWorkerHeartbeat: { findFirst: m.worker } } }));
vi.mock('@/lib/background-jobs/repository', () => ({ enqueueBackgroundJob: m.enqueue, BackgroundJobLeaseLostError: class extends Error {} }));
vi.mock('@/lib/background-jobs/clock', () => ({ databaseNow: async () => new Date('2026-09-13') }));
vi.mock('@/lib/order/print-view', () => ({ getOrderForPrint: m.order }));
vi.mock('@/lib/order/print-html', () => ({ buildPrintHtml: m.html }));
vi.mock('@/lib/settings', () => ({ getSetting: async () => ({ name: 'Factory' }) }));
vi.mock('@/lib/pdf/render', () => ({ renderHtmlToPdf: m.render }));
vi.mock('@/lib/pdf/artifacts', () => ({ readPdfArtifact: m.read, writePdfArtifact: m.write, cleanupOldPdfArtifacts: vi.fn(), assertPdfArtifactAvailable: m.available,
  PdfArtifactStorageError: class extends Error { constructor() { super('PDF artifact storage unavailable'); this.name = 'PdfArtifactStorageError'; } } }));
vi.mock('@/lib/pdf/order-snapshot', () => ({ orderPdfSnapshotKey: (order: { id: string; version: number }) => `${order.id}:${order.version}` }));
vi.mock('@/lib/order/print-jobs', () => ({ recordRenderedPrintInTx: m.recordInTx }));
import { createHash } from 'node:crypto';
import { BatchPrintAccessError, BatchPrintArtifactUnavailableError, BatchPrintSelectionError, requestBatchPrint, handleBatchPrintJob, batchPrintStatus, downloadBatchPrint, recordBatchPrint } from '../batch-print';
const payload = { actorId: 'admin', baseUrl: 'https://example.test', orders: [{ id: 'a', key: 'a:1' }, { id: 'b', key: 'b:1' }] };
const job = { id: 'j', type: 'ORDER_BATCH_PDF', payload, workerId: 'worker', attempts: 1, assertLease: vi.fn() } as unknown as ClaimedBackgroundJob;

beforeEach(() => {
  vi.resetAllMocks();
  m.active.mockResolvedValue(null);
  m.user.mockResolvedValue({ isActive: true, role: 'ADMIN' });
  m.order.mockImplementation(async (id: string) => ({ id, version: 1, workOrderVersion: 1 }));
  m.available.mockResolvedValue(undefined);
  m.booked.mockResolvedValue([]);
  m.recordInTx.mockImplementation(async (_tx: unknown, _attempt: unknown, _actor: unknown, contentIsCurrent: () => Promise<boolean>) =>
    (await contentIsCurrent()) ? 'MARKED' : 'STALE');
  m.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(tx));
  m.enqueue.mockResolvedValue({ job: { id: 'j' } });
  m.update.mockResolvedValue({ count: 1 });
  m.worker.mockResolvedValue({ workerId: 'w' });
  m.html.mockImplementation(async (order: { id: string }) => order.id);
  m.render.mockImplementation(async ({ html }: { html: string }) => {
    const doc = await PDFDocument.create(); doc.addPage(html === 'a' ? [100, 200] : [300, 400]);
    return Buffer.from(await doc.save());
  });
  m.find.mockResolvedValue({ ...job, status: 'PENDING', result: null });
  m.read.mockImplementation(async (name: string) => { if (name.startsWith('order-cache-')) throw new Error('missing'); return Buffer.from('pdf'); });
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
    const merged = await PDFDocument.load(m.write.mock.calls.find(([name]) => name === 'j-1.pdf')![1]);
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
    m.order.mockResolvedValueOnce({ id: 'a', version: 1 }).mockResolvedValue({ id: 'a', version: 2 });
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
  it('only counts HEAVY workers that can currently render PDFs, unless the job is already running', async () => {
    await batchPrintStatus('admin', 'j');
    expect(m.worker.mock.calls[0][0].where).toMatchObject({ queue: 'HEAVY', pdfReady: true, version: process.env.APP_VERSION || 'dev' });
    m.worker.mockResolvedValue(null);
    m.find.mockResolvedValue({ ...job, status: 'RUNNING', result: { completed: 1, issues: [] } });
    expect(await batchPrintStatus('admin', 'j')).toMatchObject({ status: 'pending', phase: 'rendering' });
  });
  it('rechecks contents even after reading the finished artifact', async () => {
    m.find.mockResolvedValue({ ...job, status: 'SUCCEEDED', result: { completed: 2, issues: [], artifactName: 'j.pdf' } });
    m.order.mockResolvedValueOnce({ id: 'a', version: 1 }).mockResolvedValueOnce({ id: 'b', version: 1 }).mockResolvedValue({ id: 'a', version: 2 });
    await expect(downloadBatchPrint('admin', 'j')).rejects.toBeInstanceOf(BatchPrintSelectionError);
    expect(m.read).toHaveBeenCalledOnce();
    expect(m.recordInTx).not.toHaveBeenCalled();
  });
  it('keeps the download itself read-only', async () => {
    m.find.mockResolvedValue({ ...job, status: 'SUCCEEDED', result: { completed: 2, issues: [], artifactName: 'j.pdf' } });
    expect(await downloadBatchPrint('admin', 'j')).toEqual(Buffer.from('pdf'));
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.recordInTx).not.toHaveBeenCalled();
  });
  it('never downloads a partially failed result', async () => {
    m.find.mockResolvedValue({ ...job, status: 'SUCCEEDED', result: { completed: 1, issues: [{ position: 2, message: 'failed' }], artifactName: 'j.pdf' } });
    expect(await downloadBatchPrint('admin', 'j')).toBeNull();
    expect(m.read).not.toHaveBeenCalled();
  });
});

it('coalesces different request IDs while the same content is running', async () => {
  m.active.mockResolvedValue({ id: 'running' });
  expect(await requestBatchPrint('admin', { requestId: crypto.randomUUID(), orderIds: ['a'] }, payload.baseUrl)).toBe('running');
  expect(m.enqueue).not.toHaveBeenCalled();
});
it('reuses cached single-order PDFs without rendering', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([100, 200]);
  m.read.mockResolvedValue(Buffer.from(await pdf.save()));
  expect(await handleBatchPrintJob(job)).toMatchObject({ completed: 2, issues: [] });
  expect(m.render).not.toHaveBeenCalled();
});
it('distinguishes queueing from merging', async () => {
  expect(await batchPrintStatus('admin', 'j')).toMatchObject({ phase: 'queued' });
  m.find.mockResolvedValue({ ...job, status: 'RUNNING', result: { completed: 2, issues: [] } });
  expect(await batchPrintStatus('admin', 'j')).toMatchObject({ phase: 'merging' });
});

it('reuses a completed valid batch without another job', async () => {
  m.find.mockResolvedValue({ id: 'done', status: 'SUCCEEDED', result: { completed: 1, issues: [], artifactName: 'done.pdf' } });
  expect(await requestBatchPrint('admin', { requestId: crypto.randomUUID(), orderIds: ['a'] }, payload.baseUrl)).toBe('done');
  expect(m.enqueue).not.toHaveBeenCalled();
});
it('regenerates an expired completed batch', async () => {
  m.find.mockResolvedValue({ id: 'done', status: 'SUCCEEDED', result: { completed: 1, issues: [], artifactName: 'done.pdf' } });
  m.read.mockRejectedValue(new Error('expired'));
  expect(await requestBatchPrint('admin', { requestId: crypto.randomUUID(), orderIds: ['a'] }, payload.baseUrl)).toBe('j');
  expect(m.enqueue).toHaveBeenCalledOnce();
});

it('does not cache or publish a PDF whose uploaded artwork failed', async () => {
  m.render.mockRejectedValue(Object.assign(new Error('private URL'), { name: 'PrintArtworkUnavailableError' }));
  expect(await handleBatchPrintJob(job)).toMatchObject({ issues: [{ position: 1, message: '图稿加载失败，请检查图稿后重试' }] });
  expect(m.write).not.toHaveBeenCalled();
});

it.each(['PdfBrowserUnavailableError', 'PdfArtifactStorageError', 'TargetCloseError'])(
  'rethrows PDF infrastructure failures (%s) so the durable job retries instead of reporting the order',
  async (name) => {
    m.render.mockRejectedValueOnce(Object.assign(new Error('infra'), { name }));
    await expect(handleBatchPrintJob(job)).rejects.toMatchObject({ name });
    expect(m.write).not.toHaveBeenCalled();
  },
);

it('classifies a raw cache write failure (ENOSPC) as storage infrastructure and rethrows it', async () => {
  m.write.mockRejectedValueOnce(Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }));
  await expect(handleBatchPrintJob(job)).rejects.toMatchObject({ name: 'PdfArtifactStorageError' });
});

// 业主 2026-10-02：打开或下载批量打印文件即记已打印——浏览器取得文件后由 Server Action 调用；
// 同一尝试串行，先查账本重放，首次记录才核对文件与内容，任一工单不符整批回滚。
describe('recordBatchPrint', () => {
  const ready = (orders = payload.orders) => m.find.mockResolvedValue({
    ...job, payload: { ...payload, orders }, status: 'SUCCEEDED', result: { completed: orders.length, issues: [], artifactName: 'j.pdf' },
  });
  const attemptOf = (jobId: string, attemptId: string) => createHash('sha256').update(`${jobId}:${attemptId}`).digest('hex').slice(0, 32);
  const key = (orderId: string, jobId = 'j', attemptId = 'attempt-1') => `batch-print:${attemptOf(jobId, attemptId)}:${orderId}`;
  const bookedAll = () => [
    { attemptKey: key('a'), orderId: 'a', outcome: 'MARKED' },
    { attemptKey: key('b'), orderId: 'b', outcome: 'ALREADY_PRINTED' },
  ];
  beforeEach(() => {
    m.versions.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, workOrderVersion: id === 'a' ? 3 : 1 })));
  });

  it('probes the file outside the transaction, then locks the attempt, re-checks the ledger and records each order once', async () => {
    ready([{ id: 'b', key: 'b:1' }, { id: 'a', key: 'a:1' }]);
    m.recordInTx.mockImplementationOnce(async (_tx: unknown, _attempt: unknown, _actor: unknown, check: () => Promise<boolean>) => (await check()) ? 'MARKED' : 'STALE')
      .mockImplementationOnce(async (_tx: unknown, _attempt: unknown, _actor: unknown, check: () => Promise<boolean>) => (await check()) ? 'ALREADY_PRINTED' : 'STALE');
    expect(await recordBatchPrint('admin', 'j', 'attempt-1')).toEqual({ marked: 1 });
    expect(m.available).toHaveBeenCalledWith('j.pdf');
    expect(m.available.mock.invocationCallOrder[0]).toBeLessThan(m.transaction.mock.invocationCallOrder[0]!);
    const sql = (m.lock.mock.calls[0]?.[0] as TemplateStringsArray).join('?');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(m.lock.mock.calls[0]?.[1]).toBe(`batch-print-attempt:${attemptOf('j', 'attempt-1')}`);
    // 锁前查一次、锁内再查一次账本。
    expect(m.booked).toHaveBeenCalledTimes(2);
    expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.booked.mock.invocationCallOrder[1]!);
    expect(m.read).not.toHaveBeenCalled();
    expect(m.recordInTx.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      [tx, { orderId: 'a', workOrderVersion: 3, attemptKey: key('a') }, { id: 'admin', role: 'ADMIN' }],
      [tx, { orderId: 'b', workOrderVersion: 1, attemptKey: key('b') }, { id: 'admin', role: 'ADMIN' }],
    ]);
    // 每张工单只在锁内完整读取一次打印内容，且用同一事务连接。
    expect(m.order.mock.calls.map((call) => [call[0], call[3] === tx])).toEqual([['a', true], ['b', true]]);
  });

  // 记录成功后响应丢失再重试：账本已整批记过就直接返回原结果，不探测文件、不核对内容、不开事务。
  it('replays a fully booked attempt before probing the file or opening a transaction', async () => {
    ready();
    m.booked.mockResolvedValue(bookedAll());
    m.available.mockRejectedValue(new Error('PDF_ARTIFACT_EXPIRED'));
    expect(await recordBatchPrint('admin', 'j', 'attempt-1')).toEqual({ marked: 1 });
    expect(m.booked).toHaveBeenCalledWith({ where: { attemptKey: { in: [key('a'), key('b')] } }, select: { attemptKey: true, orderId: true, outcome: true } });
    expect(m.available).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  // 前一次请求还没提交时到达的重试：锁前账本为空、文件探测还失败了，拿到锁后前一次已提交 → 重放。
  it('replays what an in-flight request committed while this one waited for the attempt lock', async () => {
    ready();
    m.booked.mockResolvedValueOnce([]).mockResolvedValueOnce(bookedAll());
    m.available.mockRejectedValue(new Error('PDF_ARTIFACT_EXPIRED'));
    expect(await recordBatchPrint('admin', 'j', 'attempt-1')).toEqual({ marked: 1 });
    expect(m.recordInTx).not.toHaveBeenCalled();
  });

  it('binds attempt keys to the batch job', async () => {
    ready();
    await recordBatchPrint('admin', 'j', 'attempt-1');
    expect(key('a', 'other-job')).not.toBe(key('a'));
    expect(m.booked.mock.calls[0]?.[0].where.attemptKey.in).toEqual([key('a'), key('b')]);
  });

  it('does not record a file that has expired or cannot be read', async () => {
    ready();
    m.available.mockRejectedValue(new Error('PDF_ARTIFACT_EXPIRED'));
    await expect(recordBatchPrint('admin', 'j', 'attempt-1')).rejects.toBeInstanceOf(BatchPrintArtifactUnavailableError);
    expect(m.recordInTx).not.toHaveBeenCalled();
  });

  it('rolls the whole batch back when any order changed or left production', async () => {
    ready();
    m.order.mockImplementation(async (id: string) => ({ id, version: id === 'b' ? 2 : 1, workOrderVersion: 1 }));
    await expect(recordBatchPrint('admin', 'j', 'attempt-1')).rejects.toMatchObject({ issues: [{ position: 2, message: '工单内容已变化，请重新选择并生成' }] });
    m.order.mockImplementation(async (id: string) => ({ id, version: 1, workOrderVersion: 1 }));
    m.recordInTx.mockResolvedValueOnce('MARKED').mockResolvedValueOnce('NOT_PRINTABLE');
    await expect(recordBatchPrint('admin', 'j', 'attempt-1')).rejects.toMatchObject({ issues: [{ position: 2, message: '工单已不在生产中，请取消选择后重新生成' }] });
    m.recordInTx.mockResolvedValueOnce('MARKED').mockResolvedValueOnce('STALE');
    await expect(recordBatchPrint('admin', 'j', 'attempt-1')).rejects.toBeInstanceOf(BatchPrintSelectionError);
    m.versions.mockResolvedValueOnce([{ id: 'a', workOrderVersion: 1 }]);
    await expect(recordBatchPrint('admin', 'j', 'attempt-1')).rejects.toMatchObject({ issues: [{ position: 2, message: '工单不存在或已无权打印，请取消选择后重试' }] });
  });

  it('records nothing when the file is not ready', async () => {
    expect(await recordBatchPrint('admin', 'j', 'attempt-1')).toBeNull();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('refuses another actor’s job before touching orders', async () => {
    await expect(recordBatchPrint('other', 'j', 'attempt-1')).rejects.toBeInstanceOf(BatchPrintAccessError);
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
