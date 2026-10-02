import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isDisposableE2eDatabaseName, postgresDatabaseIdentity } from '@/scripts/lib/e2e-environment';
const mocks = vi.hoisted(() => ({ order: { count: vi.fn(), findMany: vi.fn() }, $queryRaw: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: mocks }));
vi.mock('server-only', () => ({}));
import { listWorkbenchOrders, workbenchOrderFacts, cdrWorkbenchSelect } from '../workbench';
import { cdrWorkbenchFilterSchema } from '../workbench-model';
import type { Prisma } from '@/generated/prisma/client';
const url = process.env.DATABASE_URL;
const identity = url ? postgresDatabaseIdentity(url) : null;
const pg = identity && isDisposableE2eDatabaseName(identity.databaseName) ? describe : describe.skip;
pg('CDR latest usable package · PostgreSQL', () => {
  const schema = `cdr_packages_${randomUUID().replaceAll('-', '')}`;
  const client = new Client({ connectionString: url });
  const row: Prisma.OrderGetPayload<{ select: typeof cdrWorkbenchSelect }> = { id: 'o1', orderNo: 'O1', customName: null, status: 'CONFIRMED',
    submitterRole: 'SALES', settlementType: 'EXTERNAL_SALES', submittedAt: new Date(), submitter: { id: 'sales', username: 'sales', displayName: '销售' }, sourceOrder: null,
    items: [{ id: 'item', sequence: 1, name: '款式', designs: [{ id: 'design', fileName: 'a.cdr', fileUrl: 'https://example.com/design/a.cdr', fileSize: BigInt(1), uploadedAt: new Date() }] }] };
  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query(`CREATE TABLE "DesignBundle" (id text PRIMARY KEY, status text, "zipFileUrl" text, "orderIds" text[], manifest jsonb, "revokedAt" timestamptz, "expiresAt" timestamp(3), "createdAt" timestamp(3))`);
    mocks.order.count.mockResolvedValue(1); mocks.order.findMany.mockResolvedValue([row]);
    mocks.$queryRaw.mockImplementation(async (sql: Prisma.Sql) => (await client.query(sql.text, sql.values)).rows);
  });
  afterAll(async () => { await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
  it.each(['UTC', 'Asia/Shanghai'])('ignores unusable packages in %s while retaining an older usable package', async (zone) => {
    await client.query(`SET TIME ZONE '${zone}'`);
    await client.query('TRUNCATE "DesignBundle"');
    const manifest = JSON.stringify({ version: 1, orders: [{ id: row.id, fingerprint: workbenchOrderFacts(row).fingerprint }] });
    await client.query(`INSERT INTO "DesignBundle" VALUES
      ('revoked', 'READY', 'https://example.com/a.zip', ARRAY['o1'], $1, now(), (now() AT TIME ZONE 'UTC')+interval '1 hour', now()),
      ('expired', 'READY', 'https://example.com/a.zip', ARRAY['o1'], $1, NULL, (now() AT TIME ZONE 'UTC')-interval '1 second', now()),
      ('failed', 'FAILED', 'https://example.com/a.zip', ARRAY['o1'], $1, NULL, (now() AT TIME ZONE 'UTC')+interval '1 hour', now()),
      ('mock', 'READY', 'mock://a.zip', ARRAY['o1'], $1, NULL, (now() AT TIME ZONE 'UTC')+interval '1 hour', now())`, [manifest]);
    const state = async () => (await listWorkbenchOrders(cdrWorkbenchFilterSchema.parse({}))).orders[0].packageState;
    expect(await state()).toBe('new');
    await client.query(`INSERT INTO "DesignBundle" VALUES ('usable', 'READY', 'https://example.com/a.zip', ARRAY['o1'], $1, NULL, (now() AT TIME ZONE 'UTC')+interval '1 hour', (now() AT TIME ZONE 'UTC')-interval '1 hour')`, [manifest]);
    expect(await state()).toBe('unchanged');
    await client.query(`UPDATE "DesignBundle" SET "revokedAt"=now() WHERE id='usable'`);
    expect(await state()).toBe('new');
  });
});
