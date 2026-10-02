import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isDisposableE2eDatabaseName, postgresDatabaseIdentity } from '@/scripts/lib/e2e-environment';
const fixture = vi.hoisted(() => ({ schema: `pdf_owner_${crypto.randomUUID().replaceAll('-', '')}` }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', async () => {
  const { PrismaClient } = await import('@/generated/prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${fixture.schema},public -c timezone=UTC` }, { schema: fixture.schema }) }) };
});
import { db } from '@/lib/db';
import { runBackgroundWorker } from '../worker';
import { startWorkerHeartbeat } from '../heartbeat';
import { waitForOrderPdfJob } from '../pdf';
import { batchPrintStatus } from '@/lib/order/batch-print';
const url = process.env.DATABASE_URL;
const identity = url ? postgresDatabaseIdentity(url) : null;
const pg = identity && isDisposableE2eDatabaseName(identity.databaseName) ? describe : describe.skip;
pg('PDF owner heartbeat through real worker lanes', () => {
  let admin: Client;
  beforeAll(async () => {
    admin = new Client({ connectionString: url }); await admin.connect();
    await admin.query(`CREATE SCHEMA "${fixture.schema}"`);
    const enums = await admin.query<{ typname: string; labels: string[] }>(`SELECT typname, array_agg(enumlabel::text ORDER BY enumsortorder) AS labels FROM pg_type JOIN pg_namespace ON pg_namespace.oid = typnamespace JOIN pg_enum ON enumtypid = pg_type.oid WHERE nspname = 'public' GROUP BY typname`);
    for (const { typname, labels } of enums.rows) {
      const name = typname.replaceAll('"', '""');
      await admin.query(`CREATE TYPE "${fixture.schema}"."${name}" AS ENUM (${labels.map(label => "'" + label.replaceAll("'", "''") + "'").join(',')})`);
    }
    for (const table of ['BackgroundJob', 'BackgroundJobAttempt', 'BackgroundWorkerHeartbeat', 'User', 'NotificationLog', 'DesignBundle', 'OrderExport', 'AgentMonthlyBillExport']) {
      await admin.query(`CREATE TABLE "${fixture.schema}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING INDEXES)`);
      const columns = await admin.query<{ attname: string; typname: string; defaultValue: string | null }>(`SELECT a.attname, t.typname, pg_get_expr(d.adbin, d.adrelid) AS "defaultValue" FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = $1::regclass AND t.typtype = 'e'`, [`public."${table}"`]);
      for (const column of columns.rows) {
        const field = `"${column.attname}"`;
        const type = `"${fixture.schema}"."${column.typname}"`;
        await admin.query(`ALTER TABLE "${fixture.schema}"."${table}" ALTER COLUMN ${field} DROP DEFAULT, ALTER COLUMN ${field} TYPE ${type} USING ${field}::text::${type}`);
        if (column.defaultValue) await admin.query(`ALTER TABLE "${fixture.schema}"."${table}" ALTER COLUMN ${field} SET DEFAULT (${column.defaultValue})::text::${type}`);
      }
    }
  });
  afterAll(async () => {
    await db.$disconnect();
    await admin?.query(`DROP SCHEMA IF EXISTS "${fixture.schema}" CASCADE`);
    await admin?.end();
  });
  it('recognizes a live process with pdfReady=false and a different deployment version', async () => {
    const processId = 'test-host:12345:heavy';
    const stopHeartbeat = await startWorkerHeartbeat({ workerId: processId, queue: 'HEAVY', version: 'previous-deploy', pdfReady: () => false });
    const controller = new AbortController();
    const failures: unknown[] = [];
    const seen: string[] = [];
    try {
      await admin.query(`INSERT INTO "${fixture.schema}"."User" (id, username, password, "displayName", role, "updatedAt") VALUES ('admin', 'pdf-owner-admin', 'unused', '测试管理员', 'ADMIN', NOW())`);
      for (const type of ['ORDER_PDF', 'ORDER_BATCH_PDF']) {
        await db.backgroundJob.create({ data: { id: type, type, queue: 'HEAVY', dedupeKey: type, payload: type === 'ORDER_PDF'
          ? { orderId: 'o', actor: { id: 'admin', role: 'ADMIN' }, expectedWorkOrderVersion: 1 }
          : { actorId: 'admin', baseUrl: 'https://example.test', orders: [{ id: 'o', key: 'snapshot' }] } } });
      }
      await runBackgroundWorker({ workerId: processId, queue: 'HEAVY', concurrency: 1, signal: controller.signal,
        handlers: Object.fromEntries(['ORDER_PDF', 'ORDER_BATCH_PDF'].map(type => [type, async (job: { id: string }) => {
          const row = await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
          expect(row.lockedBy).toBe(`${processId}:1`);
          expect(await db.backgroundWorkerHeartbeat.findUnique({ where: { workerId: processId } })).toMatchObject({ pdfReady: false, version: 'previous-deploy' });
          if (type === 'ORDER_PDF') expect(await waitForOrderPdfJob(job.id, { timeoutMs: 1000 })).toEqual({ status: 'timeout', phase: 'running' });
          else expect(await batchPrintStatus('admin', job.id)).toMatchObject({ status: 'pending', phase: 'rendering' });
          seen.push(type);
          if (seen.length === 2) controller.abort();
          return {};
        }])), onError: error => { failures.push(error); controller.abort(); } });
      expect(failures).toEqual([]);
      expect(seen.sort()).toEqual(['ORDER_BATCH_PDF', 'ORDER_PDF']);
    } finally { controller.abort(); await stopHeartbeat(); }
  }, 15000);
});
