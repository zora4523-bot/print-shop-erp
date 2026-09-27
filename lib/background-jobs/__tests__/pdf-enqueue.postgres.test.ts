import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { BackgroundJobStatus, Role } from '../../../generated/prisma/enums';

// Opt in through DATABASE_URL (a disposable database). Rows are scoped to a
// random order id and removed afterwards.
const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

postgresDescribe.sequential('order PDF enqueue · PostgreSQL scope lock', () => {
  const orderId = `pdf-scope-${randomUUID()}`;
  const input = {
    orderId,
    expectedWorkOrderVersion: 1,
    actor: { id: 'pdf-actor', role: Role.ADMIN },
    baseUrl: 'https://erp.example.com',
    snapshotKey: 'snapshot',
  };

  async function load() {
    const [{ db }, pdf, repository] = await Promise.all([
      import('../../db'),
      import('../pdf'),
      import('../repository'),
    ]);
    return {
      db,
      enqueueOrderPdfJob: pdf.enqueueOrderPdfJob,
      retryDeadBackgroundJob: repository.retryDeadBackgroundJob,
      OrderPdfScopeInFlightError: repository.OrderPdfScopeInFlightError,
    };
  }

  function inFlight(jobs: Awaited<ReturnType<typeof scopeJobs>>) {
    return jobs.filter((job) =>
      job.status === BackgroundJobStatus.PENDING || job.status === BackgroundJobStatus.RUNNING);
  }

  async function scopeJobs() {
    const { db } = await load();
    return db.backgroundJob.findMany({
      where: { type: 'ORDER_PDF', payload: { path: ['orderId'], equals: orderId } },
      select: { id: true, status: true, dedupeKey: true },
    });
  }

  async function markDead(id: string) {
    const { db } = await load();
    await db.backgroundJob.update({
      where: { id },
      data: { status: BackgroundJobStatus.DEAD, finishedAt: new Date(), lastErrorCode: 'Test' },
    });
  }

  afterAll(async () => {
    const { db } = await load();
    await db.backgroundJob.deleteMany({
      where: { type: 'ORDER_PDF', payload: { path: ['orderId'], equals: orderId } },
    });
  });

  it('never runs two HEAVY renders of one authorized scope, whichever entry comes first', async () => {
    const { enqueueOrderPdfJob } = await load();

    // Window job A fails.
    const a = await enqueueOrderPdfJob(input);
    await markDead(a);

    // Regeneration B starts; then plain downloads and more regenerations race.
    const b = await enqueueOrderPdfJob({ ...input, regenerationKey: 'r1' });
    expect(b).not.toBe(a);
    const racing = await Promise.all([
      enqueueOrderPdfJob(input),
      enqueueOrderPdfJob({ ...input, regenerationKey: 'r2' }),
      enqueueOrderPdfJob(input),
    ]);
    expect(racing).toEqual([b, b, b]);
    let jobs = await scopeJobs();
    expect(jobs.find((job) => job.id === a)?.status).toBe(BackgroundJobStatus.DEAD);
    expect(jobs.filter((job) => job.status === BackgroundJobStatus.PENDING)).toHaveLength(1);

    // Both dead now: a mixed burst of plain downloads and regenerations must
    // still fold into exactly one in-flight job.
    await markDead(b);
    const burst = await Promise.all([
      enqueueOrderPdfJob({ ...input, regenerationKey: 'r3' }),
      enqueueOrderPdfJob(input),
      enqueueOrderPdfJob({ ...input, regenerationKey: 'r4' }),
      enqueueOrderPdfJob(input),
    ]);
    expect(new Set(burst).size).toBe(1);
    jobs = await scopeJobs();
    expect(inFlight(jobs)).toHaveLength(1);
  });

  it('an ops retry of a DEAD job cannot put a second job of the scope in flight', async () => {
    const { enqueueOrderPdfJob, retryDeadBackgroundJob, OrderPdfScopeInFlightError } = await load();
    for (const job of inFlight(await scopeJobs())) await markDead(job.id);

    // A fails; the failure page starts regeneration B; the admin then retries
    // A on /owner/background-jobs while B is still queued.
    const a = await enqueueOrderPdfJob(input);
    await markDead(a);
    const b = await enqueueOrderPdfJob({ ...input, regenerationKey: 'ops-r1' });
    expect(b).not.toBe(a);
    await expect(retryDeadBackgroundJob(a)).rejects.toBeInstanceOf(OrderPdfScopeInFlightError);
    let jobs = await scopeJobs();
    expect(jobs.find((job) => job.id === a)?.status).toBe(BackgroundJobStatus.DEAD);
    expect(inFlight(jobs).map((job) => job.id)).toEqual([b]);

    // Interleaved the other way round: ops retry and regenerations/downloads
    // race for the same idle scope; exactly one job ends up in flight.
    await markDead(b);
    const race = await Promise.allSettled([
      retryDeadBackgroundJob(a),
      enqueueOrderPdfJob({ ...input, regenerationKey: 'ops-r2' }),
      retryDeadBackgroundJob(b),
      enqueueOrderPdfJob(input),
    ]);
    for (const outcome of race) {
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBeInstanceOf(OrderPdfScopeInFlightError);
      }
    }
    jobs = await scopeJobs();
    expect(inFlight(jobs)).toHaveLength(1);
  });
});
