import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PDFDocument } from 'pdf-lib';
import { db } from '@/lib/db';
import { Role, BackgroundJobQueue, BackgroundJobStatus } from '@/generated/prisma/enums';
import { getOrderForPrint } from '@/lib/order/print-view';
import { buildPrintHtml } from '@/lib/order/print-html';
import { getSetting } from '@/lib/settings';
import { renderHtmlToPdf } from '@/lib/pdf/render';
import { orderPdfSnapshotKey } from '@/lib/pdf/order-snapshot';
import { readPdfArtifact, writePdfArtifact, cleanupOldPdfArtifacts, PdfArtifactStorageError } from '@/lib/pdf/artifacts';
import { isPdfInfrastructureFailure } from '@/lib/pdf/capability';
import { databaseNow } from '@/lib/background-jobs/clock';
import { WORKER_HEARTBEAT_ACTIVE_WINDOW_MS } from '@/lib/background-jobs/heartbeat-policy';
import { enqueueBackgroundJob, BackgroundJobLeaseLostError } from '@/lib/background-jobs/repository';
import { BACKGROUND_JOB_TYPES, type ClaimedBackgroundJob } from '@/lib/background-jobs/types';
import { BATCH_PRINT_MAX, batchPrintRequestSchema, type BatchPrintIssue, type BatchPrintStatus } from './batch-print-contract';

const BATCH_PRINT_MAX_BYTES = 100 * 1024 * 1024;

const payloadSchema = z.object({
  actorId: z.string(), baseUrl: z.string().url(),
  orders: z.array(z.object({ id: z.string(), key: z.string() })).min(1).max(BATCH_PRINT_MAX),
});
const resultSchema = z.object({
  completed: z.number().int().nonnegative(),
  issues: z.array(z.object({ position: z.number().int().positive(), message: z.string() })),
  artifactName: z.string().optional(),
});
type Payload = z.infer<typeof payloadSchema>;

export class BatchPrintAccessError extends Error {}
export class BatchPrintSelectionError extends Error {
  constructor(public readonly issues: BatchPrintIssue[]) { super('Invalid batch print selection'); }
}

async function requireAdmin(actorId: string) {
  const account = await db.user.findUnique({ where: { id: actorId }, select: { isActive: true, role: true } });
  if (!account?.isActive || account.role !== Role.ADMIN) throw new BatchPrintAccessError();
}

async function loadCurrent(payload: Payload, index: number) {
  const expected = payload.orders[index];
  const order = await getOrderForPrint(expected.id, { id: payload.actorId, role: Role.ADMIN }, payload.baseUrl);
  if (!order) throw new BatchPrintSelectionError([{ position: index + 1, message: '工单不存在或已无权打印，请取消选择后重试' }]);
  const factoryName = (await getSetting('factory_name')).name;
  if (orderPdfSnapshotKey(order, factoryName) !== expected.key) {
    throw new BatchPrintSelectionError([{ position: index + 1, message: '工单内容已变化，请重新选择并生成' }]);
  }
  return { order, factoryName };
}

async function validateAll(payload: Payload) {
  await requireAdmin(payload.actorId);
  const issues: BatchPrintIssue[] = [];
  for (let i = 0; i < payload.orders.length; i++) {
    try { await loadCurrent(payload, i); }
    catch (error) {
      if (!(error instanceof BatchPrintSelectionError)) throw error;
      issues.push(...error.issues);
    }
  }
  if (issues.length) throw new BatchPrintSelectionError(issues);
}

