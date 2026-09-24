import { createHash } from 'node:crypto';
import { writePdfArtifact, cleanupOldPdfArtifacts } from '../pdf/artifacts';
import {
  BackgroundJobQueue,
  BackgroundJobStatus,
  Prisma,
  Role,
} from '../../generated/prisma/client';
import { getOrderForPrint } from '../order/print-view';
import { buildPrintHtml } from '../order/print-html';
import { renderHtmlToPdf } from '../pdf/render';
import { orderPdfSnapshotKey } from '../pdf/order-snapshot';
import { db } from '../db';
import { getSetting } from '../settings';
import { databaseNow } from './clock';
import { WORKER_HEARTBEAT_ACTIVE_WINDOW_MS } from './heartbeat-policy';
import { enqueueBackgroundJob } from './repository';
import { BACKGROUND_JOB_TYPES, type ClaimedBackgroundJob } from './types';

export { readPdfArtifact, writePdfArtifact } from '../pdf/artifacts';

const PDF_JOB_REUSE_WINDOW_MS = 15 * 60_000;
const ROLE_SET: ReadonlySet<string> = new Set(Object.values(Role));

export async function enqueueOrderPdfJob(input: {
  orderId: string;
  expectedWorkOrderVersion: number;
  actor: { id: string; role: Role };
  baseUrl: string;
  snapshotKey?: string;
  regenerationKey?: string;
}): Promise<string> {
  // The authorized scope (order, actor, work-order version, content snapshot,
  // base URL) excludes the regeneration key, so every job of one scope shares
  // this dedupe-key prefix whether it came from the window or a regeneration.
  const { regenerationKey, ...scope } = input;
  const scopeDigest = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
  const scopePrefix = `order-pdf:v2:${scopeDigest}:`;
  // Every entry (plain download and failure-page regeneration) runs the same
  // check-or-create under one transaction-scoped lock per authorized scope, so
  // a plain download can neither requeue a DEAD window job nor open a new
  // window job while a regeneration of the same scope is queued or running
  // (and vice versa). Two HEAVY renders of one scope would only waste the
  // single-concurrency queue.
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopePrefix}))`;
    const inFlight = await findInFlightOrderPdfJob(tx, scopePrefix);
    if (inFlight) return inFlight;
    let dedupeKey: string;
    if (regenerationKey === undefined) {
      const enqueuedAt = await databaseNow(tx);
      const reuseWindow = Math.floor(enqueuedAt.getTime() / PDF_JOB_REUSE_WINDOW_MS);
      dedupeKey = `${scopePrefix}${reuseWindow}`;
    } else {
      const regeneration = await resolveOrderPdfRegeneration(tx, scopePrefix);
      if ('jobId' in regeneration) return regeneration.jobId;
      dedupeKey = regeneration.dedupeKey;
    }
    const { job } = await enqueueBackgroundJob(
      {
        type: BACKGROUND_JOB_TYPES.ORDER_PDF,
        queue: BackgroundJobQueue.HEAVY,
        // Unique DB key coalesces requests for the same authorized snapshot
        // within a 15-minute window. A new window allows recovery when a
        // completed artifact expired; all downloads still recheck access.
        dedupeKey,
        payload: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
        priority: 120,
        maxAttempts: 2,
      },
      tx,
    );
    return job.id;
  });
}

const IN_FLIGHT_STATUSES: readonly BackgroundJobStatus[] = [
  BackgroundJobStatus.PENDING,
  BackgroundJobStatus.RUNNING,
];

type PdfEnqueueTx = Pick<Prisma.TransactionClient, 'backgroundJob' | '$queryRaw'>;

function orderPdfScope(scopePrefix: string) {
  return {
    type: BACKGROUND_JOB_TYPES.ORDER_PDF,
    dedupeKey: { startsWith: scopePrefix },
  };
}

async function findInFlightOrderPdfJob(
  tx: PdfEnqueueTx,
  scopePrefix: string,
): Promise<string | null> {
  const inFlight = await tx.backgroundJob.findFirst({
    where: { ...orderPdfScope(scopePrefix), status: { in: [...IN_FLIGHT_STATUSES] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return inFlight?.id ?? null;
}

// A failure-recovery link must not stack HEAVY jobs. The caller already holds
// the scope lock and found nothing in flight, so the new job's key is anchored
// on the latest (finished) job of the scope; once that job finishes, the
// anchor moves on. An operator retry of a DEAD job does not take the scope
// lock, so a job that turned PENDING meanwhile is still reused.
async function resolveOrderPdfRegeneration(
  tx: PdfEnqueueTx,
  scopePrefix: string,
): Promise<{ jobId: string } | { dedupeKey: string }> {
  const latest = await tx.backgroundJob.findFirst({
    where: orderPdfScope(scopePrefix),
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  });
  if (latest && IN_FLIGHT_STATUSES.includes(latest.status)) return { jobId: latest.id };
  return { dedupeKey: `${scopePrefix}regenerate:after:${latest?.id ?? 'none'}` };
}

export async function handleOrderPdfJob(
  job: ClaimedBackgroundJob,
): Promise<Prisma.InputJsonValue> {
  const payload = asRecord(job.payload);
  const orderId = requiredString(payload.orderId);
  const expectedWorkOrderVersion = requiredPositiveInteger(
    payload.expectedWorkOrderVersion,
  );
  const baseUrl = requiredString(payload.baseUrl);
  // Retired task-sheet jobs must not be rendered or served as production orders.
  if (payload.mode !== undefined && payload.mode !== 'order') {
    throw new InvalidOrderPdfJobPayloadError();
  }
  const actor = asRecord(payload.actor);
  const actorId = requiredString(actor.id);
  const role = requiredString(actor.role);
  if (!ROLE_SET.has(role)) throw new InvalidOrderPdfJobPayloadError();

  await requireCurrentPdfActor(actorId, role);
  const order = await getOrderForPrint(
    orderId,
    { id: actorId, role: role as Role },
    baseUrl,
  );
  if (!order) throw new OrderPdfNotFoundError();
  if (order.workOrderVersion !== expectedWorkOrderVersion) {
    throw new OrderPdfVersionStaleError();
  }

  const { name: factoryName } = await getSetting('factory_name');
  if (payload.snapshotKey && payload.snapshotKey !== orderPdfSnapshotKey(order, factoryName)) {
    throw new OrderPdfVersionStaleError();
  }
  const html = await buildPrintHtml(order, { factoryName });
  await job.assertLease?.();
  job.signal?.throwIfAborted();
  const pdf = await renderHtmlToPdf({
    html,
    ...(job.signal ? { signal: job.signal } : {}),
  });
  await job.assertLease?.();
  job.signal?.throwIfAborted();
  await requireCurrentPdfActor(actorId, role);
  const currentOrder = await getOrderForPrint(
    orderId,
    { id: actorId, role: role as Role },
    baseUrl,
  );
  if (!currentOrder) throw new OrderPdfNotFoundError();
  if (currentOrder.workOrderVersion !== expectedWorkOrderVersion) {
    throw new OrderPdfVersionStaleError();
  }
  const { name: currentFactoryName } = await getSetting('factory_name');
  if (payload.snapshotKey && payload.snapshotKey !== orderPdfSnapshotKey(currentOrder, currentFactoryName)) {
    throw new OrderPdfVersionStaleError();
  }
  const artifactName = `${job.id}-${job.attempts}.pdf`;
  await writePdfArtifact(artifactName, pdf);
  await job.assertLease?.();
  await cleanupOldPdfArtifacts();
  return {
    artifactName,
    byteLength: pdf.byteLength,
    orderNo: order.orderNo,
    workOrderVersion: order.workOrderVersion,
  };
}

export type OrderPdfJobWaitResult =
  | { status: 'ready'; artifactName: string }
  | { status: 'failed'; errorCode: string | null }
  | { status: 'timeout' }
  | { status: 'unavailable' }
  | { status: 'delayed' };

export async function waitForOrderPdfJob(
  jobId: string,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    expected?: {
      orderId: string;
      actorId: string;
      actorRole: Role;
      workOrderVersion: number;
    };
  } = {},
): Promise<OrderPdfJobWaitResult> {
  const deadline = Date.now() + Math.max(1_000, options.timeoutMs ?? 120_000);
  while (Date.now() < deadline && !options.signal?.aborted) {
    const job = await db.backgroundJob.findUnique({
      where: { id: jobId },
      select: {
        type: true,
        payload: true,
        status: true,
        result: true,
        lastErrorCode: true,
        createdAt: true,
      },
    });
    if (!job) return { status: 'failed', errorCode: 'JobNotFound' };
    if (options.expected && !matchesExpectedPdfJob(job, options.expected)) {
      // Do not reveal whether a caller-supplied job id exists or belongs to a
      // different user/order.
      return { status: 'failed', errorCode: 'JobNotFound' };
    }
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
    // Check only after the actor/order binding and completed-state checks.
    // Database time keeps queue age and remote worker heartbeats comparable.
    const at = await databaseNow();
    const worker = await db.backgroundWorkerHeartbeat.findFirst({
      where: {
        queue: BackgroundJobQueue.HEAVY,
        lastSeenAt: { gte: new Date(at.getTime() - WORKER_HEARTBEAT_ACTIVE_WINDOW_MS) },
      },
      select: { workerId: true },
    });
    if (!worker) return { status: 'unavailable' };
    if (at.getTime() - job.createdAt.getTime() >= 120_000) {
      return { status: 'delayed' };
    }
    await delay(300, options.signal);
  }
  return { status: 'timeout' };
}

function matchesExpectedPdfJob(
  job: { type: string; payload: Prisma.JsonValue },
  expected: {
    orderId: string;
    actorId: string;
    actorRole: Role;
    workOrderVersion: number;
  },
): boolean {
  if (job.type !== BACKGROUND_JOB_TYPES.ORDER_PDF) return false;
  try {
    const payload = asRecord(job.payload);
    const actor = asRecord(payload.actor);
    return (
      payload.orderId === expected.orderId &&
      actor.id === expected.actorId &&
      actor.role === expected.actorRole &&
      payload.expectedWorkOrderVersion === expected.workOrderVersion &&
      (payload.mode === undefined || payload.mode === 'order')
    );
  } catch {
    return false;
  }
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

function requiredPositiveInteger(value: Prisma.JsonValue | undefined): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new InvalidOrderPdfJobPayloadError();
  }
  return Number(value);
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolveDelay();
    };
    const timer = setTimeout(finish, ms);
    timer.unref();
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted) finish();
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

export class OrderPdfVersionStaleError extends Error {
  constructor() {
    super('order PDF work-order version changed');
    this.name = 'OrderPdfVersionStaleError';
  }
}

async function requireCurrentPdfActor(id: string, role: string): Promise<void> {
  const current = await db.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
  if (!current?.isActive || current.role !== role) throw new OrderPdfNotFoundError();
}
