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
    '20260830160000_order_edit_version',
    'migration.sql',
  ),
  'utf8',
);

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

const waitForBlockedStatement = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 25));

postgresDescribe.sequential('order edit monotonic-version CAS · PostgreSQL', () => {
  it('rejects the stale writer even when both writes keep the same millisecond timestamp', async () => {
    const schema = `order_edit_cas_${randomBytes(8).toString('hex')}`;
    const quotedSchema = quoteIdentifier(schema);
    const first = new Client({ connectionString: databaseUrl });
    const second = new Client({ connectionString: databaseUrl });

    await first.connect();
    await second.connect();
    try {
      await first.query(`CREATE SCHEMA ${quotedSchema}`);
      await first.query(`SET search_path TO ${quotedSchema}, public`);
      await second.query(`SET search_path TO ${quotedSchema}, public`);
      await first.query(`SET statement_timeout TO '5s'`);
      await second.query(`SET statement_timeout TO '5s'`);
      await first.query(`
        CREATE TABLE "Order" (
          "id" TEXT PRIMARY KEY,
          "settlementType" TEXT NOT NULL,
          "remark" TEXT,
          "updatedAt" TIMESTAMPTZ(3) NOT NULL
        )
      `);
      await first.query(migration);
      await first.query(
        `INSERT INTO "Order" ("id", "settlementType", "remark", "updatedAt")
         VALUES ('order-1', 'EXTERNAL_SALES', NULL, '2026-08-30T00:00:00.000Z')`,
      );

      await first.query('BEGIN');
      await second.query('BEGIN');
      const winner = await first.query(
        `UPDATE "Order"
            SET "remark" = 'editor A',
                "updatedAt" = '2026-08-30T00:00:00.000Z'
          WHERE "id" = 'order-1'
            AND "editVersion" = 0`,
      );
      expect(winner.rowCount).toBe(1);

      let staleFinished = false;
      const staleUpdate = second
        .query(
          `UPDATE "Order"
              SET "remark" = 'editor B',
                  "updatedAt" = '2026-08-30T00:00:00.000Z'
            WHERE "id" = 'order-1'
              AND "editVersion" = 0`,
        )
        .then((result) => {
          staleFinished = true;
          return result;
        });
      await waitForBlockedStatement();
      expect(staleFinished).toBe(false);

      await first.query('COMMIT');
      const stale = await staleUpdate;
      expect(stale.rowCount).toBe(0);
      await second.query('COMMIT');

      const persisted = await first.query<{
        remark: string;
        editVersion: number;
        updatedAt: Date;
      }>(
        `SELECT "remark", "editVersion" AS "editVersion", "updatedAt" AS "updatedAt"
           FROM "Order"
          WHERE "id" = 'order-1'`,
      );
      expect(persisted.rows).toEqual([
        {
          remark: 'editor A',
          editVersion: 1,
          updatedAt: new Date('2026-08-30T00:00:00.000Z'),
        },
      ]);
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      await first.query('RESET search_path').catch(() => undefined);
      await second.query('RESET search_path').catch(() => undefined);
      await first
        .query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
        .catch(() => undefined);
      await first.end();
      await second.end();
    }
  }, 10_000);
});
