import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260902120400_agent_monthly_bill_exports',
    'migration.sql',
  ),
  'utf8',
);

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

postgresDescribe.sequential(
  'agent monthly bill export migration · PostgreSQL',
  () => {
    it('creates an independent constrained ledger on the legacy database shape', async () => {
      const isolatedSchema = `agent_bill_export_${randomBytes(8).toString('hex')}`;
      const quotedSchema = quoteIdentifier(isolatedSchema);
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query(`CREATE SCHEMA ${quotedSchema}`);
        await client.query(`SET search_path TO ${quotedSchema}, public`);
        await client.query(`SET statement_timeout TO '10s'`);
        await client.query(`CREATE TABLE "User" ("id" TEXT PRIMARY KEY)`);
        await client.query(`INSERT INTO "User" ("id") VALUES ('admin-1')`);
        await client.query(migration);

        await expect(
          client.query(`
            INSERT INTO "AgentMonthlyBillExport" (
              "id", "requestKey", "createdById", "filters", "snapshotAt",
              "status", "fileName", "expiresAt", "updatedAt"
            ) VALUES (
              'export-1', 'request-1', 'admin-1', '{"period":"2026-08"}',
              '2026-09-02T03:00:00Z', 'PENDING', 'bills.xlsx',
              '2026-09-03T03:00:00Z', CURRENT_TIMESTAMP
            )
          `),
        ).resolves.toMatchObject({ rowCount: 1 });

        await expect(
          client.query(`
            INSERT INTO "AgentMonthlyBillExport" (
              "id", "requestKey", "createdById", "filters", "snapshotAt",
              "status", "fileName", "expiresAt", "updatedAt"
            ) VALUES (
              'duplicate-request', 'request-1', 'admin-1', '{}',
              '2026-09-02T03:00:00Z', 'PENDING', 'duplicate.xlsx',
              '2026-09-03T03:00:00Z', CURRENT_TIMESTAMP
            )
          `),
        ).rejects.toMatchObject({ code: '23505' });

        await expect(
          client.query(`
            INSERT INTO "AgentMonthlyBillExport" (
              "id", "requestKey", "createdById", "filters", "snapshotAt",
              "status", "fileName", "expiresAt", "completedAt", "updatedAt"
            ) VALUES (
              'broken-ready', 'request-2', 'admin-1', '{}',
              '2026-09-02T03:00:00Z', 'READY', 'broken.xlsx',
              '2026-09-03T03:00:00Z', '2026-09-02T03:01:00Z',
              CURRENT_TIMESTAMP
            )
          `),
        ).rejects.toMatchObject({ code: '23514' });

        const enumValues = await client.query<{ value: string }>(`
          SELECT enumlabel AS value
          FROM pg_enum
          JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
          JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
          WHERE pg_type.typname = 'AgentMonthlyBillExportStatus'
            AND pg_namespace.nspname = $1
          ORDER BY enumsortorder
        `, [isolatedSchema]);
        expect(enumValues.rows.map((row) => row.value)).toEqual([
          'PENDING',
          'READY',
          'FAILED',
          'EXPIRED',
        ]);
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
        await client.end();
      }
    });
  },
);
