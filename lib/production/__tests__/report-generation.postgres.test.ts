import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { describe, it, expect } from 'vitest';
const sql = readFileSync('prisma/migrations/20260921100000_production_report_generation_guard/migration.sql', 'utf8');
(process.env.DATABASE_URL ? describe : describe.skip)('report generation database guard', () => {
  it('rejects old-generation reports, allows current reports and preserves historical financial adjustments', async () => {
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    const schema = `report_guard_${randomBytes(6).toString('hex')}`;
    await db.connect();
    try {
      await db.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}", public`);
      await db.query(`
        CREATE TABLE "Order" (id text PRIMARY KEY, "workOrderVersion" int);
        CREATE TABLE "ProductionOperation" (id text PRIMARY KEY, "orderId" text, "workOrderVersion" int);
        CREATE TABLE "ProductionProgressStep" (id text PRIMARY KEY, "orderId" text, "workOrderVersion" int);
        CREATE TABLE "ProductionReport" (id text PRIMARY KEY, "operationId" text, "entryType" text DEFAULT 'REPORT');
        CREATE TABLE "ProductionProgressReport" (id text PRIMARY KEY, "progressStepId" text);
        INSERT INTO "Order" VALUES ('order', 2);
        INSERT INTO "ProductionOperation" VALUES ('old', 'order', 1), ('current', 'order', 2);
        INSERT INTO "ProductionProgressStep" VALUES ('old', 'order', 1), ('current', 'order', 2);
      `);
      await db.query(sql); await db.query(sql);
      await expect(db.query(`INSERT INTO "ProductionReport" (id,"operationId") VALUES ('bad','old')`)).rejects.toThrow('current work-order version');
      await expect(db.query(`INSERT INTO "ProductionProgressReport" VALUES ('bad','old')`)).rejects.toThrow('current work-order version');
      await expect(db.query(`INSERT INTO "ProductionReport" (id,"operationId") VALUES ('missing','absent')`)).rejects.toThrow('current work-order version');
      await db.query(`INSERT INTO "ProductionReport" VALUES ('ok','current','REPORT'),('adjust','old','ADJUSTMENT'),('reverse','old','REVERSAL')`);
      await db.query(`INSERT INTO "ProductionProgressReport" VALUES ('ok','current')`);
      expect((await db.query(`SELECT count(*)::int n FROM "ProductionReport"`)).rows[0].n).toBe(3);
    } finally {
      await db.query('SET search_path TO public');
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.end();
    }
  }, 30_000);
});
