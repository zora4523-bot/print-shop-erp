import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import {
  BackgroundJobQueue,
  BackgroundJobStatus,
  Prisma,
  Role,
} from '../../generated/prisma/client';
import { getOrderForPrint } from '../order/print-view';
import { buildPrintHtml } from '../order/print-html';
import { renderHtmlToPdf } from '../pdf/render';
import { db } from '../db';
import { enqueueBackgroundJob } from './repository';
import { BACKGROUND_JOB_TYPES, type ClaimedBackgroundJob } from './types';

const ROLE_SET: ReadonlySet<string> = new Set(Object.values(Role));

export async function enqueueOrderPdfJob(input: {
  orderId: string;
  actor: { id: string; role: Role };
  baseUrl: string;
}): Promise<string> {
  const { job } = await enqueueBackgroundJob({
    type: BACKGROUND_JOB_TYPES.ORDER_PDF,
    queue: BackgroundJobQueue.HEAVY,
    dedupeKey: `order-pdf:${input.orderId}:${randomUUID()}`,
    payload: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
    priority: 120,
    maxAttempts: 2,
  });
  return job.id;
}

export async function handleOrderPdfJob(
  job: ClaimedBackgroundJob,
): Promise<Prisma.InputJsonValue> {
  const payload = asRecord(job.payload);
  const orderId = requiredString(payload.orderId);
  const baseUrl = requiredString(payload.baseUrl);
  const actor = asRecord(payload.actor);
  const actorId = requiredString(actor.id);
  const role = requiredString(actor.role);
  if (!ROLE_SET.has(role)) throw new InvalidOrderPdfJobPayloadError();

  const order = await getOrderForPrint(
    orderId,
    { id: actorId, role: role as Role },
    baseUrl,
  );
  if (!order) throw new OrderPdfNotFoundError();

  const html = await buildPrintHtml(order);
  const pdf = await renderHtmlToPdf({ html });
  const artifactName = `${job.id}.pdf`;
  await writePdfArtifact(artifactName, pdf);
  await cleanupOldPdfArtifacts();
  return { artifactName, byteLength: pdf.byteLength, orderNo: order.orderNo };
}

export type OrderPdfJobWaitResult =
  | { status: 'ready'; artifactName: string }
  | { status: 'failed'; errorCode: string | null }
  | { status: 'timeout' };

export async function waitForOrderPdfJob(
  jobId: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<OrderPdfJobWaitResult> {
  const deadline = Date.now() + Math.max(1_000, options.timeoutMs ?? 120_000);
  while (Date.now() < deadline && !options.signal?.aborted) {
    const job = await db.backgroundJob.findUnique({
      where: { id: jobId },
      select: { status: true, result: true, lastErrorCode: true },
    });
    if (!job) return { status: 'failed', errorCode: 'JobNotFound' };
    if (job.status === BackgroundJobStatus.SUCCEEDED) {
      const result = asRecord(job.result);
      return { status: 'ready', artifactName: requiredString(result.artifactName) };
    }
    if (
      job.status === BackgroundJobStatus.DEAD ||
      job.status === BackgroundJobStatus.CANCELLED
    ) {
      return { status: 'failed', errorCode: job.lastErrorCode };
    }
    await delay(300, options.signal);
  }
  return { status: 'timeout' };
}

export async function readAndDeletePdfArtifact(name: string): Promise<Buffer> {
  const path = safeArtifactPath(name);
  const pdf = await readFile(path);
  await unlink(path).catch(() => undefined);
  return pdf;
}

async function writePdfArtifact(name: string, pdf: Buffer): Promise<void> {
  const dir = artifactDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = safeArtifactPath(name);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, pdf, { mode: 0o600 });
  await rename(temporary, target);
}

async function cleanupOldPdfArtifacts(): Promise<void> {
  const dir = artifactDir();
  const entries = await readdir(dir).catch(() => [] as string[]);
  const cutoff = Date.now() - 60 * 60_000;
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.pdf'))
      .map(async (entry) => {
        const path = safeArtifactPath(entry);
        const info = await stat(path).catch(() => null);
        if (info && info.mtimeMs < cutoff) await unlink(path).catch(() => undefined);
      }),
  );
}

function artifactDir(): string {
  const configured = process.env.PDF_ARTIFACT_DIR;
  if (configured) {
    if (!isAbsolute(configured)) throw new InvalidOrderPdfJobPayloadError();
    return configured;
  }
  return join(tmpdir(), 'print-shop-erp-pdf-artifacts');
}

function safeArtifactPath(name: string): string {
  if (basename(name) !== name || !/^[A-Za-z0-9_-]+\.pdf$/.test(name)) {
    throw new InvalidOrderPdfJobPayloadError();
  }
  return join(artifactDir(), name);
}

function asRecord(
  value: Prisma.JsonValue | null,
): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidOrderPdfJobPayloadError();
  }
  return value as Record<string, Prisma.JsonValue>;
}

function requiredString(value: Prisma.JsonValue | undefined): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidOrderPdfJobPayloadError();
  }
  return value;
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    const timer = setTimeout(resolveDelay, ms);
    timer.unref();
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolveDelay();
      },
      { once: true },
    );
  });
}

export class InvalidOrderPdfJobPayloadError extends Error {
  constructor() {
    super('invalid order PDF background job payload');
    this.name = 'InvalidOrderPdfJobPayloadError';
  }
}

export class OrderPdfNotFoundError extends Error {
  constructor() {
    super('order PDF source not found');
    this.name = 'OrderPdfNotFoundError';
  }
}
