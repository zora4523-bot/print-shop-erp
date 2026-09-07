import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('prisma/migrations/20260908003000_order_version_carryover/migration.sql', 'utf8');
const postgresDescribe = process.env.DATABASE_URL ? describe : describe.skip;

postgresDescribe('production carryover database guards', () => {
  it('承接量不可改写，新增件数包含承接量后受上限保护，旧代不可追加', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    const schema = `carryover_${randomBytes(8).toString('hex')}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      await client.query(`SET statement_timeout TO '10s'`);
      await client.query(`
        CREATE TYPE "PieceworkOperationType" AS ENUM ('PARTIAL', 'FULL', 'PACKING');
        CREATE TYPE "ProductionWorkOrderStage" AS ENUM ('FOILING', 'PACKING');
        CREATE TABLE "Order" (id text PRIMARY KEY, "workOrderVersion" integer);
        CREATE TABLE "OrderItem" (id text PRIMARY KEY, "orderId" text, quantity integer);
        CREATE TABLE "ProductionOperation" (id text PRIMARY KEY, "orderId" text, "workOrderVersion" integer, "operationType" "PieceworkOperationType", "plannedQty" numeric(14,3));
        CREATE TABLE "ProductionProgressStep" (id text PRIMARY KEY, "plannedQty" numeric(14,3));
        CREATE TABLE "ProductionReport" (id text PRIMARY KEY, "operationId" text, "reporterId" text, "idempotencyKey" text, "reportedAt" timestamptz);
        CREATE TABLE "ProductionWorkOrderProgress" (id text PRIMARY KEY, "orderId" text, "operationId" text, "workOrderVersion" integer, "sourceReportId" text, "reporterId" text, "idempotencyKey" text, stage "ProductionWorkOrderStage", "workOrderProgressQuantity" numeric(14,3), "reportedAt" timestamptz);
        INSERT INTO "Order" VALUES ('order', 2);
        INSERT INTO "OrderItem" VALUES ('item', 'order', 100);
        INSERT INTO "ProductionOperation" VALUES ('old', 'order', 1, 'PARTIAL', 100);
        INSERT INTO "ProductionProgressStep" VALUES ('step', 100);
      `);
      await client.query(migration);
      expect((await client.query('SELECT "carriedCompletedQty"::text AS quantity FROM "ProductionOperation" WHERE id = $1', ['old'])).rows[0]?.quantity).toBe('0.000');
      await client.query(`
        CREATE TRIGGER check_progress BEFORE INSERT ON "ProductionWorkOrderProgress" FOR EACH ROW EXECUTE FUNCTION validate_production_work_order_progress_insert();
        INSERT INTO "ProductionOperation" VALUES ('new', 'order', 2, 'PARTIAL', 100, 70, 70);
        INSERT INTO "ProductionReport" VALUES ('r1', 'new', 'worker', 'key1', now()), ('r2', 'new', 'worker', 'key2', now()), ('rold', 'old', 'worker', 'oldkey', now());
      `);
      await expect(client.query('UPDATE "ProductionOperation" SET "carriedCompletedQty" = 69 WHERE id = $1', ['new'])).rejects.toThrow('carryover is immutable');
      await expect(client.query('UPDATE "ProductionOperation" SET "carriedWorkOrderProgressQty" = 69 WHERE id = $1', ['new'])).rejects.toThrow('carryover is immutable');
      await expect(client.query('UPDATE "ProductionProgressStep" SET "carriedCompletedQty" = 1 WHERE id = $1', ['step'])).rejects.toThrow('carryover is immutable');
      await expect(client.query(`INSERT INTO "ProductionOperation" VALUES ('bad', 'order', 2, 'PARTIAL', 10, -1, 0)`)).rejects.toThrow('carryover_nonnegative');
      await client.query(`INSERT INTO "ProductionWorkOrderProgress" VALUES ('p1', 'order', 'new', 2, 'r1', 'worker', 'key1', 'FOILING', 30, now())`);
      await expect(client.query(`INSERT INTO "ProductionWorkOrderProgress" VALUES ('p2', 'order', 'new', 2, 'r2', 'worker', 'key2', 'FOILING', 1, now())`)).rejects.toThrow('exceeds order quantity');
      await expect(client.query(`INSERT INTO "ProductionWorkOrderProgress" VALUES ('pold', 'order', 'old', 1, 'rold', 'worker', 'oldkey', 'FOILING', 1, now())`)).rejects.toThrow('current production generation');
      expect((await client.query('SELECT count(*)::int AS count FROM "ProductionReport"')).rows[0]?.count).toBe(3);
    } finally {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });
});
