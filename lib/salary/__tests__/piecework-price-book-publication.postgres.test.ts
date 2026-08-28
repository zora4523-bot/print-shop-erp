import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
const migration = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20260828110000_piecework_operation_ledger/migration.sql',
  ),
  'utf8',
);

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

postgresDescribe('piecework v1 publication · PostgreSQL concurrency', () => {
  it('serializes publishers and permits exact reversal after the rate expires', async () => {
    const schema = `piecework_publish_${randomBytes(8).toString('hex')}`;
    const quotedSchema = quoteIdentifier(schema);
    const first = new Client({ connectionString: databaseUrl });
    const second = new Client({ connectionString: databaseUrl });
    await first.connect();
    await second.connect();

    try {
      await first.query(`CREATE SCHEMA ${quotedSchema}`);
      await first.query(`SET search_path TO ${quotedSchema}, public`);
      await first.query(`
        CREATE TYPE "Role" AS ENUM ('ADMIN');
        CREATE TABLE "User" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "Order" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "OrderItem" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "OrderPackagingGroup" ("id" TEXT PRIMARY KEY);
      `);
      await first.query(migration);
      await second.query(`SET search_path TO ${quotedSchema}, public`);

      await first.query(`INSERT INTO "User" ("id") VALUES ('admin-1')`);
      await first.query(`
        INSERT INTO "PieceworkPriceBook" (
          "id", "version", "status", "createdAt", "updatedAt"
        ) VALUES (
          'piecework-v1', 1, 'DRAFT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        );
        INSERT INTO "PieceworkPriceRule" (
          "id", "priceBookId", "operationType", "unit", "amount",
          "createdAt", "updatedAt"
        ) VALUES
          ('partial', 'piecework-v1', 'PARTIAL', 'PER_PASS', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('full', 'piecework-v1', 'FULL', 'PER_PIECE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('packing', 'piecework-v1', 'PACKING', 'PER_BAG', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);

      await first.query('BEGIN');
      await second.query('BEGIN');
      await first.query(
        `SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'))`,
      );

      let secondAcquired = false;
      const secondLock = second
        .query(
          `SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'))`,
        )
        .then(() => {
          secondAcquired = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(secondAcquired).toBe(false);

      await first.query(`
        UPDATE "PieceworkPriceRule"
        SET "amount" = CASE "operationType"
          WHEN 'PARTIAL' THEN 0.0075
          WHEN 'FULL' THEN 0.0125
          WHEN 'PACKING' THEN 0.3000
        END,
        "updatedAt" = CURRENT_TIMESTAMP
        WHERE "priceBookId" = 'piecework-v1';
        UPDATE "PieceworkPriceBook"
        SET
          "status" = 'PUBLISHED',
          "effectiveFrom" = '2026-08-28T00:00:00.000Z',
          "effectiveTo" = '2026-08-29T00:00:00.000Z',
          "sourceName" = '并发发布测试',
          "sourceSha256" = repeat('a', 64),
          "manifestSha256" = repeat('a', 64),
          "ruleSetSha256" = repeat('b', 64),
          "publishNote" = '首版发布',
          "publishedById" = 'admin-1',
          "publishedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = 'piecework-v1';
      `);
      await first.query('COMMIT');
      await secondLock;

      const observed = await second.query<{
        status: string;
        ruleCount: number;
        nullRateCount: number;
      }>(`
        SELECT
          book."status"::text AS status,
          count(rule."id")::int AS "ruleCount",
          count(*) FILTER (WHERE rule."amount" IS NULL)::int AS "nullRateCount"
        FROM "PieceworkPriceBook" book
        JOIN "PieceworkPriceRule" rule ON rule."priceBookId" = book."id"
        WHERE book."version" = 1
        GROUP BY book."status"
      `);
      expect(observed.rows).toEqual([
        { status: 'PUBLISHED', ruleCount: 3, nullRateCount: 0 },
      ]);
      await expect(
        second.query(
          `UPDATE "PieceworkPriceRule" SET "amount" = 9 WHERE "id" = 'partial'`,
        ),
      ).rejects.toThrow('immutable');
      await second.query('ROLLBACK');

      await first.query(`
        INSERT INTO "Order" ("id") VALUES ('order-1');
        INSERT INTO "ProductionOperation" (
          "id", "orderId", "operationType", "unit", "status",
          "plannedQty", "createdAt", "updatedAt"
        ) VALUES (
          'operation-1', 'order-1', 'PARTIAL', 'PER_PASS', 'COMPLETED',
          100, '2026-08-28T10:00:00.000Z', '2026-08-28T10:00:00.000Z'
        );
        INSERT INTO "ProductionReport" (
          "id", "operationId", "reporterId", "entryType", "source",
          "reportedCompletedQty", "defectQty", "reworkQty", "chargeableQty",
          "unit", "rate", "amount", "priceBookId", "priceBookVersion",
          "ruleSetSha256", "snapshot", "idempotencyKey", "reportedAt"
        ) VALUES (
          'report-original', 'operation-1', 'admin-1', 'REPORT', 'LIVE',
          100, 3, 2, 200, 'PER_PASS', 0.0075, 1.50,
          'piecework-v1', 1, repeat('b', 64), '{}'::jsonb,
          'report-original-request', '2026-08-28T12:00:00.000Z'
        );
      `);

      await expect(
        first.query(`
          INSERT INTO "ProductionReport" (
            "id", "operationId", "reporterId", "entryType", "source",
            "reportedCompletedQty", "defectQty", "reworkQty", "chargeableQty",
            "unit", "rate", "amount", "priceBookId", "priceBookVersion",
            "ruleSetSha256", "snapshot", "idempotencyKey", "reportedAt"
          ) VALUES (
            'report-after-expiry', 'operation-1', 'admin-1', 'REPORT', 'LIVE',
            1, 0, 0, 1, 'PER_PASS', 0.0075, 0.01,
            'piecework-v1', 1, repeat('b', 64), '{}'::jsonb,
            'report-after-expiry-request', '2026-08-30T12:00:00.000Z'
          )
        `),
      ).rejects.toThrow('effective published rate');

      // The book is no longer effective on 2026-08-30. A correction must
      // nevertheless use the frozen original evidence, not today's book.
      await expect(
        first.query(`
          INSERT INTO "ProductionReport" (
            "id", "operationId", "reporterId", "entryType", "source",
            "reversalOfId", "reportedCompletedQty", "defectQty", "reworkQty",
            "chargeableQty", "unit", "rate", "amount", "priceBookId",
            "priceBookVersion", "ruleSetSha256", "snapshot",
            "idempotencyKey", "reportedAt"
          ) VALUES (
            'report-reversal', 'operation-1', 'admin-1', 'REVERSAL', 'LIVE',
            'report-original', -100, -3, -2, -200, 'PER_PASS', 0.0075, -1.50,
            'piecework-v1', 1, repeat('b', 64), '{}'::jsonb,
            'report-reversal-request', '2026-08-30T12:00:00.000Z'
          )
        `),
      ).resolves.toMatchObject({ rowCount: 1 });
      const reportTotal = await first.query<{ amount: string }>(`
        SELECT sum("amount")::text AS amount
        FROM "ProductionReport"
        WHERE "operationId" = 'operation-1'
      `);
      expect(reportTotal.rows).toEqual([{ amount: '0.00' }]);
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
  });
});
