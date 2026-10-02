import { isDisposableE2eDatabaseName, postgresDatabaseIdentity } from '@/scripts/lib/e2e-environment';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { db } from '@/lib/db';
import { claimNextBackgroundJob, completeBackgroundJob } from '../repository';
import { startWorkerHeartbeat } from '../heartbeat';
import { getBackgroundJobHealth, hasReadyPdfWorker } from '../health';
import { PDF_JOB_TYPES } from '@/lib/pdf/capability';

const scope = `pdf-capability-${randomUUID()}`;
const identity = process.env.DATABASE_URL ? postgresDatabaseIdentity(process.env.DATABASE_URL) : null;
describe.skipIf(!identity || !isDisposableE2eDatabaseName(identity.databaseName)).sequential('PDF capability in PostgreSQL', () => {
  afterAll(async () => {
    await db.backgroundJob.deleteMany({ where: { dedupeKey: { startsWith: scope } } });
    await db.backgroundWorkerHeartbeat.deleteMany({ where: { workerId: { startsWith: scope } } });
  });
  it('does not consume attempts while disabled, runs non-PDF, then claims PDF on recovery', async () => {
    const pdf = await db.backgroundJob.create({ data: { queue: 'HEAVY', type: 'ORDER_PDF', payload: {}, dedupeKey: `${scope}-pdf`, priority: 2147483647 } });
    const other = await db.backgroundJob.create({ data: { queue: 'HEAVY', type: 'ORDER_EXPORT', payload: {}, dedupeKey: `${scope}-export`, priority: 2147483646 } });
    const job = await claimNextBackgroundJob({ queue: 'HEAVY', workerId: scope, leaseMs: 30000, excludedTypes: PDF_JOB_TYPES });
    expect(job?.id).toBe(other.id);
    expect(await db.backgroundJob.findUnique({ where: { id: pdf.id } })).toMatchObject({ status: 'PENDING', attempts: 0 });
    if (!job) throw new Error('expected export claim');
    await completeBackgroundJob(job, {});
    const recovered = await claimNextBackgroundJob({ queue: 'HEAVY', workerId: scope, leaseMs: 30000, excludedTypes: [] });
    expect(recovered?.id).toBe(pdf.id);
    expect(recovered?.attempts).toBe(1);
  });
  it('keeps legacy heartbeat unknown, publishes readiness transitions and requires matching release', async () => {
    await db.$executeRaw`INSERT INTO "BackgroundWorkerHeartbeat" ("workerId", "queue", "version", "startedAt", "lastSeenAt") VALUES (${scope + '-legacy'}, 'HEAVY', ${scope}, now(), now())`;
    expect(hasReadyPdfWorker(await getBackgroundJobHealth(), scope)).toBe(false);
    let ready = false;
    const stop = await startWorkerHeartbeat({ workerId: scope + '-new', queue: 'HEAVY', version: scope, pdfReady: () => ready, intervalMs: 5000 });
    await stop();
    ready = true;
    const stopReady = await startWorkerHeartbeat({ workerId: scope + '-new', queue: 'HEAVY', version: scope, pdfReady: () => ready });
    try {
      expect(hasReadyPdfWorker(await getBackgroundJobHealth(), scope)).toBe(true);
      expect(hasReadyPdfWorker(await getBackgroundJobHealth(), scope + '-other-release')).toBe(false);
    } finally { await stopReady(); }
    expect(hasReadyPdfWorker(await getBackgroundJobHealth(), scope)).toBe(false);
  });
});
