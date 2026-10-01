import { spawn } from 'node:child_process';
import { expect, type TestInfo } from '@playwright/test';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { withSupplyChainDb } from '../e2e/_supply-chain-fixtures';

export function assertDurableEnvironment(): void {
  assertActivatedE2eDatabase();
  if (process.env.BACKGROUND_JOBS_MODE !== 'durable' || process.env.E2E_DURABLE_WORKER_CONTROL !== '1') {
    throw new Error('Durable E2E requires its isolated worker-controlled configuration');
  }
}

export async function startHeavyWorker(testInfo: TestInfo) {
  assertDurableEnvironment();
  const existing = await withSupplyChainDb((db) => db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "BackgroundWorkerHeartbeat"
     WHERE queue='HEAVY' AND "lastSeenAt">NOW()-INTERVAL '30 seconds'`,
  ));
  expect(existing.rows[0]?.count, '专用数据库中不能有另一个 HEAVY worker 干扰排队断言').toBe('0');
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/background-worker.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', BACKGROUND_JOB_QUEUE: 'HEAVY', BACKGROUND_JOB_POLL_MS: '100', HEAVY_WORKER_CONCURRENCY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => resolve());
  });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try { await exited; } finally {
      clearTimeout(timer);
      await testInfo.attach(`heavy-worker-${child.pid ?? 'start-failed'}`, { body: output, contentType: 'text/plain' });
    }
  };
  try {
    await expect.poll(async () => {
      if (child.exitCode !== null) throw new Error(`HEAVY worker exited before startup: ${output.slice(-1500)}`);
      const heartbeat = await withSupplyChainDb((db) => db.query<{ version: string }>(
        `SELECT version FROM "BackgroundWorkerHeartbeat" WHERE queue='HEAVY' AND "pdfReady" IS TRUE AND "lastSeenAt">NOW()-INTERVAL '30 seconds'`,
      ));
      return heartbeat.rows.map((row) => row.version);
    }, { timeout: 60_000 }).toEqual([process.env.APP_VERSION]);
  } catch (error) {
    await stop();
    throw error;
  }
  return { stop };
}

export async function readJob(id: string) {
  return withSupplyChainDb(async (db) => {
    const job = await db.query<{ id: string; type: string; queue: string; status: string; attempts: number; lastErrorCode: string | null }>(
      'SELECT id,type,queue::text,status::text,attempts,"lastErrorCode" FROM "BackgroundJob" WHERE id=$1', [id],
    );
    const attempts = await db.query<{ attempt: number; status: string; errorCode: string | null; workerId: string }>(
      'SELECT attempt,status::text,"errorCode","workerId" FROM "BackgroundJobAttempt" WHERE "jobId"=$1 ORDER BY attempt', [id],
    );
    return { job: job.rows[0], attempts: attempts.rows };
  });
}

export async function expectJobSucceeded(id: string, timeout = 45_000) {
  await expect.poll(async () => (await readJob(id)).job?.status, { timeout }).toBe('SUCCEEDED');
  return readJob(id);
}