export async function requestBatchPrint(actorId: string, input: unknown, baseUrl: string) {
  await requireAdmin(actorId);
  const request = batchPrintRequestSchema.parse(input);
  const orders: Payload['orders'] = [];
  const issues: BatchPrintIssue[] = [];
  const factoryName = (await getSetting('factory_name')).name;
  for (const [index, id] of request.orderIds.entries()) {
    const order = await getOrderForPrint(id, { id: actorId, role: Role.ADMIN }, baseUrl);
    if (!order) issues.push({ position: index + 1, message: '工单不存在或已无权打印，请取消选择后重试' });
    else orders.push({ id, key: orderPdfSnapshotKey(order, factoryName) });
  }
  if (issues.length) throw new BatchPrintSelectionError(issues);
  const payload: Payload = { actorId, baseUrl, orders };
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const scope = `batch-pdf:v2:${digest}:`;
  const existing = await db.backgroundJob.findFirst({
    where: { type: BACKGROUND_JOB_TYPES.ORDER_BATCH_PDF, dedupeKey: { startsWith: scope },
      status: { in: [BackgroundJobStatus.PENDING, BackgroundJobStatus.RUNNING] } },
    orderBy: { createdAt: 'desc' }, select: { id: true },
  });
  if (existing) return existing.id;
  const window = Math.floor((await databaseNow()).getTime() / (15 * 60_000));
  const dedupeKey = `${scope}${window}`;
  const previous = await db.backgroundJob.findUnique({ where: { dedupeKey } });
  if (previous?.status === BackgroundJobStatus.SUCCEEDED) {
    const result = resultSchema.safeParse(previous.result);
    if (result.success && !result.data.issues.length && result.data.artifactName) {
      try { await readPdfArtifact(result.data.artifactName); return previous.id; }
      catch { /* Expired/missing files must be regenerated. */ }
    }
  }
  const terminal = previous && ['SUCCEEDED', 'CANCELLED'].includes(previous.status);
  const { job } = await enqueueBackgroundJob({
    type: BACKGROUND_JOB_TYPES.ORDER_BATCH_PDF, queue: BackgroundJobQueue.HEAVY,
    dedupeKey: terminal ? `${scope}${request.requestId}` : dedupeKey,
    payload, maxAttempts: 2,
  });
  return job.id;
}

async function progress(job: ClaimedBackgroundJob, completed: number) {
  job.signal?.throwIfAborted();
  await job.assertLease?.();
  const updated = await db.backgroundJob.updateMany({
    where: { id: job.id, status: BackgroundJobStatus.RUNNING, lockedBy: job.workerId, attempts: job.attempts },
    data: { result: { completed, issues: [] } },
  });
  if (updated.count !== 1) throw new BackgroundJobLeaseLostError(job.id);
}

export async function handleBatchPrintJob(job: ClaimedBackgroundJob) {
  const payload = payloadSchema.parse(job.payload);
  await requireAdmin(payload.actorId);
  const merged = await PDFDocument.create();
  await progress(job, 0);
  let bytes = 0;
  for (let index = 0; index < payload.orders.length; index++) {
    try {
      const { order, factoryName } = await loadCurrent(payload, index);
      // Private, actor-scoped content cache. Authorization and snapshot checks
      // above and before publication still apply on every cache hit.
      const cacheName = `order-cache-${createHash('sha256').update(`${payload.actorId}:${payload.orders[index].key}`).digest('hex')}.pdf`;
      let pdf: Buffer;
      try { pdf = await readPdfArtifact(cacheName); }
      catch {
        pdf = await renderHtmlToPdf({ html: await buildPrintHtml(order, { factoryName }), signal: job.signal, requireArtwork: true });
        await loadCurrent(payload, index);
        job.signal?.throwIfAborted();
        await job.assertLease?.();
        // Storage failures are infrastructure: classify them so the job is retried (§15.4).
        try { await writePdfArtifact(cacheName, pdf); }
        catch { throw new PdfArtifactStorageError(); }
      }
      bytes += pdf.length;
      if (bytes > BATCH_PRINT_MAX_BYTES) {
        return { completed: index, issues: [{ position: index + 1, message: '文件过大，请减少所选工单后分批打印' }] };
      }
      const source = await PDFDocument.load(pdf);
      for (const page of await merged.copyPages(source, source.getPageIndices())) merged.addPage(page);
    } catch (error) {
      job.signal?.throwIfAborted();
      await job.assertLease?.();
      if (error instanceof BatchPrintSelectionError) return { completed: index, issues: error.issues };
      if (error instanceof BatchPrintAccessError || error instanceof BackgroundJobLeaseLostError) throw error;
      // Infrastructure failures are not the order's fault: rethrow so the worker
      // invalidates PDF capability and the durable job retries (CLAUDE.md §15.4).
      if (isPdfInfrastructureFailure(error)) throw error;
      return { completed: index, issues: [{ position: index + 1, message: error instanceof Error && error.name === 'PrintArtworkUnavailableError'
        ? '图稿加载失败，请检查图稿后重试' : '工单生成失败，请检查打印内容后重试' }] };
    }
    await progress(job, index + 1);
  }
  try { await validateAll(payload); }
  catch (error) {
    if (error instanceof BatchPrintSelectionError) return { completed: payload.orders.length, issues: error.issues };
    throw error;
  }
  const artifactName = `${job.id}-${job.attempts}.pdf`;
  const pdf = Buffer.from(await merged.save());
  job.signal?.throwIfAborted();
  await job.assertLease?.();
  try { await writePdfArtifact(artifactName, pdf); }
  catch { throw new PdfArtifactStorageError(); }
  await job.assertLease?.();
  await cleanupOldPdfArtifacts();
  return { completed: payload.orders.length, issues: [], artifactName };
}

