import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PDFDocument } from 'pdf-lib';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { Role, BackgroundJobQueue, BackgroundJobStatus } from '@/generated/prisma/enums';
import { getOrderForPrint } from '@/lib/order/print-view';
import { buildPrintHtml } from '@/lib/order/print-html';
import { getSetting } from '@/lib/settings';
import { renderHtmlToPdf } from '@/lib/pdf/render';
import { orderPdfSnapshotKey } from '@/lib/pdf/order-snapshot';
import { assertPdfArtifactAvailable, readPdfArtifact, writePdfArtifact, cleanupOldPdfArtifacts, PdfArtifactStorageError } from '@/lib/pdf/artifacts';
import { isPdfInfrastructureFailure } from '@/lib/pdf/capability';
import { databaseNow } from '@/lib/background-jobs/clock';
import { WORKER_HEARTBEAT_ACTIVE_WINDOW_MS } from '@/lib/background-jobs/heartbeat-policy';
import { enqueueBackgroundJob, BackgroundJobLeaseLostError } from '@/lib/background-jobs/repository';
import { BACKGROUND_JOB_TYPES, type ClaimedBackgroundJob } from '@/lib/background-jobs/types';
import { BATCH_PRINT_MAX, batchPrintRequestSchema, type BatchPrintIssue, type BatchPrintStatus } from './batch-print-contract';
import { recordRenderedPrintInTx } from './print-jobs';

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
/** 打印文件已过期或读不到：不能把没拿到的文件记为已打印。 */
export class BatchPrintArtifactUnavailableError extends Error {}

async function requireAdmin(actorId: string) {
  const account = await db.user.findUnique({ where: { id: actorId }, select: { isActive: true, role: true } });
  if (!account?.isActive || account.role !== Role.ADMIN) throw new BatchPrintAccessError();
}

async function loadCurrent(payload: Payload, index: number, client: Prisma.TransactionClient = db) {
  const expected = payload.orders[index];
  const order = await getOrderForPrint(expected.id, { id: payload.actorId, role: Role.ADMIN }, payload.baseUrl, client);
  if (!order) throw new BatchPrintSelectionError([{ position: index + 1, message: '工单不存在或已无权打印，请取消选择后重试' }]);
  const factoryName = (await getSetting('factory_name', client)).name;
  if (orderPdfSnapshotKey(order, factoryName) !== expected.key) {
    throw new BatchPrintSelectionError([{ position: index + 1, message: '工单内容已变化，请重新选择并生成' }]);
  }
  return { order, factoryName };
}

async function validateAll(payload: Payload) {
  await requireAdmin(payload.actorId);
  const issues: BatchPrintIssue[] = [];
  const printed: { index: number; orderId: string; workOrderVersion: number }[] = [];
  for (let i = 0; i < payload.orders.length; i++) {
    try {
      const { order } = await loadCurrent(payload, i);
      printed.push({ index: i, orderId: order.id, workOrderVersion: order.workOrderVersion });
    } catch (error) {
      if (!(error instanceof BatchPrintSelectionError)) throw error;
      issues.push(...error.issues);
    }
  }
  if (issues.length) throw new BatchPrintSelectionError(issues);
  return printed;
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
  // A RUNNING job is already owned by a worker.
  const worker = job.status === 'RUNNING' ? true : await db.backgroundWorkerHeartbeat.findFirst({
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

/**
 * 业主 2026-10-02：打开或下载批量打印文件即记已打印。下载本身是只读 GET；浏览器先成功取得
 * 文件，再由 Server Action 调这里记录，记录成功后才把文件交给管理员：
 *
 * 1. 文件仍在有效期内可读，否则不记。
 * 2. 一个事务里按工单 id 顺序（与批量排单同一比较方式）加锁，锁内用同一事务连接重新读取每张
 *    工单，完整快照摘要须与文件一致；任一工单不一致、已不在生产中都整批回滚，不留半截记录。
 * 3. 每次打开 / 下载一个尝试（`attemptId`，同一次的重试沿用），每张工单的尝试键为
 *    `batch-print:<尝试>:<工单>`：重试只重放这一次的结果；同一打印文件之后再打开是新的尝试，
 *    会记录期间新建的补打任务。
 */
export async function recordBatchPrint(actorId: string, jobId: string, attemptId: string): Promise<{ marked: number } | null> {
  const { job, payload } = await ownedJob(actorId, jobId);
  const result = resultSchema.safeParse(job.result);
  if (job.status !== 'SUCCEEDED' || !result.success || result.data.issues.length || !result.data.artifactName) return null;
  try { await assertPdfArtifactAvailable(result.data.artifactName); }
  catch { throw new BatchPrintArtifactUnavailableError(); }
  const printed = (await validateAll(payload)).sort((a, b) => a.orderId.localeCompare(b.orderId));
  const actor = { id: actorId, role: Role.ADMIN };
  const outcomes = await db.$transaction(async (tx) => {
    const recorded = [];
    for (const { index, orderId, workOrderVersion } of printed) {
      const outcome = await recordRenderedPrintInTx(tx, { orderId, workOrderVersion, attemptKey: `batch-print:${attemptId}:${orderId}` }, actor,
        async () => { await loadCurrent(payload, index, tx); return true; });
      if (outcome === 'STALE' || outcome === 'NOT_PRINTABLE') {
        throw new BatchPrintSelectionError([{ position: index + 1, message: outcome === 'STALE' ? '工单内容已变化，请重新选择并生成' : '工单已不在生产中，请取消选择后重新生成' }]);
      }
      recorded.push(outcome);
    }
    return recorded;
  }, { timeout: 30_000 });
  return { marked: outcomes.filter((outcome) => outcome === 'MARKED').length };
}
