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
    '20260830180000_financial_derivation_integrity',
    'migration.sql',
  ),
  'utf8',
);

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

postgresDescribe.sequential(
  'financial derivation integrity migration · PostgreSQL',
  () => {
    it('installs supplemental bill and receipt idempotency guards on the legacy shape', async () => {
      const schema = `financial_derivation_${randomBytes(8).toString('hex')}`;
      const quotedSchema = quoteIdentifier(schema);
      const client = new Client({ connectionString: databaseUrl });

      await client.connect();
      try {
        await client.query(`CREATE SCHEMA ${quotedSchema}`);
        await client.query(`SET search_path TO ${quotedSchema}, public`);
        await client.query(`SET statement_timeout TO '5s'`);
        await client.query(`
          CREATE TABLE "Bill" (
            "id" TEXT PRIMARY KEY,
            "salesUserId" TEXT NOT NULL,
            "period" TEXT NOT NULL
          );
          CREATE UNIQUE INDEX "Bill_salesUserId_period_key"
            ON "Bill"("salesUserId", "period");

          CREATE TABLE "BillItem" (
            "id" TEXT PRIMARY KEY,
            "billId" TEXT NOT NULL,
            "orderId" TEXT NOT NULL
          );
          CREATE UNIQUE INDEX "BillItem_billId_orderId_key"
            ON "BillItem"("billId", "orderId");

          CREATE TABLE "PurchaseReceipt" (
            "id" TEXT PRIMARY KEY
          );

          INSERT INTO "Bill" ("id", "salesUserId", "period")
          VALUES ('bill-1', 'sales-1', '2026-05');
          INSERT INTO "BillItem" ("id", "billId", "orderId")
          VALUES ('item-1', 'bill-1', 'order-1');
          INSERT INTO "PurchaseReceipt" ("id") VALUES ('receipt-1')
        `);

        await client.query(migration);

        const bill = await client.query<{ sequence: number }>(
          `SELECT "sequence" FROM "Bill" WHERE "id" = 'bill-1'`,
        );
        expect(bill.rows).toEqual([{ sequence: 1 }]);
        const indexes = await client.query<{ indexname: string }>(
          `SELECT indexname
             FROM pg_indexes
            WHERE schemaname = $1
              AND indexname IN (
                'Bill_salesUserId_period_sequence_key',
                'BillItem_orderId_key'
              )
            ORDER BY indexname`,
          [schema],
        );
        expect(indexes.rows.map((row) => row.indexname)).toEqual([
          'BillItem_orderId_key',
          'Bill_salesUserId_period_sequence_key',
        ]);

        await client.query(
          `INSERT INTO "Bill" ("id", "salesUserId", "period", "sequence")
           VALUES ('bill-2', 'sales-1', '2026-05', 2)`,
        );
        await expect(
          client.query(
            `INSERT INTO "Bill" ("id", "salesUserId", "period", "sequence")
             VALUES ('bill-duplicate', 'sales-1', '2026-05', 2)`,
          ),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          client.query(
            `INSERT INTO "BillItem" ("id", "billId", "orderId")
             VALUES ('item-duplicate', 'bill-2', 'order-1')`,
          ),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          client.query(
            `UPDATE "PurchaseReceipt"
                SET "requestFingerprint" = 'not-a-sha256'
              WHERE "id" = 'receipt-1'`,
          ),
        ).rejects.toMatchObject({ code: '23514' });
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        await client.query('RESET search_path').catch(() => undefined);
        await client
          .query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
          .catch(() => undefined);
        await client.end();
      }
    }, 10_000);
  },
);