async function ownedJob(actorId: string, jobId: string) {
  await requireAdmin(actorId);
  const job = await db.backgroundJob.findUnique({ where: { id: jobId } });
  if (!job || job.type !== BACKGROUND_JOB_TYPES.ORDER_BATCH_PDF) throw new BatchPrintAccessError();
  const payload = payloadSchema.parse(job.payload);
  if (payload.actorId !== actorId) throw new BatchPrintAccessError();
  return { job, payload };
}

export async function batchPrintStatus(actorId: string, jobId: string): Promise<BatchPrintStatus> {
  const { job, payload } = await ownedJob(actorId, jobId);
  const parsed = resultSchema.safeParse(job.result);
  const result = parsed.success ? parsed.data : { completed: 0, issues: [] };
  const base = { completed: Math.min(result.completed, payload.orders.length), total: payload.orders.length, issues: result.issues };
  if (result.issues.length || job.status === 'DEAD' || job.status === 'CANCELLED') return { ...base, status: 'failed' };
  if (job.status === 'SUCCEEDED') return { ...base, status: result.artifactName ? 'ready' : 'failed' };
  const at = await databaseNow();
  // Same capability rule as single-order PDFs: a live HEAVY worker that cannot
  // render (pdfReady=false) or runs another version will not claim this job.
  // A claimed job may continue during a capability probe, but only with a live owner.
  const owner = job.status === 'RUNNING' && job.lockedBy
    ? await db.backgroundWorkerHeartbeat.findFirst({
        where: { workerId: job.lockedBy, queue: BackgroundJobQueue.HEAVY,
          lastSeenAt: { gte: new Date(at.getTime() - WORKER_HEARTBEAT_ACTIVE_WINDOW_MS) } },
        select: { workerId: true },
      }) : null;
  const worker = owner ?? await db.backgroundWorkerHeartbeat.findFirst({
    where: { queue: BackgroundJobQueue.HEAVY, pdfReady: true, version: process.env.APP_VERSION || 'dev',
      lastSeenAt: { gte: new Date(at.getTime() - WORKER_HEARTBEAT_ACTIVE_WINDOW_MS) } },
    select: { workerId: true },
  });
  return { ...base, status: worker ? 'pending' : 'unavailable',
    phase: job.status === 'PENDING' ? 'queued' : result.completed >= payload.orders.length ? 'merging' : 'rendering' };
}

export async function downloadBatchPrint(actorId: string, jobId: string) {
  const { job, payload } = await ownedJob(actorId, jobId);
  const result = resultSchema.safeParse(job.result);
  if (job.status !== 'SUCCEEDED' || !result.success || result.data.issues.length || !result.data.artifactName) return null;
  await validateAll(payload);
  const bytes = await readPdfArtifact(result.data.artifactName);
  await validateAll(payload);
  return bytes;
}
